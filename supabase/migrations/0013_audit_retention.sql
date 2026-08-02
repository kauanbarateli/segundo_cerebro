-- =============================================================================
-- 0013 — Retenção das trilhas de auditoria
--
-- OBJETIVO: `public.finance_audit_events` (0005) e `public.vault_audit_events`
-- (0001) só recebem INSERT. Nada nunca apaga uma linha delas. Cada operação
-- financeira e cada destrancar do Cofre escreve um registro, e o crescimento é
-- monotônico — devagar, silencioso, e sem fim.
--
-- POR QUE ISSO IMPORTA numa aplicação de UM usuário, onde "milhões de linhas"
-- parece conversa de outra escala:
--
--   1. O plano gratuito do Supabase tem teto de disco. Quem enche o teto não
--      recebe um e-mail: recebe escrita recusada — e a escrita recusada
--      inclui a das tabelas que importam, não só a da auditoria.
--   2. Auditoria velha é RESPONSABILIDADE, não patrimônio. `vault_audit_events`
--      registra cada acesso ao Cofre com data e hora. Guardar isso por cinco
--      anos não protege ninguém; só aumenta o que vaza no dia em que vazar.
--      Retenção curta é higiene de segurança, não faxina de disco.
--   3. O índice `(user_id, occurred_at desc)` das duas tabelas fica maior a
--      cada linha, e ele é lido nas telas que mostram atividade recente.
--
-- 180 dias é o padrão. É meio ano: cobre qualquer conferência retroativa
-- plausível ("quando foi que eu mexi nesta conta?") e não guarda uma década de
-- rastro de acesso ao Cofre. O número é PARÂMETRO, com piso de 30 dias — ver a
-- validação dentro da função e o motivo do piso.
--
-- =============================================================================
-- COMO A LIMPEZA É DISPARADA — decisão tomada, com o porquê
-- =============================================================================
-- Três caminhos possíveis, e a escolha é a soma dos dois primeiros:
--
--   (a) O DONO CHAMA. `select * from public.purge_audit_events();` no SQL
--       editor. É o caminho que SEMPRE funciona, não depende de extensão
--       nenhuma, e é o que esta migration garante ao existir.
--
--   (b) pg_cron AGENDA, **se e somente se** a extensão já estiver instalada.
--       O bloco no fim do arquivo confere `pg_extension` antes e degrada com
--       `raise notice` quando não encontra. Isto é deliberado e não é excesso
--       de zelo: `create extension pg_cron` exige superusuário e, no Supabase,
--       é ligado pelo painel — uma migration que assume a extensão falha com
--       "extension pg_cron does not exist" e ABORTA A TRANSAÇÃO INTEIRA. Uma
--       migration que não aplica é estritamente pior que uma limpeza que não
--       roda: a segunda é um lembrete no log, a primeira trava a fila de
--       migrations do projeto.
--
--   (c) UMA ROTA DE CRON DA APLICAÇÃO chama por RPC. Fica REGISTRADO como
--       caminho válido e NÃO é implementado aqui: hoje a única rota agendável
--       do projeto é /api/google/calendar/sync (que passou a validar
--       CRON_SECRET nesta mesma leva — ver src/lib/cron-auth.ts), e pendurar
--       faxina de banco numa rota de sincronização de agenda seria juntar duas
--       coisas que falham por motivos diferentes. Quando existir uma rota de
--       cron própria, ela chama
--       `admin.rpc("purge_audit_events", { p_dias_de_retencao: 180 })` com o
--       cliente service_role — que é exatamente o único papel com EXECUTE
--       nesta função, ver os grants abaixo.
--
-- =============================================================================
-- SEGURANÇA — por que um usuário comum não consegue apagar rastro alheio
-- (nem o próprio)
-- =============================================================================
-- Apagar auditoria é a primeira coisa que se faz depois de fazer o que a
-- auditoria registraria. Então o desenho tem DUAS barreiras, e as duas contam:
--
--   1. GRANT. `revoke all ... from public` (o que já derruba anon e
--      authenticated, que herdam de public) e `grant execute` SÓ para
--      service_role. Um usuário logado que tente
--      `supabase.rpc("purge_audit_events")` recebe "permission denied for
--      function" — a função sequer roda.
--
--   2. `security invoker`, e NÃO `security definer`. Esta é a parte que se
--      erra com boa intenção: `security definer` faria a função rodar com os
--      poderes do dono (postgres, que ignora RLS), e aí a barreira 1 viraria a
--      ÚNICA — um `grant execute` distraído no futuro, ou qualquer caminho que
--      alcance a função, apagaria a auditoria de todo mundo. Com
--      `security invoker` o DELETE passa pela RLS de quem chamou: se um dia
--      um usuário comum conseguir executá-la, ele alcança no máximo as
--      próprias linhas. As duas barreiras erram para lados diferentes, que é o
--      que faz delas duas barreiras e não uma repetida.
--
-- Quem consegue mesmo apagar: service_role e postgres — os dois têm BYPASSRLS,
-- então para eles o `security invoker` alcança todas as linhas, que é
-- justamente o que o job precisa.
--
-- =============================================================================
-- O QUE ESTA MIGRATION NÃO FAZ, de propósito
-- =============================================================================
-- - NÃO cria índice em `occurred_at`. O DELETE vai varrer a tabela, e está
--   certo assim: a varredura acontece uma vez por dia (ou por mês, ou quando o
--   dono lembrar) sobre uma tabela de aplicação pessoal, enquanto um índice
--   seria pago em TODA escrita de auditoria — que acontece a cada operação
--   financeira. Trocar custo constante por custo raro seria o negócio errado.
--   Se um dia a tabela chegar a milhões de linhas, aí o índice se paga.
-- - NÃO apaga em lotes com pausa. Pelo mesmo motivo: o volume não justifica a
--   complexidade, e um DELETE único é atômico — ou some tudo que venceu, ou
--   não some nada, e uma segunda tentativa faz o mesmo trabalho.
-- - NÃO cria tabela, então não há RLS nem policies novas aqui. As duas tabelas
--   tocadas já têm as quatro policies `to authenticated` com
--   `(select auth.uid()) = user_id`, criadas em 0001 e 0005.
-- =============================================================================

begin;

-- `drop` antes do `create or replace` porque trocar o TIPO DE RETORNO de uma
-- função existente é erro no Postgres ("cannot change return type of existing
-- function"), e o `or replace` sozinho não resolve. Com o drop, reaplicar esta
-- migration depois de mexer na assinatura continua funcionando — que é o que
-- "idempotente" precisa significar aqui.
drop function if exists public.purge_audit_events(integer);

/*
  `set search_path = ''` e TODA referência qualificada (public., pg_catalog.).

  Sem isso, a função resolveria nomes pelo search_path de QUEM CHAMA, e quem
  chama pode criar uma tabela `finance_audit_events` num schema próprio e
  colocá-la na frente de `public` — a função apagaria a tabela errada, ou pior,
  executaria uma função homônima plantada. Com search_path vazio não existe
  nome ambíguo: ou está escrito por extenso, ou não resolve.
*/
create function public.purge_audit_events(p_dias_de_retencao integer default 180)
returns table (tabela text, linhas_apagadas bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_corte    timestamptz;
  v_apagadas bigint;
begin
  /*
    PISO DE 30 DIAS, e ele não é burocracia.

    `purge_audit_events(0)` apagaria a auditoria INTEIRA, inclusive a de dois
    minutos atrás — o efeito exato que alguém encobrindo rastro quer, alcançado
    por um argumento inocente. E `purge_audit_events(null)` seria pior de outro
    jeito: `now() - null` é null, `occurred_at < null` é NULL (não FALSE, não
    TRUE), então o WHERE não casaria com nada e a função devolveria "0 linhas"
    com ar de sucesso — a mesma armadilha do NULL que já mordeu 0009 e 0012,
    aqui na forma de uma limpeza que nunca limpa e que ninguém percebe.

    Recusar alto e cedo é o certo: quem quiser retenção mais curta que 30 dias
    está pedindo outra coisa, e essa outra coisa precisa ser escrita à mão.
  */
  if p_dias_de_retencao is null or p_dias_de_retencao < 30 then
    raise exception
      'purge_audit_events: p_dias_de_retencao precisa ser um inteiro >= 30 (recebido: %)',
      p_dias_de_retencao
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  v_corte := pg_catalog.now() - pg_catalog.make_interval(days => p_dias_de_retencao);

  /*
    `<` e não `<=`: o corte é um instante, e uma linha gravada EXATAMENTE nele
    ainda não completou a janela. A diferença é irrelevante na prática e a
    escolha é a mesma convenção do resto do projeto (ver o corte `>=` das
    faturas em 0010) — o que importa é ela estar escrita em algum lugar.
  */
  delete from public.finance_audit_events where occurred_at < v_corte;
  get diagnostics v_apagadas = row_count;
  tabela := 'finance_audit_events';
  linhas_apagadas := v_apagadas;
  return next;

  delete from public.vault_audit_events where occurred_at < v_corte;
  get diagnostics v_apagadas = row_count;
  tabela := 'vault_audit_events';
  linhas_apagadas := v_apagadas;
  return next;

  /*
    As duas tabelas na MESMA função e na mesma transação de propósito: elas
    representam a mesma decisão de política ("quanto tempo se guarda rastro"),
    e duas funções separadas seriam duas oportunidades de a política divergir —
    financeiro em 180 dias, Cofre em 3 anos, sem ninguém ter decidido isso.
  */
  return;
end;
$$;

comment on function public.purge_audit_events(integer) is
  'Apaga eventos de auditoria (finance_audit_events e vault_audit_events) mais velhos que N dias (padrao 180, minimo 30). security invoker: sob RLS, so alcanca as linhas de quem chama; service_role e postgres ignoram RLS e alcancam todas. Devolve quantas linhas sairam de cada tabela.';

-- -----------------------------------------------------------------------------
-- Grants — ver a seção SEGURANÇA no cabeçalho.
--
-- `from public` é o que realmente fecha a porta: no Postgres, toda função nasce
-- com EXECUTE para o pseudo-papel `public`, do qual anon e authenticated
-- herdam. Revogar só de anon/authenticated deixaria o privilégio herdado
-- intacto. Os dois nomes aparecem mesmo assim, explicitamente, porque o
-- objetivo aqui é que quem lê o arquivo veja a intenção sem precisar conhecer
-- essa herança.
-- -----------------------------------------------------------------------------
revoke all on function public.purge_audit_events(integer) from public;
revoke all on function public.purge_audit_events(integer) from anon;
revoke all on function public.purge_audit_events(integer) from authenticated;
grant execute on function public.purge_audit_events(integer) to service_role;

commit;

-- =============================================================================
-- AGENDAMENTO OPCIONAL VIA pg_cron — fora da transação acima de propósito.
--
-- Se este bloco falhasse dentro do `begin/commit`, ele levaria junto a criação
-- da função, que é a parte que importa. Aqui embaixo, o pior caso é um NOTICE.
--
-- Duas camadas de proteção, porque são dois modos de falha diferentes:
--   1. a extensão pode não existir (plano/projeto sem pg_cron ligado);
--   2. ela pode existir e o agendamento falhar mesmo assim — sem permissão no
--      schema `cron`, versão da API diferente, job de nome igual criado à mão.
-- O `exception when others` cobre o caso 2 e transforma um erro fatal em aviso.
--
-- Toda referência ao schema `cron` está dentro de EXECUTE (string), então o
-- Postgres nem tenta resolver esses nomes quando a extensão não existe.
-- =============================================================================
do $$
declare
  v_tem_pg_cron boolean;
  v_ja_agendado boolean;
begin
  select exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) into v_tem_pg_cron;

  if not v_tem_pg_cron then
    raise notice '0013: extensao pg_cron ausente — NADA foi agendado (isto e esperado no plano free do Supabase).';
    raise notice '0013: a funcao public.purge_audit_events(integer) existe e esta pronta. Rode manualmente quando quiser: select * from public.purge_audit_events();';
    return;
  end if;

  begin
    execute $cron$
      select exists (select 1 from cron.job where jobname = 'purge_audit_events_diario')
    $cron$ into v_ja_agendado;

    -- Reagendar em vez de pular: garante que reaplicar a migration deixa o job
    -- com a definicao DESTE arquivo, e nao com a de uma versao anterior.
    if v_ja_agendado then
      execute $cron$ select cron.unschedule('purge_audit_events_diario') $cron$;
    end if;

    -- 04:17 UTC: madrugada em UTC-3 e um minuto "quebrado", para nao cair no
    -- mesmo instante de todo mundo que agenda em hora cheia.
    execute $cron$
      select cron.schedule(
        'purge_audit_events_diario',
        '17 4 * * *',
        $sql$select public.purge_audit_events(180)$sql$
      )
    $cron$;

    raise notice '0013: job diario "purge_audit_events_diario" agendado no pg_cron (04:17 UTC, retencao de 180 dias).';
  exception when others then
    raise notice '0013: pg_cron existe mas o agendamento NAO foi criado (%). A funcao esta la; rode manualmente: select * from public.purge_audit_events();', sqlerrm;
  end;
end
$$;

-- =============================================================================
-- CONFERÊNCIA DEPOIS DE APLICAR (não roda nada; copie e cole no SQL editor)
--
-- 1. A função existe, é invoker e tem search_path vazio. Esperado: UMA linha,
--    com prosecdef = false e proconfig = {search_path=}.
--
--      select proname, prosecdef, proconfig
--      from pg_proc where proname = 'purge_audit_events';
--
-- 2. Ninguém além de service_role (e do dono) executa. Esperado: NENHUMA linha
--    para anon nem para authenticated.
--
--      select grantee, privilege_type
--      from information_schema.routine_privileges
--      where routine_name = 'purge_audit_events';
--
-- 3. Ensaio SEM apagar nada — quantas linhas a limpeza levaria hoje:
--
--      select 'finance' as trilha, count(*) from public.finance_audit_events
--        where occurred_at < now() - interval '180 days'
--      union all
--      select 'vault', count(*) from public.vault_audit_events
--        where occurred_at < now() - interval '180 days';
--
-- 4. O piso de 30 dias está de pé. Esperado: ERRO 22023, não uma tabela vazia.
--
--      select * from public.purge_audit_events(0);
--
-- 5. Se pg_cron estiver ligado, o job ficou lá:
--
--      select jobname, schedule, command, active from cron.job
--      where jobname = 'purge_audit_events_diario';
-- =============================================================================
