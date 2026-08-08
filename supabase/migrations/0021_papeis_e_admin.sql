-- =============================================================================
-- 0021 — PAPÉIS, BLOQUEIO E AUDITORIA ADMINISTRATIVA
--
-- =============================================================================
-- O DIAGNÓSTICO: no DADO já é multiusuário; no PRODUTO, não
-- =============================================================================
-- Uma varredura por "role|is_admin|admin|banned|blocked" em `supabase/` e
-- `src/lib/` devolve apenas `service_role` e o `createAdminClient` — que são
-- infraestrutura do Supabase, não papel de usuário. Não existia nenhuma noção
-- de "quem é o dono deste sistema".
--
-- O que JÁ estava pronto, e é a parte difícil:
--   RLS por usuário em todas as tabelas          (0001)
--   provisionamento automático no cadastro       (0001, handle_new_user)
--   papel anônimo fechado                        (0014)
--   bucket privado                               (0002)
--   credenciais externas cifradas por usuário    (0015)
--
-- Ou seja: usuário A nunca alcançou dado de B, e isso vale desde o primeiro
-- dia. Falta o produto — cadastrar, promover, bloquear.
--
-- =============================================================================
-- ⚠️ O QUE ESTA MIGRATION **NÃO** FAZ, E É A DECISÃO MAIS IMPORTANTE AQUI
-- =============================================================================
-- Ela NÃO altera NENHUMA policy existente.
--
-- A tentação óbvia seria afrouxar as policies de `tasks`, `captures`,
-- `finance_*` para que o master conseguisse ler tudo — e essa seria a mudança
-- mais arriscada possível: um erro numa dessas condições abre o dado de todo
-- mundo para todo mundo, em silêncio, sem nada na tela indicando.
--
-- Em vez disso, o admin opera por Server Action com `service_role`, DEPOIS de
-- uma guarda de papel. O `service_role` ignora RLS por natureza, então não é
-- preciso pedir licença a policy nenhuma. As policies do produto continuam
-- exatamente como estavam: `auth.uid() = user_id`, sem exceção para ninguém.
--
-- Consequência que vale escrever: o master NÃO vê conteúdo alheio pela
-- interface. Ele vê METADADO (quem existe, quando entrou, está bloqueado?). E o
-- COFRE permanece inacessível a ele mesmo com `service_role`, porque é cifrado
-- de ponta a ponta com uma chave derivada da senha mestra do dono — o banco
-- guarda ciphertext, e nenhum papel do Postgres decifra isso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PAPEL
-- -----------------------------------------------------------------------------
-- Tabela separada de `profiles`, e não uma coluna, por dois motivos:
--
--   1. `granted_by` e `granted_at` são sobre a CONCESSÃO, não sobre a pessoa.
--      Numa coluna de perfil eles não teriam onde morar, e "quem promoveu
--      fulano a master?" é exatamente a pergunta que se faz quando algo dá
--      errado.
--   2. Ausência de linha = usuário comum. O caminho normal não escreve nada, e
--      não existe estado "papel nulo" a interpretar.
create type public.user_role as enum ('user', 'admin', 'master');

comment on type public.user_role is
  'user = padrão (sem linha em user_roles). admin = gerencia usuários. master = tudo, e não pode ser removido pelo último.';

create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null,
  -- Nulo quando a concessão veio de migration (o master semeado) e não de
  -- gente. `on delete set null` porque apagar quem promoveu não pode apagar a
  -- promoção — e muito menos derrubar o papel de quem foi promovido.
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Papel do usuário. Ausência de linha significa papel "user" — o caminho normal não escreve nada aqui.';
comment on column public.user_roles.granted_by is
  'Quem concedeu. Nulo = semeado por migration. Preservado mesmo se o concedente for apagado.';

-- -----------------------------------------------------------------------------
-- 2. BLOQUEIO — em `profiles`, e aqui SIM como colunas
-- -----------------------------------------------------------------------------
-- 1:1 com o usuário, sem histórico próprio: uma tabela só para isso seria um
-- join a mais em `getAppContext()`, que roda em TODA navegação do app.
alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists blocked_by uuid references auth.users (id) on delete set null;

-- O CHECK é o que impede um valor inventado por um `update` mal escrito virar
-- um estado que nenhum código sabe tratar — e "status desconhecido" cairia,
-- muito provavelmente, no ramo "deixa passar".
alter table public.profiles
  drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'blocked'));

comment on column public.profiles.status is
  'active | blocked. Verificado em getAppContext() a cada navegação — é o que derruba sessão JÁ EMITIDA. O ban do Auth impede apenas login NOVO.';
comment on column public.profiles.blocked_reason is
  'Texto para o administrador lembrar por quê. NUNCA é mostrado ao usuário bloqueado.';

-- -----------------------------------------------------------------------------
-- 3. AUDITORIA ADMINISTRATIVA
-- -----------------------------------------------------------------------------
-- Precedente no projeto: `vault_audit_events` (0001) e `finance_audit_events`
-- (0005). Mesma forma, mesma disciplina: só INSERT, nunca UPDATE nem DELETE
-- pela aplicação.
--
-- ⚠️ `alvo_id` NÃO tem FK para auth.users, e a ausência é deliberada. O registro
-- mais importante desta tabela é "fulano foi EXCLUÍDO"; com FK e cascade, essa
-- linha seria apagada exatamente no momento em que passa a ser o único vestígio
-- do que aconteceu. Auditoria que some junto com o auditado não é auditoria.
create table if not exists public.admin_audit_events (
  id          uuid primary key default gen_random_uuid(),
  ator_id     uuid references auth.users (id) on delete set null,
  acao        text not null,
  alvo_id     uuid,
  alvo_email  text,
  detalhe     jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.admin_audit_events is
  'Toda ação administrativa. Só INSERT. `alvo_id` sem FK de propósito: o registro de exclusão precisa sobreviver ao usuário excluído.';
comment on column public.admin_audit_events.alvo_email is
  'Copiado no momento da ação. Redundante com auth.users por necessidade: depois da exclusão é o único identificador legível que resta.';

create index if not exists admin_audit_events_ordem_idx
  on public.admin_audit_events (occurred_at desc);

-- -----------------------------------------------------------------------------
-- 4. A FUNÇÃO DE PAPEL — `security definer`, e por quê
-- -----------------------------------------------------------------------------
-- `security definer` porque ela é chamada DE DENTRO das policies de
-- `user_roles`. Com `security invoker`, ler a própria linha para decidir se
-- pode ler a linha seria recursão de policy — o Postgres recusa, e a tabela
-- inteira fica ilegível.
--
-- `set search_path = ''` e todo nome qualificado, como as demais funções do
-- projeto: com o caminho de busca vazio, nada resolve sozinho, e ninguém
-- consegue sequestrar a função criando um objeto de mesmo nome num schema à
-- frente. Numa função `security definer` isso deixa de ser higiene e vira
-- requisito — ela roda com os privilégios do dono.
create or replace function public.papel_do_usuario(alvo uuid)
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  -- `coalesce` para 'user': ausência de linha É o papel comum. Sem ele a
  -- função devolveria null, e null em comparação booleana não é falso — é
  -- null, que costuma ser lido como "deixa passar".
  select coalesce(
    (select r.role from public.user_roles r where r.user_id = alvo),
    'user'::public.user_role
  );
$$;

comment on function public.papel_do_usuario(uuid) is
  'Papel do usuário, com "user" como padrão quando não há linha. security definer para poder ser chamada de dentro das policies de user_roles sem recursão.';

create or replace function public.eh_master()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.papel_do_usuario((select auth.uid())) = 'master'::public.user_role;
$$;

comment on function public.eh_master() is
  'O usuário da sessão é master? Usada nas policies de leitura de user_roles e admin_audit_events.';

-- -----------------------------------------------------------------------------
-- 5. RLS DAS TABELAS NOVAS
-- -----------------------------------------------------------------------------
alter table public.user_roles enable row level security;
alter table public.admin_audit_events enable row level security;

-- Cada um enxerga o PRÓPRIO papel (a interface precisa saber se mostra o link
-- de Admin), e o master enxerga todos.
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using ((select auth.uid()) = user_id or public.eh_master());

-- ⚠️ NENHUMA policy de INSERT, UPDATE ou DELETE — e a ausência é a proteção.
--
-- Com RLS ligada e sem policy de escrita, `authenticated` simplesmente NÃO
-- ESCREVE nesta tabela. Nem o master: promover é operação de `service_role`,
-- depois de `requireMaster()` na Server Action.
--
-- A alternativa (uma policy "master pode inserir") pareceria equivalente e não
-- é: ela deixaria a concessão de papel acontecer por qualquer caminho que
-- alcançasse o PostgREST com um JWT de master — inclusive um `fetch` montado à
-- mão a partir do navegador, sem passar por auditoria nenhuma.

drop policy if exists admin_audit_events_select on public.admin_audit_events;
create policy admin_audit_events_select on public.admin_audit_events
  for select to authenticated using (public.eh_master());

-- Idem: sem policy de INSERT. Quem escreve auditoria é o servidor, e um
-- registro de auditoria que o cliente consegue inserir é um registro que o
-- cliente consegue forjar.

grant select on public.user_roles to authenticated;
grant select on public.admin_audit_events to authenticated;
grant all on public.user_roles to service_role;
grant all on public.admin_audit_events to service_role;
revoke all on public.user_roles from anon;
revoke all on public.admin_audit_events from anon;

-- -----------------------------------------------------------------------------
-- 6. SEMEAR O MASTER
-- -----------------------------------------------------------------------------
-- ⚠️ IDEMPOTENTE, e por e-mail SÓ AQUI.
--
-- O e-mail é a única coisa que esta migration tem para encontrar a pessoa: ela
-- roda antes de qualquer interface existir. Mas ele é usado UMA vez, para
-- descobrir o `user_id` — e o papel passa a viver pelo id dali em diante.
-- Trocar de e-mail depois não muda nada, que é o comportamento certo: e-mail
-- muda, identidade não.
--
-- ⚠️ SE O E-MAIL NÃO EXISTIR, esta migration não faz nada e NÃO FALHA. É
-- deliberado — ela precisa poder rodar num banco vazio (CI, ambiente de teste,
-- clone novo) sem derrubar a suíte de migrations. A contrapartida é conferir
-- depois de aplicar:
--
--     select u.email, r.role
--       from public.user_roles r
--       join auth.users u on u.id = r.user_id;
--
-- Sem nenhuma linha `master`, a área administrativa fica inacessível para todo
-- mundo — que é o modo de falhar correto, mas precisa ser notado.
do $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = 'contas.blacksheep@gmail.com' limit 1;

  if v_id is null then
    raise notice 'Master nao semeado: nenhum usuario com esse e-mail. Rode o select de conferencia depois de criar a conta.';
    return;
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (v_id, 'master', null)
  on conflict (user_id) do update set role = 'master';

  insert into public.admin_audit_events (ator_id, acao, alvo_id, detalhe)
  values (null, 'master_semeado', v_id, jsonb_build_object('origem', 'migration 0021'));
end
$$;
