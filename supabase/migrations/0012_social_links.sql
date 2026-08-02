-- =============================================================================
-- 0012 — Links de redes sociais do usuário
--
-- OBJETIVO: guardar os endereços que a pessoa quer exibir no perfil (Instagram,
-- LinkedIn, GitHub...), com rótulo próprio e ordem escolhida por ela.
--
-- MODELAGEM — decisão já tomada, registrada aqui para não ser reaberta:
--
--   (a) Campo `jsonb` em public.user_preferences: REJEITADA. Um array jsonb não
--       tem CHECK por elemento, não tem UNIQUE, não tem ordem que o banco saiba
--       ler e não tem como limitar a quantidade. As três regras deste recurso
--       (ordenação, validação de URL e teto de 8) virariam código espalhado
--       entre server action e interface — ou seja, três lugares para esquecer
--       de aplicar, e um caminho de escrita novo já nasce sem nenhuma delas.
--
--   (b) TABELA PRÓPRIA public.social_links: ESCOLHIDA. Ordenação é coluna,
--       validação é CHECK, limite é trigger. Tudo dentro do banco, onde
--       QUALQUER caminho de escrita passa — inclusive o que ainda não existe.
--
-- =============================================================================
-- O PONTO DE SEGURANÇA — por que esta migration não é burocracia
--
-- O valor de `url` vira o atributo `href` de um `<a>`. `href` não é texto: o
-- navegador EXECUTA o esquema. `href="javascript:alert(1)"` roda script na
-- origem do próprio aplicativo, na sessão da pessoa, no mesmo site onde mora o
-- Cofre. O campo "meu Instagram" é, sem tratamento, um XSS armazenado.
--
-- E `z.string().url()` NÃO resolve: por baixo ele monta `new URL()`, e
-- `new URL("javascript:alert(1)")` é uma URL perfeitamente VÁLIDA — só não é
-- navegável. Validade sintática e segurança são perguntas diferentes.
--
-- São TRÊS barreiras, e esta migration é a do meio:
--   1. `urlSegura()` em src/lib/social.ts, chamada pelo schema zod — allowlist
--      de protocolo ("https:" e mais nada). Allowlist, nunca blocklist: uma
--      lista de proibidos esquece `data:`, `vbscript:`, `blob:`, `file:` e as
--      variantes que o navegador tolera ("  javascript:", "JavaScript:",
--      "java\tscript:").
--   2. O CHECK `social_links_url_https` DESTE arquivo — a barreira que continua
--      de pé quando um caminho de escrita futuro (um script de importação, uma
--      rotina com service_role, um `psql` às três da manhã) não passar pelo zod.
--      Barreira que só existe na aplicação é barreira que a próxima função a
--      contorna sem perceber.
--   3. `rel="noopener noreferrer"` no `<a>` (interface) — sem `noopener` o
--      destino recebe `window.opener` e pode trocar o conteúdo da SUA aba por
--      uma tela falsa de login (tabnabbing).
-- Nenhuma substitui as outras: 1 e 2 impedem o esquema perigoso de ENTRAR, 3
-- protege de um destino https legítimo que se comporta mal.
--
-- =============================================================================
-- ARMADILHA DO NULL (já mordeu este projeto — ver o cabeçalho de 0009)
--
-- No Postgres um CHECK só reprova quando o predicado dá FALSE. NULL não é
-- FALSE: `null like 'https://%'` avalia para NULL, e o CHECK trata NULL como
-- APROVADO. Ou seja, com `url` anulável a barreira 2 seria decorativa — bastaria
-- inserir NULL para atravessá-la.
--
-- Por isso `url not null` é PARTE da barreira, não enfeite de modelagem. O mesmo
-- vale para `label` e `position`. Não há aqui nenhum predicado do tipo
-- `coluna <> valor` sobre coluna anulável.
--
-- =============================================================================
-- LIKE ou REGEX no CHECK de https? Decisão e motivo
--
-- Escolhido: `url like 'https://_%'`. Descartado: `url ~* '^https://'`.
--
--   1. `~*` é CASE-INSENSITIVE, e o efeito prático é aceitar `HTTPS://algo`.
--      Isso não é inseguro (o navegador de fato lê o esquema sem diferenciar
--      caixa), mas é INDESEJADO por outro motivo: o único gravador legítimo é
--      `urlSegura()`, que devolve a forma canônica de `URL.toString()` — e essa
--      forma SEMPRE traz o esquema e o host em minúsculas. Uma linha com
--      `HTTPS://` é, por construção, uma linha que NÃO passou pelo canonizador.
--      Recusá-la não custa nada (nenhuma escrita legítima produz isso) e faz o
--      banco reprovar exatamente o caso que interessa detectar.
--
--   2. LIKE é ANCORADO POR CONSTRUÇÃO. Num regex a âncora `^` é um caractere
--      que dá para esquecer, e `url ~* 'https://'` sem âncora aprovaria
--      `javascript:alert("https://")`. Não existe versão desatenta do LIKE que
--      falhe assim: `like 'https://%'` só casa a partir do primeiro caractere.
--      A regra de segurança fica imune ao deslize de digitação.
--
--   3. Regex do Postgres tem modos (`n`, `p`, `w`) em que `^` passa a casar
--      depois de uma quebra de linha. Basta alguém acrescentar uma flag um dia
--      para `"javascript:x\nhttps://ok"` casar. LIKE não tem modos.
--
--   4. Sem motor de regex, o predicado é comparação de prefixo — mais barato em
--      toda escrita, e o planejador entende `like 'constante%'` como faixa.
--
-- O `_` de `'https://_%'` exige PELO MENOS UM caractere depois da barra dupla.
-- Sem ele, a string `https://` sozinha (que `new URL()` recusa, mas um INSERT
-- direto não) seria aprovada como link válido e viraria um `<a>` para lugar
-- nenhum.
--
-- E o teto de tamanho é `octet_length`, não `char_length`, DE PROPÓSITO: o
-- índice único (user_id, url) é um btree, e entrada de btree tem teto de ~2704
-- BYTES. `char_length(url) <= 2048` deixaria passar 2048 caracteres multibyte =
-- até 8192 bytes, e o INSERT morreria com "index row size exceeds maximum" —
-- erro de infraestrutura no lugar de uma recusa limpa. Para a forma canônica
-- isso é indiferente: `URL.toString()` faz punycode no host e percent-encoding
-- no caminho, então a saída é ASCII e `octet_length` == `length` do JavaScript.
-- 2048 é o mesmo número de TAMANHO_MAXIMO_DA_URL em src/lib/social.ts.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- TABELA
-- -----------------------------------------------------------------------------
create table if not exists public.social_links (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  label      text        not null,
  url        text        not null,
  position   integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Rótulo: `btrim(...) <> ''` recusa o campo só com espaços, que na tela vira
  -- um link invisível e inclicável. `label` é NOT NULL, então o predicado nunca
  -- avalia para NULL (ver a armadilha no cabeçalho).
  constraint social_links_label_not_blank check (btrim(label) <> ''),
  -- 40 caracteres cabem em "LinkedIn (empresa)" com folga e não deixam o rótulo
  -- estourar o cartão. Aqui é `char_length`: quem digita conta caracteres, e um
  -- rótulo com acento não pode valer menos que um sem. O `url` usa outra régua
  -- (bytes) por causa do índice — o motivo está no cabeçalho.
  constraint social_links_label_length check (char_length(label) <= 40),

  -- BARREIRA 2. Ver o cabeçalho para LIKE-vs-regex e para o papel do `_`.
  constraint social_links_url_https check (url like 'https://_%'),
  constraint social_links_url_length check (octet_length(url) <= 2048),

  -- Ordem só faz sentido de zero para cima; negativo seria um jeito silencioso
  -- de "furar a fila" que a interface não sabe representar.
  constraint social_links_position_non_negative check (position >= 0),

  -- UNICIDADE — decisão e motivo.
  --
  -- SIM, a mesma URL não pode se repetir para o MESMO usuário. Com apenas 8
  -- vagas, duas linhas idênticas nunca são intenção: são o clique duplo no botão
  -- "salvar" ou o formulário reenviado. Sem esta constraint o resultado é a
  -- pessoa olhando dois cartões iguais sem entender qual apagar — e uma vaga das
  -- oito queimada à toa.
  --
  -- Comparação EXATA, sem `lower(url)`. Não é descuido: a variação de caixa que
  -- não tem significado (esquema e host) já vem normalizada pelo canonizador,
  -- enquanto o CAMINHO é sensível a maiúsculas em boa parte da web —
  -- `/Kauan` e `/kauan` podem ser dois perfis diferentes. Um índice sobre
  -- `lower(url)` fundiria esses dois casos e recusaria um link legítimo.
  --
  -- Nada impede DUAS PESSOAS de terem a mesma URL: a chave começa por user_id.
  constraint social_links_user_url_key unique (user_id, url)
);

comment on table public.social_links is
  'Links de redes sociais exibidos no perfil. Tabela própria, e NÃO um campo jsonb em user_preferences, justamente para que ORDENAÇÃO (coluna position), VALIDAÇÃO (CHECK social_links_url_https) e LIMITE (trigger de 8 linhas) morem no BANCO, e não espalhados pela aplicação: assim qualquer caminho de escrita — inclusive um que ainda não foi escrito — obedece às mesmas regras.';

comment on column public.social_links.label is
  'Rótulo exibido no cartão, escolhido pela pessoa ("Meu GitHub"). Não é derivado da URL: o ícone é que vem do domínio, via iconePorDominio() em src/lib/social.ts.';

comment on column public.social_links.url is
  'Endereço https já na forma canônica de URL.toString() (host em minúsculas, IDN em punycode). Vira o href de um <a>, por isso o CHECK de esquema — ver o comentário da constraint social_links_url_https.';

comment on column public.social_links.position is
  'Ordem de exibição, crescente. Inteiro simples (e não ordenação fracionária tipo lexorank) porque o teto é 8 linhas: reordenar renumera todas de uma vez, dentro de uma transação, e ninguém sente. NÃO é único de propósito — ver o comentário do índice social_links_user_position_idx.';

comment on constraint social_links_url_https on public.social_links is
  'BARREIRA 2 das três contra href perigoso. LIKE (não regex) porque é ancorado por construção e sensível a caixa; o "_" exige ao menos um caractere de host. Barreira 1 é urlSegura() em src/lib/social.ts; barreira 3 é rel="noopener noreferrer" no <a>. Esta aqui é a que continua valendo para quem escrever sem passar pelo zod.';

comment on constraint social_links_user_url_key on public.social_links is
  'Impede o mesmo endereço duas vezes para o mesmo usuário (clique duplo, formulário reenviado). Comparação exata: o caminho da URL é sensível a maiúsculas e lower() fundiria perfis distintos.';

-- -----------------------------------------------------------------------------
-- ÍNDICES
--
-- CONFERÊNCIA ANTES DE CRIAR (a tabela é nova, então a conta é sobre o que esta
-- própria migration cria): a constraint `social_links_user_url_key` já produz um
-- btree em (user_id, url).
--
-- Consequência direta: um índice simples em (user_id) seria PREFIXO ESTRITO
-- desse btree e está DESCARTADO. Ele não aceleraria nada que o índice único já
-- não atenda — nem a leitura por dono, nem a varredura que o `on delete cascade`
-- de auth.users dispara com `where user_id = ?` (o Postgres não indexa sozinho o
-- lado REFERENCIANTE de uma FK, mas qualquer índice com user_id à esquerda
-- resolve). Índice redundante não é neutro: custa disco, é mantido em toda
-- escrita e polui as estatísticas do planejador — o banco fica MAIS LENTO.
--
-- O que resta é o de ORDENAÇÃO, abaixo. Ele não é duplicata: as colunas são
-- outras e a segunda posição é `position`, que é justamente o que entrega
-- `where user_id = ? order by position` sem nó de Sort.
--
-- Honestidade sobre o ganho: com teto de 8 linhas por usuário, ordenar na
-- memória seria praticamente de graça, e sozinho esse argumento não pagaria um
-- índice. O que o paga é o acúmulo — ele é TAMBÉM o índice do lado referenciante
-- da FK (mesmo papel que 0009 documenta nas tabelas de vínculo), e escolher
-- (user_id, position) em vez de (user_id) custa 4 bytes por entrada e dispensa a
-- ordenação. Dois usos, um índice.
-- -----------------------------------------------------------------------------
create index if not exists social_links_user_position_idx
  on public.social_links (user_id, position);

comment on index public.social_links_user_position_idx is
  'Listagem do perfil: where user_id = ? order by position, sem nó de Sort. Serve também ao lado referenciante da FK para auth.users (cascade de exclusão de conta). Um índice só em (user_id) seria prefixo estrito deste e de social_links_user_url_key — por isso não existe. Ver 0012.';

-- =============================================================================
-- LIMITE DE 8 LINKS — por que TRIGGER e não "deixa com a aplicação"
--
-- Um CHECK não serve: ele enxerga apenas a linha que está sendo gravada e não
-- consegue contar as OUTRAS linhas da tabela. As opções reais eram duas:
--
--   (a) validar só na server action — REJEITADA. O comentário da tabela promete,
--       em texto, que o limite está no banco. Promessa que a constraint não
--       cumpre é PIOR que promessa nenhuma: quem lê o comentário para de checar.
--       Este projeto já teve exatamente esse achado. E a validação na aplicação
--       vale só para o caminho que passa por ela — a rotina de importação escrita
--       daqui a seis meses não passa.
--
--   (b) TRIGGER BEFORE INSERT que conta e levanta exceção — ESCOLHIDA.
--
-- POR QUE SÓ `before insert`, sem `or update`: o único UPDATE capaz de aumentar
-- a conta de alguém seria um que trocasse `user_id`, e esse caminho já está
-- fechado pelo trigger `prevent_user_id_change` (0001), que é BEFORE UPDATE e
-- recusa qualquer troca de dono. Somar `or update` aqui só faria toda edição de
-- rótulo pagar um `count(*)` para reprovar nada.
--
-- "BEFORE INSERT" NÃO É O MESMO QUE "LINHA NOVA" — a armadilha que custou um
-- defeito e que a saída antecipada da função existe para fechar. Num
-- `insert ... on conflict (id) do update` (é assim que `reorderSocialLinks`
-- grava a ordem: uma instrução só, para não deixar meia lista renumerada), o
-- Postgres executa as triggers BEFORE INSERT de CADA linha proposta ANTES de
-- descobrir que ela conflita. As linhas que vão terminar no ramo DO UPDATE
-- passam por aqui exatamente como as novas. Sem tratamento, um usuário com as 8
-- vagas ocupadas — o estado que a própria tela incentiva, exibindo "8 de 8" —
-- teria a reordenação inteira abortada com a mensagem de limite, que não tem
-- relação nenhuma com o gesto de arrastar. Pior: com 7 links ou menos tudo
-- funciona, então o defeito não aparece em teste manual.
--
-- CORRIDA ENTRE TRANSAÇÕES — o furo que um `count(*)` sozinho tem: em READ
-- COMMITTED, duas inserções simultâneas com 7 linhas existentes CONTAM 7 CADA
-- UMA (nenhuma enxerga a linha não confirmada da outra), as duas passam e o
-- usuário termina com 9. É improvável vindo de uma interface, mas "improvável"
-- não é o padrão de uma regra que o comentário da tabela chama de garantia.
--
-- Fechado com `pg_advisory_xact_lock` na chave do usuário: a segunda transação
-- espera a primeira terminar e só então conta — aí já enxergando as 8. É a
-- variante _xact_ (e não a de sessão) de propósito: o lock morre junto com a
-- transação, o que é obrigatório atrás do pooler em modo transaction do
-- Supabase, onde a conexão é devolvida ao fim de cada transação e um lock de
-- sessão vazaria para o próximo usuário que herdasse aquela conexão.
-- O escopo do lock é UM USUÁRIO: duas pessoas diferentes nunca se esperam.
--
-- `security invoker` + `set search_path = ''` como as demais funções do projeto,
-- e TODA referência prefixada (public., pg_catalog.) — com o search_path vazio
-- nada resolve sozinho.
--
-- O que `security invoker` implica aqui: o `count(*)` roda SOB A RLS de quem
-- chamou. Para o dono inserindo o próprio link isso é exato (a policy de select
-- mostra todas as linhas dele) e para o service_role também (não há RLS). A
-- suposição embutida é que quem tem INSERT também tem SELECT — verdade em todos
-- os papéis desta migration. Se um dia um papel ganhar INSERT sem SELECT, o
-- count enxergaria zero e o limite ficaria cego: o conserto certo é conceder o
-- SELECT, não trocar para `security definer` (que contaria linhas invisíveis ao
-- chamador e transformaria a mensagem de erro num vazamento de existência).
-- =============================================================================
create or replace function public.enforce_social_links_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Espelha LIMITE_DE_LINKS de src/lib/social.ts. Se um dia mudar, muda nos
  -- dois lugares: interface prometendo 10 e banco recusando o nono é o mesmo
  -- defeito, só que mais difícil de diagnosticar.
  v_limite constant integer := 8;
  v_total  integer;
begin
  -- Serializa por usuário antes de contar (ver "CORRIDA ENTRE TRANSAÇÕES").
  -- hashtextextended devolve bigint, que é a assinatura de uma chave só.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  -- LINHA QUE JÁ EXISTE NÃO AUMENTA A CONTA — logo, não é assunto do limite.
  --
  -- Esta saída não é otimização: é o que faz a reordenação funcionar para quem
  -- está no teto (ver "BEFORE INSERT NÃO É O MESMO QUE LINHA NOVA" no cabeçalho).
  -- Se o id proposto já está na tabela, a instrução ou cai no ramo DO UPDATE, ou
  -- — num INSERT comum, sem ON CONFLICT — morre na chave primária. Em nenhum dos
  -- dois casos o total de linhas do usuário cresce, então contar aqui só serviria
  -- para reprovar o que já era inofensivo.
  --
  -- DEPOIS do advisory lock de propósito: assim esta leitura e o count abaixo
  -- enxergam o mesmo estado confirmado, sem uma janela entre as duas em que outra
  -- transação apague a linha e o "já existe" fique desatualizado.
  --
  -- `security invoker` faz este EXISTS rodar sob a RLS de quem chamou: um id de
  -- OUTRO dono não volta, o teste dá falso e a linha segue para a contagem — que
  -- é o que se quer, porque para o chamador aquela linha realmente seria nova (e
  -- a policy de UPDATE do ON CONFLICT recusa a instrução logo em seguida).
  if exists (select 1 from public.social_links where id = new.id) then
    return new;
  end if;

  select count(*)
    into v_total
  from public.social_links
  where user_id = new.user_id;

  -- BEFORE INSERT: a linha nova ainda não está na tabela, então já ter v_limite
  -- linhas significa que esta seria a de número v_limite + 1.
  if v_total >= v_limite then
    raise exception
      'Limite de % links sociais por usuario atingido', v_limite
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_social_links_limit() is
  'BEFORE INSERT em public.social_links: recusa a nona linha do mesmo usuário. Existe porque o comentário da tabela promete o limite no BANCO, e CHECK não conta outras linhas. Usa pg_advisory_xact_lock por usuário para fechar a corrida entre inserções simultâneas. Sai antes de contar quando o id proposto JÁ EXISTE: num insert ... on conflict do update as triggers BEFORE INSERT rodam antes da detecção do conflito, e sem essa saída a reordenação de quem está nas 8 vagas seria abortada pelo limite. Mensagem sem acentos e SQLSTATE 23514 (check_violation) para a server action reconhecer o caso.';

drop trigger if exists trg_social_links_limit on public.social_links;
create trigger trg_social_links_limit
  before insert on public.social_links
  for each row execute function public.enforce_social_links_limit();

-- -----------------------------------------------------------------------------
-- TRIGGERS PADRÃO
--
-- Bloco do-loop no estilo de 0007/0009. Com uma tabela só ele parece exagero,
-- mas mantém a forma idêntica à do resto do projeto (quem for comparar arquivos
-- não vai concluir que aqui faltou alguma coisa) e uma segunda tabela do módulo
-- entra com uma palavra no array.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array['social_links'];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I
      for each row execute function public.set_updated_at();', t);

    execute format('drop trigger if exists trg_%1$s_lock_user_id on public.%1$I;', t);
    execute format('create trigger trg_%1$s_lock_user_id before update on public.%1$I
      for each row execute function public.prevent_user_id_change();', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- RLS + GRANTS
--
-- `revoke all ... from anon` importa mais aqui do que parece: são links
-- PÚBLICOS por natureza, e é tentador liberar leitura anônima "porque é público
-- mesmo". Não é o mesmo público. A tabela inteira, lida sem filtro, entrega a
-- lista de perfis sociais de TODOS os usuários do aplicativo a quem tiver a
-- chave anônima — que, sendo publicada no navegador, é qualquer pessoa. Se um
-- dia existir uma página de perfil pública, ela deve expor UM usuário por vez,
-- por uma view com filtro explícito, e não abrindo a tabela.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array['social_links'];
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
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end
$$;

commit;

-- =============================================================================
-- CONFERÊNCIA DEPOIS DE APLICAR (não roda nada; copie e cole no SQL editor)
--
-- 1. Nenhuma URL perigosa atravessou. Esperado: ZERO linhas.
--    Repare que a consulta do BLOCO 11 de supabase/verificacao.sql usa
--    `url !~* '^https://'`, que é propositalmente MAIS FROUXA que o CHECK deste
--    arquivo (ela aceitaria `HTTPS://`). Não há contradição: o CHECK impede a
--    linha de existir, e a conferência é a rede embaixo dela.
--
--      select id, label, url from public.social_links where url not like 'https://_%';
--
-- 2. O limite realmente está de pé. Esperado: ZERO linhas.
--
--      select user_id, count(*) as total
--      from public.social_links
--      group by user_id
--      having count(*) > 8;
--
-- 3. Nenhum índice redundante nasceu aqui. Esperado: exatamente TRÊS linhas —
--    social_links_pkey (da PK), social_links_user_url_key (da constraint UNIQUE)
--    e social_links_user_position_idx. Se aparecer um quarto começando por
--    (user_id) sozinho, alguém acrescentou o prefixo estrito que este arquivo
--    descartou de propósito.
--
--      select indexname, indexdef from pg_indexes
--      where schemaname = 'public' and tablename = 'social_links'
--      order by indexname;
-- =============================================================================
