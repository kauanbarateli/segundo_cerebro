-- =============================================================================
-- 0009 — Vínculos entre entidades (tarefa ↔ captura ↔ evento)
--
-- OBJETIVO: permitir dizer "esta tarefa nasceu daquela reunião" e "esta captura
-- virou pauta daquele evento" sem inventar uma tabela genérica.
--
-- MODELAGEM — decisão já tomada, registrada aqui para não ser reaberta:
--
--   (a) Tabela polimórfica (source_type + source_id): REJEITADA. O Postgres não
--       consegue declarar FK polimórfica; a integridade viraria responsabilidade
--       da aplicação e o resultado prático é órfão silencioso — a linha
--       referenciada some e o vínculo continua apontando para o nada.
--
--   (b) Colunas de FK dentro das próprias tabelas (tasks.capture_id etc.):
--       REJEITADA. Permite no máximo UM vínculo por tipo e faz `tasks` crescer
--       uma coluna a cada entidade nova que alguém queira relacionar.
--
--   (c) TRÊS TABELAS DE JUNÇÃO ESTREITAS: ESCOLHIDA. FK de verdade nas duas
--       pontas, `on delete cascade` real, índices simples e cardinalidade N:N.
--
-- DESVIOS DO PADRÃO DO PROJETO (deliberados — ver seções marcadas):
--   1. Sem coluna `updated_at`, logo sem trigger `set_updated_at`.
--   2. Sem trigger `prevent_user_id_change`.
--   3. Trigger de propriedade cobre INSERT *e* UPDATE.
--   Cada um está justificado no bloco correspondente.
--
-- SOFT DELETE DE EVENTO CANCELADO (decisão do dono do projeto):
--   Hoje `src/lib/google/calendar.ts` apaga a linha local do evento cancelado
--   com `.delete()`. Com `on delete cascade`, o vínculo sumiria junto e sem
--   aviso — exatamente o histórico que esta fase existe para preservar. A
--   partir daqui o evento cancelado é MARCADO (`status = 'cancelled'`), não
--   apagado. A coluna `status` já existe em `public.calendar_events` (text,
--   anulável) e já recebe 'cancelled': não há coluna nova nesta migration.
--   O que muda é a aplicação, que passa a fazer UPDATE onde fazia DELETE.
--
-- ARMADILHA DE NULL (já mordeu este projeto duas vezes — índice de
-- calendar_events e a consulta de getUpcomingEvents): no Postgres
-- `NULL <> 'cancelled'` avalia para NULL, não para TRUE. Um predicado
-- `status <> 'cancelled'` DESCARTA silenciosamente as linhas com status nulo.
-- A forma correta, usada em todo lugar deste arquivo, é
-- `status is null or status <> 'cancelled'`.
--
-- CONVERSÃO CAPTURA -> TAREFA (seção 5): `public.convert_capture_to_task` é
--   substituída por `create or replace`, preservando o corpo de 0001, para
--   gravar o vínculo tarefa<->captura na MESMA transação da conversão. Vem
--   junto o backfill das conversões que já existiam.
--
-- Idempotente: `if not exists` / `drop ... if exists` em tudo.
-- =============================================================================

begin;

-- =============================================================================
-- 1. TABELAS DE JUNÇÃO
--
-- Formato idêntico nas três: as duas FKs com `on delete cascade`, o `user_id`
-- desnormalizado (a RLS precisa dele na própria linha, sem join) e a CHAVE
-- PRIMÁRIA COMPOSTA pelas duas FKs — que já garante "no máximo um vínculo entre
-- o mesmo par", tornando a criação de vínculo naturalmente idempotente via
-- `on conflict do nothing`.
--
-- Não há coluna `id` própria: a identidade do vínculo É o par. Uma chave
-- substituta só permitiria duplicatas do mesmo par.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tarefa ↔ Captura
-- -----------------------------------------------------------------------------
create table if not exists public.task_capture_links (
  task_id    uuid not null references public.tasks (id)    on delete cascade,
  capture_id uuid not null references public.captures (id) on delete cascade,
  user_id    uuid not null references auth.users (id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, capture_id)
);

comment on table public.task_capture_links is
  'Vínculo N:N entre tarefas e capturas. Sem updated_at: vínculo não se edita, cria e apaga. A PK composta impede par duplicado.';
comment on column public.task_capture_links.user_id is
  'Dono, desnormalizado para a RLS avaliar sem join. Mantido igual ao dono das DUAS pontas pelo trigger trg_task_capture_links_same_owner.';
comment on column public.task_capture_links.created_at is
  'Quando o vínculo foi criado. É o único dado histórico da linha — não há edição.';

-- -----------------------------------------------------------------------------
-- Tarefa ↔ Evento de calendário
-- -----------------------------------------------------------------------------
create table if not exists public.task_event_links (
  task_id           uuid not null references public.tasks (id)            on delete cascade,
  calendar_event_id uuid not null references public.calendar_events (id)  on delete cascade,
  user_id           uuid not null references auth.users (id)              on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (task_id, calendar_event_id)
);

comment on table public.task_event_links is
  'Vínculo N:N entre tarefas e eventos do Google Calendar. Sustenta o histórico "esta tarefa nasceu daquela reunião" — por isso evento cancelado passa a ser soft delete, não DELETE.';
comment on column public.task_event_links.calendar_event_id is
  'Aponta para a linha LOCAL em public.calendar_events (o cache), não para o google_event_id. O cache é reescrito por upsert em (calendar_source_id, google_event_id), então o uuid local sobrevive à ressincronização.';
comment on column public.task_event_links.user_id is
  'Dono, desnormalizado para a RLS. Validado contra as duas pontas por trg_task_event_links_same_owner.';

-- -----------------------------------------------------------------------------
-- Captura ↔ Evento de calendário
-- -----------------------------------------------------------------------------
create table if not exists public.capture_event_links (
  capture_id        uuid not null references public.captures (id)         on delete cascade,
  calendar_event_id uuid not null references public.calendar_events (id)  on delete cascade,
  user_id           uuid not null references auth.users (id)              on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (capture_id, calendar_event_id)
);

comment on table public.capture_event_links is
  'Vínculo N:N entre capturas e eventos. Ex.: a nota rascunhada durante a reunião continua achável a partir do evento.';
comment on column public.capture_event_links.user_id is
  'Dono, desnormalizado para a RLS. Validado contra as duas pontas por trg_capture_event_links_same_owner.';

-- =============================================================================
-- 2. ÍNDICES
--
-- Antes de criar qualquer índice: a CHAVE PRIMÁRIA COMPOSTA (a, b) já cria um
-- btree que atende `where a = ?` e qualquer PREFIXO da chave. Ou seja,
-- navegar da ESQUERDA para a direita ("quais capturas estão ligadas a esta
-- tarefa?") já está coberto de graça. NÃO existe índice a criar para isso.
--
-- Índice redundante não é neutro (ver o cabeçalho de 0008): custa disco, é
-- mantido em toda escrita e polui as estatísticas do planejador. O banco fica
-- MAIS LENTO. Então aqui só entra o que falta de verdade — exatamente DOIS
-- índices por tabela:
--
--   [A] LADO DIREITO da PK. A navegação inversa ("quais tarefas nasceram deste
--       evento?") filtra pela SEGUNDA coluna da PK, que um btree composto não
--       atende: sem esse índice a consulta cai em varredura sequencial. Não é
--       precaução, é a metade que falta da funcionalidade.
--
--   [B] user_id. NÃO é redundante com a PK, cujo prefixo é task_id/capture_id e
--       nunca user_id. A justificativa decisiva não é de leitura, é de EXCLUSÃO:
--       `user_id references auth.users (id) on delete cascade` cria uma checagem
--       de integridade referencial que, a cada linha removida de auth.users,
--       procura as filhas com `where user_id = ?`. O Postgres NÃO indexa
--       automaticamente o lado REFERENCIANTE de uma FK — sem este índice, apagar
--       uma conta faz varredura sequencial completa nas três tabelas. É o mesmo
--       motivo pelo qual 0001 indexou task_tags.user_id e 0005 indexou
--       finance_transaction_tags.user_id; manter o padrão também evita que
--       alguém compare as junções e conclua que faltou índice em uma delas.
--
-- Foi considerado e DESCARTADO um índice extra em (created_at) para ordenar os
-- vínculos por data: o conjunto de vínculos de uma tarefa é da ordem de dezenas,
-- e ordenar dezenas de linhas na memória é mais barato que manter um terceiro
-- índice em toda escrita.
--
-- Também foi considerado e DESCARTADO fazer o índice do lado direito ser
-- composto — (capture_id, user_id) em vez de (capture_id) — para "casar" com o
-- predicado que a RLS acrescenta. Não compensa: capture_id já é altamente
-- seletivo (poucos vínculos por captura), então o filtro de user_id resolve na
-- heap sem custo relevante, e a coluna extra engordaria o índice em 16 bytes por
-- linha sem ganho mensurável.
-- =============================================================================

-- [A] navegação inversa
create index if not exists task_capture_links_capture_idx
  on public.task_capture_links (capture_id);
comment on index public.task_capture_links_capture_idx is
  'Navegação inversa captura -> tarefas. A PK (task_id, capture_id) só cobre o sentido tarefa -> capturas. Ver 0009.';

create index if not exists task_event_links_event_idx
  on public.task_event_links (calendar_event_id);
comment on index public.task_event_links_event_idx is
  'Navegação inversa evento -> tarefas ("o que nasceu desta reunião"). A PK só cobre tarefa -> eventos. Ver 0009.';

create index if not exists capture_event_links_event_idx
  on public.capture_event_links (calendar_event_id);
comment on index public.capture_event_links_event_idx is
  'Navegação inversa evento -> capturas. Também é o índice usado pela consulta de faxina no fim de 0009. Ver 0009.';

-- [B] lado referenciante da FK para auth.users
create index if not exists task_capture_links_user_idx
  on public.task_capture_links (user_id);
comment on index public.task_capture_links_user_idx is
  'Lado referenciante da FK para auth.users: sem ele, cada DELETE em auth.users faz varredura sequencial aqui. A PK começa por task_id e não serve. Ver 0009.';

create index if not exists task_event_links_user_idx
  on public.task_event_links (user_id);
comment on index public.task_event_links_user_idx is
  'Lado referenciante da FK para auth.users (cascade de exclusão de conta). Ver 0009.';

create index if not exists capture_event_links_user_idx
  on public.capture_event_links (user_id);
comment on index public.capture_event_links_user_idx is
  'Lado referenciante da FK para auth.users (cascade de exclusão de conta). Ver 0009.';

-- =============================================================================
-- 3. INTEGRIDADE DE PROPRIEDADE — o buraco que as FKs NÃO fecham
--
-- As duas FKs garantem que a tarefa e a captura EXISTEM. Não garantem que
-- pertencem à MESMA pessoa. E a RLS de INSERT só valida o user_id da PRÓPRIA
-- linha do vínculo:
--
--   create policy ..._insert ... with check ((select auth.uid()) = user_id)
--
-- Ou seja, um usuário mal-intencionado poderia inserir um vínculo com o
-- user_id DELE apontando para a tarefa de OUTRA pessoa: o with check passa
-- (o user_id é o dele) e a FK passa (a tarefa existe). O resultado é um
-- vínculo válido que revela ids alheios e, pior, faz o "cascade" da tarefa
-- alheia apagar linha dele.
--
-- FECHAMENTO: trigger BEFORE que confere as DUAS pontas contra new.user_id.
--
-- UMA FUNÇÃO GENÉRICA, não três — decisão consciente. Uma checagem de segurança
-- copiada em três lugares é uma checagem que vai divergir no dia em que alguém
-- corrigir apenas uma das cópias. O custo do SQL dinâmico (replanejamento a cada
-- chamada) é irrelevante aqui: criar vínculo é ação pontual do usuário, nunca
-- caminho de escrita em massa. Uma quarta tabela de vínculo no futuro precisa
-- só de um trigger, não de outra função.
--
-- `security invoker` + `set search_path = ''` como as demais funções do projeto,
-- e TODA referência prefixada com public. / auth. — com search_path vazio nada
-- resolve sozinho.
--
-- Sobre `security invoker`: a consulta interna roda como o CHAMADOR e portanto
-- SOB A RLS dele. Uma tarefa de outro usuário é simplesmente invisível, então o
-- caso normal cai no ramo "não existe ou não está visível" — e não vaza a
-- informação de que aquele id existe. O ramo de "pertence a outro usuário" é a
-- defesa em profundidade para quem ignora RLS (service_role e o dono das
-- tabelas), que é justamente por onde uma rotina de servidor mal escrita
-- criaria o vínculo cruzado.
-- =============================================================================

create or replace function public.enforce_link_same_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- TG_ARGV é 0-based e vem aos PARES: (tabela_referenciada, coluna_local).
  -- Ex.: ('tasks', 'task_id', 'captures', 'capture_id').
  v_table text;
  v_col   text;
  v_id    uuid;
  v_owner uuid;
begin
  if tg_nargs <> 4 then
    raise exception
      'enforce_link_same_owner: o trigger exige 4 argumentos (tabela, coluna, tabela, coluna); recebeu %',
      tg_nargs;
  end if;

  -- Duas voltas: uma por ponta do vínculo.
  for i in 0..1 loop
    v_table := tg_argv[i * 2];
    v_col   := tg_argv[i * 2 + 1];

    -- O nome da coluna só é conhecido em tempo de execução, então o valor sai
    -- de NEW via jsonb. `to_jsonb` vive em pg_catalog, que continua no caminho
    -- de busca mesmo com search_path = ''.
    v_id := (to_jsonb(new) ->> v_col)::uuid;

    execute format('select t.user_id from public.%I as t where t.id = $1', v_table)
      into v_owner
      using v_id;

    if v_owner is null then
      raise exception
        'Vinculo recusado: a linha % da tabela public.% nao existe ou nao esta visivel para o usuario atual',
        v_id, v_table
        using errcode = 'foreign_key_violation';
    end if;

    if v_owner <> new.user_id then
      raise exception
        'Vinculo recusado: a linha % da tabela public.% pertence a outro usuario',
        v_id, v_table
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.enforce_link_same_owner() is
  'Trigger genérico das tabelas de vínculo: garante que as DUAS pontas pertencem ao new.user_id. As FKs provam que as linhas existem, não que são do mesmo dono. Argumentos aos pares: (tabela, coluna, tabela, coluna).';

-- -----------------------------------------------------------------------------
-- DESVIO DELIBERADO: o trigger cobre INSERT **e** UPDATE.
--
-- O enunciado original pedia só `before insert`, mas o padrão de 4 policies do
-- projeto inclui uma policy de UPDATE, e o `with check` dela também olha apenas
-- o user_id da própria linha. Sem o `or update`, bastaria um UPDATE trocando
-- task_id para reabrir exatamente o buraco que este trigger existe para fechar.
-- O raciocínio que justifica a checagem no INSERT vale, letra por letra, no
-- UPDATE.
-- -----------------------------------------------------------------------------

drop trigger if exists trg_task_capture_links_same_owner on public.task_capture_links;
create trigger trg_task_capture_links_same_owner
  before insert or update on public.task_capture_links
  for each row execute function public.enforce_link_same_owner(
    'tasks', 'task_id', 'captures', 'capture_id'
  );

drop trigger if exists trg_task_event_links_same_owner on public.task_event_links;
create trigger trg_task_event_links_same_owner
  before insert or update on public.task_event_links
  for each row execute function public.enforce_link_same_owner(
    'tasks', 'task_id', 'calendar_events', 'calendar_event_id'
  );

drop trigger if exists trg_capture_event_links_same_owner on public.capture_event_links;
create trigger trg_capture_event_links_same_owner
  before insert or update on public.capture_event_links
  for each row execute function public.enforce_link_same_owner(
    'captures', 'capture_id', 'calendar_events', 'calendar_event_id'
  );

-- =============================================================================
-- TRIGGERS PADRÃO QUE **NÃO** ENTRAM AQUI — leia antes de "corrigir"
--
--   set_updated_at          : não se aplica. Estas tabelas não têm a coluna
--                             `updated_at`, e isso é de propósito: um vínculo
--                             não se edita. Ele existe ou não existe — cria e
--                             apaga. Uma coluna `updated_at` que nunca muda é
--                             uma coluna que mente. `created_at` sozinho já
--                             conta toda a história da linha.
--
--   prevent_user_id_change  : esse trigger é `before update` e serve para
--                             impedir que alguém reatribua a linha a outro
--                             dono. Aqui a proteção equivalente já está em
--                             `enforce_link_same_owner`, que roda no UPDATE e é
--                             ESTRITAMENTE mais forte: além de barrar um
--                             user_id de outra pessoa, exige que as duas pontas
--                             pertençam a ele. Somar os dois só duplicaria a
--                             checagem.
-- =============================================================================

-- =============================================================================
-- 4. RLS + GRANTS (bloco do-loop, no estilo de 0007)
-- =============================================================================
do $$
declare
  t text;
  tbls text[] := array[
    'task_capture_links', 'task_event_links', 'capture_event_links'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %1$s_select on public.%1$I;', t);
    execute format('create policy %1$s_select on public.%1$I
      for select to authenticated using ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_insert on public.%1$I;', t);
    execute format('create policy %1$s_insert on public.%1$I
      for insert to authenticated with check ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_update on public.%1$I;', t);
    execute format('create policy %1$s_update on public.%1$I
      for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_delete on public.%1$I;', t);
    execute format('create policy %1$s_delete on public.%1$I
      for delete to authenticated using ((select auth.uid()) = user_id);', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    -- O papel anônimo nunca enxerga a teia de relacionamentos do usuário.
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end
$$;

-- =============================================================================
-- 5. CONVERSÃO CAPTURA -> TAREFA: o vínculo nasce DENTRO da transação
--
-- `convert_capture_to_task` (criada em 0001) grava `captures.converted_task_id`.
-- A partir desta fase ela grava TAMBÉM a linha em `task_capture_links`.
--
-- POR QUE AQUI, E NÃO NA SERVER ACTION: a função já é transacional — ou tudo
-- acontece, ou nada. Um `insert` separado na action seria uma segunda operação
-- depois de a conversão já ter sido confirmada, e qualquer falha entre as duas
-- (rede caindo, deploy no meio, o processo morrendo) deixaria a captura
-- convertida e o vínculo faltando, sem nada que fizesse a conta bater depois.
-- Estado pela metade que ninguém percebe é pior que erro.
--
-- POR QUE OS DOIS REGISTROS CONVIVEM: `converted_task_id` é uma coluna UNIQUE e
-- carrega uma regra que a tabela de vínculo não tem — "esta captura foi
-- convertida EXATAMENTE UMA VEZ, e é esta a tarefa que nasceu dela". É o que
-- torna a conversão idempotente. `task_capture_links` responde outra pergunta,
-- N:N e sem hierarquia: "estas duas coisas se relacionam". A conversão é o caso
-- em que as duas respostas coincidem, e por isso ela alimenta as duas.
--
-- `create or replace` preserva o corpo de 0001 na íntegra; as ÚNICAS mudanças
-- estão marcadas com "[0009]".
-- =============================================================================

create or replace function public.convert_capture_to_task(p_capture_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_capture    public.captures%rowtype;
  v_task_id    uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the capture row so concurrent calls cannot both insert a task.
  select * into v_capture
  from public.captures
  where id = p_capture_id
  for update;

  if not found then
    raise exception 'capture % not found', p_capture_id;
  end if;

  if v_capture.user_id <> v_uid then
    raise exception 'not authorized';
  end if;

  -- [0009] Antes este ramo fazia `return` direto. Agora ele apenas reaproveita a
  -- tarefa existente e SEGUE para o insert do vínculo lá embaixo. O motivo é
  -- concreto: as capturas convertidas ANTES desta migration não têm vínculo, e
  -- sem passar por aqui a única forma de criá-lo seria o usuário desfazer e
  -- refazer a conversão — o que a coluna UNIQUE não permite. Assim a segunda
  -- chamada conserta o que falta, sem duplicar nada.
  if v_capture.converted_task_id is not null then
    v_task_id := v_capture.converted_task_id;
  else
    insert into public.tasks (user_id, category_id, title, description, source, status, priority)
    values (
      v_capture.user_id,
      v_capture.category_id,
      coalesce(nullif(btrim(coalesce(v_capture.title, '')), ''), left(coalesce(v_capture.content, 'Nova tarefa'), 120)),
      case when v_capture.title is not null and v_capture.content is not null then v_capture.content else null end,
      'manual',
      'todo',
      'medium'
    )
    returning id into v_task_id;

    update public.captures
    set converted_task_id = v_task_id,
        status            = 'organized',
        organized_at      = now()
    where id = p_capture_id;
  end if;

  -- [0009] O vínculo, na MESMA transação da conversão.
  --
  -- `on conflict do nothing` porque a função é idempotente por contrato: chamar
  -- duas vezes devolve a mesma tarefa e não pode explodir na segunda. A PK
  -- composta (task_id, capture_id) é quem detecta o par repetido.
  --
  -- O user_id vem de `v_capture.user_id`, não de `v_uid`: são iguais (a
  -- checagem de propriedade acima garante), mas copiar do dono da linha deixa
  -- explícito que o vínculo herda o dono das pontas. O trigger
  -- `enforce_link_same_owner` confere as duas de qualquer forma.
  insert into public.task_capture_links (task_id, capture_id, user_id)
  values (v_task_id, v_capture.id, v_capture.user_id)
  on conflict do nothing;

  return v_task_id;
end;
$$;

comment on function public.convert_capture_to_task(uuid) is
  'Transaction-safe, idempotent conversion of a capture into a task. Returns the task id. Desde 0009 também grava o vínculo em task_capture_links, na mesma transação.';

-- Repetido de 0001 por idempotência: `create or replace` preserva os grants
-- existentes, mas um banco reconstruído fora de ordem não teria nenhum.
revoke all on function public.convert_capture_to_task(uuid) from public;
grant execute on function public.convert_capture_to_task(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Retroativo: as conversões que já aconteceram também ganham seu vínculo.
--
-- Sem isto, o histórico só existiria daqui para a frente e a tela mostraria
-- "nasceu desta captura" apenas nas tarefas novas — o usuário concluiria que a
-- função é intermitente. A FK `captures.converted_task_id -> tasks (id) on
-- delete set null` garante que um valor não nulo aponta para uma tarefa que
-- EXISTE, então não há órfão a filtrar.
--
-- Idempotente pelo `on conflict do nothing`: rodar a migration de novo não faz
-- nada. Roda como o dono das tabelas, que não é afetado pela RLS, então alcança
-- todos os usuários de uma vez.
-- -----------------------------------------------------------------------------
insert into public.task_capture_links (task_id, capture_id, user_id)
select c.converted_task_id, c.id, c.user_id
from public.captures as c
where c.converted_task_id is not null
on conflict do nothing;

commit;

-- =============================================================================
-- 6. SOFT DELETE — POR QUE **NÃO** HÁ ÍNDICE PARCIAL NOVO EM calendar_events
--
-- A partir desta fase as leituras passam a filtrar cancelados, sempre na forma
-- que respeita NULL:
--
--   where user_id = ? and (status is null or status <> 'cancelled')
--
-- A pergunta natural é se isso pede um índice parcial. Olhando o que JÁ existe
-- em public.calendar_events:
--
--   calendar_events_user_id_idx    (user_id)
--   calendar_events_account_idx    (calendar_account_id)
--   calendar_events_range_idx      (user_id, start_at, end_at)
--   calendar_events_start_date_idx (user_id, start_date)
--
-- O candidato seria:
--
--   (user_id, start_at) where status is null or status <> 'cancelled'
--
-- e ele é REDUNDANTE na prática. Motivos, em ordem de peso:
--
--   1. As chaves são um PREFIXO EXATO de `calendar_events_range_idx`. Esse
--      índice já entrega, de uma vez, o filtro por user_id, o range de start_at
--      e a ORDEM por start_at que `getUpcomingEvents` pede. O parcial não
--      acrescentaria nem chave nem ordenação — acrescentaria apenas o descarte
--      antecipado das linhas canceladas.
--
--   2. Esse descarte vale pouco. Cancelamento é minoria dentro do calendário, e
--      a consulta que mais importa termina em `limit 6`: na prática o
--      planejador pula um punhado de linhas canceladas antes de completar as
--      seis. Trocar isso por um segundo índice sobre as MESMAS colunas é
--      exatamente o "índice por precaução" contra o qual 0008 foi escrita.
--
--   3. O custo cai no pior lugar possível. `calendar_events` é a tabela de
--      escrita mais pesada do projeto: a sincronização faz upsert de TODOS os
--      eventos da janela a cada rodada. Cada índice extra sobre (user_id,
--      start_at) é mantido em cada uma dessas linhas. O parcial encareceria o
--      caminho quente para aliviar o caminho frio.
--
--   4. Índice parcial sobre coluna que MUDA de valor tem armadilha própria: o
--      soft delete altera `status` justamente de/para 'cancelled', o que faz a
--      linha ENTRAR e SAIR do índice a cada mudança de estado — é a escrita mais
--      cara que existe num btree parcial.
--
-- QUANDO REVISITAR: se um dia os cancelados deixarem de ser minoria. Medida
-- (mova para supabase/verificacao.sql se for rodar com frequência):
--
--   select count(*) filter (where status = 'cancelled') as cancelados,
--          count(*)                                     as total,
--          round(100.0 * count(*) filter (where status = 'cancelled')
--                / nullif(count(*), 0), 1)              as pct
--   from public.calendar_events;
--
-- Acima de ~30% de cancelados, e só então, o índice abaixo passa a se pagar.
-- Repare no predicado: `status <> 'cancelled'` sozinho avaliaria para NULL nas
-- linhas de status nulo, que ficariam FORA do índice — e aí a consulta que
-- aceita NULL não poderia usá-lo, que é o pior dos dois mundos (paga-se a
-- manutenção e não se ganha a leitura).
--
--   create index if not exists calendar_events_active_range_idx
--     on public.calendar_events (user_id, start_at)
--     where status is null or status <> 'cancelled';
-- =============================================================================

-- =============================================================================
-- 7. FAXINA PERIÓDICA — NÃO EXECUTADA POR ESTA MIGRATION
--
-- Com o soft delete, evento cancelado deixa de sair da tabela sozinho. Sem
-- faxina, `calendar_events` cresce para sempre.
--
-- A regra é uma só: só some o cancelado ANTIGO e SEM NENHUM VÍNCULO. Apagar um
-- cancelado que tem vínculo destruiria, via `on delete cascade`, exatamente o
-- histórico que esta fase inteira existe para preservar — a reunião cancelada é
-- muitas vezes o motivo pelo qual a tarefa foi criada, e perder a linha do
-- evento apaga a resposta para "de onde veio isto?". É a mesma perda que o
-- `.delete()` de src/lib/google/calendar.ts causava, só que meses depois e sem
-- ninguém percebendo.
--
-- Rodar manualmente, ou por cron do servidor com service_role (a RLS não se
-- aplica a esse papel, então o DELETE alcança todos os usuários de uma vez).
-- Rode primeiro como `select` para conferir o que sairia.
--
-- Note que `status = 'cancelled'` é o lado SEGURO da armadilha de NULL: se
-- status for nulo a comparação vira NULL, a linha não casa e NÃO é apagada.
-- Aqui isso é exatamente o desejado — na dúvida, preserva-se.
--
--   delete from public.calendar_events as e
--   where e.status = 'cancelled'
--     -- Carência: o usuário ainda pode querer ver o que foi cancelado
--     -- recentemente. updated_at é tocado pelo trigger a cada sincronização,
--     -- então mede "tempo desde a última notícia deste evento".
--     and e.updated_at < now() - interval '180 days'
--     and not exists (
--       select 1 from public.task_event_links as l
--       where l.calendar_event_id = e.id
--     )
--     and not exists (
--       select 1 from public.capture_event_links as l
--       where l.calendar_event_id = e.id
--     );
--
-- Versão de conferência (mesmos predicados, sem apagar nada):
--
--   select e.id, e.summary, e.start_at, e.updated_at
--   from public.calendar_events as e
--   where e.status = 'cancelled'
--     and e.updated_at < now() - interval '180 days'
--     and not exists (select 1 from public.task_event_links    as l where l.calendar_event_id = e.id)
--     and not exists (select 1 from public.capture_event_links as l where l.calendar_event_id = e.id)
--   order by e.updated_at;
--
-- Os dois `not exists` são atendidos por task_event_links_event_idx e
-- capture_event_links_event_idx, criados na seção 2 — mais um uso concreto dos
-- índices do lado direito.
-- =============================================================================
