-- =============================================================================
-- 0018 — Módulo Hábitos diários
--
-- Três tabelas: a REGRA (`habits`), o FATO (`habit_entries`) e a EXCEÇÃO
-- (`habit_pauses`).
--
-- =============================================================================
-- ⚠️ A DECISÃO CENTRAL: REGISTRO ESPARSO. NÃO EXISTE LINHA "FALHOU".
-- =============================================================================
-- `habit_entries` tem UMA LINHA SÓ QUANDO O DIA FOI CUMPRIDO. Não existe
-- `feito boolean`, não existe linha por dia, e desmarcar é `DELETE`.
--
-- O desenho óbvio — uma linha por dia por hábito, com `feito` verdadeiro ou
-- falso — exige alguém escrevendo essas linhas toda meia-noite. Ou seja: um
-- cron. E a 0013 já registrou por escrito por que este projeto não pode
-- depender de `pg_cron`.
--
-- O modo de falha é o que condena o desenho: um cron que não roda uma noite
-- deixa BURACO. O dia não fica nem feito nem falhado, a taxa muda sozinha, e
-- ninguém mexeu em nada. Um número que se move sem causa destrói a confiança no
-- painel inteiro — e o painel é a única coisa que este módulo entrega.
--
-- Com registro esparso, O PASSADO É IMUTÁVEL. Falha, taxa e sequência são
-- DERIVADAS de `started_on` + `schedule_kind` + as pausas, por aritmética pura
-- em `src/lib/habits.ts`. É isso que faz "quantas vezes falhei" ser um número
-- EXATO em vez de depender de um processo ter rodado.
--
-- De quebra: 5 hábitos × 365 dias seriam 1.825 linhas por ano só para dizer que
-- nada aconteceu.
--
-- =============================================================================
-- ⚠️ FUSO HORÁRIO: `date`, NUNCA `timestamptz` — E NUNCA `current_date`
-- =============================================================================
-- O dia de um hábito é um dia CIVIL, não um instante. `timestamptz` convidaria
-- a comparar instantes e a mesma marcação cairia em dias diferentes conforme a
-- hora.
--
-- E `current_date` como default está PROIBIDO nestas tabelas: o servidor da
-- Vercel roda em UTC, então das 21h à meia-noite `current_date` já é o dia
-- SEGUINTE em São Paulo. Marcar um hábito às 22h registraria amanhã. O dia vem
-- da aplicação, por `dayRangeInTimeZone()` — a mesma função que `getEventsForToday`
-- usa, e que existe justamente por causa desse defeito.
--
-- =============================================================================
-- SEQUÊNCIA (STREAK) NÃO É COLUNA
-- =============================================================================
-- Não há `current_streak` aqui. Guardá-la transformaria o módulo num problema
-- de invalidação de cache, e TODOS os gestos legítimos desta tela invalidam:
-- marcar ontem depois do fato, desmarcar, pausa retroativa, mudar a cadência,
-- mudar `started_on`. A sequência é calculada, sempre.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- habits — a REGRA
--
-- A cadência em três formas, e `weekly_target` NÃO é redundante com `weekdays`:
-- "correr 3× por semana" não falha na terça — falha no domingo à noite se não
-- somou três. A unidade da sequência muda junto (dias elegíveis vs. semanas).
--
-- `weekdays` usa 0=domingo..6=sábado, a MESMA numeração de `extract(dow)` do
-- Postgres e de `user_preferences.week_starts_on`. Escolher outra base
-- obrigaria uma tabela de conversão em cada fronteira, e uma dessas conversões
-- seria esquecida.
--
-- `started_on` é `not null` porque sem ele NENHUM número do painel é confiável
-- para trás: sem data de início, "quantas vezes falhei" contaria como falha
-- todo dia desde o começo dos tempos.
-- -----------------------------------------------------------------------------
create table if not exists public.habits (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,

  name           text not null,
  -- Chave de cor, não hex: a paleta é do aplicativo e muda com o tema. Guardar
  -- hex escolhido no claro produziria texto ilegível no escuro.
  color_key      text not null default 'stone',
  icon_key       text,

  schedule_kind  text not null default 'daily'
                 constraint habits_schedule_kind_check
                 check (schedule_kind in ('daily', 'weekdays', 'weekly_target')),

  -- Só para `weekdays`. 0=domingo..6=sábado.
  weekdays       smallint[] not null default '{}',

  -- Só para `weekly_target`. Quantas vezes por semana.
  weekly_target  smallint,

  started_on     date not null,
  archived_at    timestamptz,

  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint habits_name_not_blank check (btrim(name) <> ''),
  constraint habits_name_length check (char_length(name) <= 80),

  -- A COERÊNCIA DA CADÊNCIA, no banco e não só na tela. Sem isto, um
  -- `weekly_target` sem alvo (ou um `weekdays` sem dia) seria uma linha que
  -- nenhuma regra sabe avaliar — e o painel mostraria número inventado.
  constraint habits_weekdays_coerente check (
    (schedule_kind = 'weekdays' and array_length(weekdays, 1) between 1 and 7)
    or (schedule_kind <> 'weekdays' and array_length(weekdays, 1) is null)
  ),
  constraint habits_weekly_target_coerente check (
    (schedule_kind = 'weekly_target' and weekly_target between 1 and 7)
    or (schedule_kind <> 'weekly_target' and weekly_target is null)
  ),
  -- Valores fora de 0..6 não são dia da semana nenhum.
  constraint habits_weekdays_no_intervalo check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

comment on table public.habits is
  'A REGRA de um habito: nome, cadencia e desde quando vale. O FATO fica em habit_entries, que so tem linha quando o dia foi cumprido.';
comment on column public.habits.weekdays is
  'Dias fixos, 0=domingo..6=sabado. Mesma numeracao de extract(dow) e de user_preferences.week_starts_on — nao ha tabela de conversao em lugar nenhum.';
comment on column public.habits.weekly_target is
  'N vezes por semana, sem escolher os dias. Nao e redundante com weekdays: "correr 3x por semana" nao falha na terca, falha no domingo a noite.';
comment on column public.habits.started_on is
  'Desde quando a regra vale. NOT NULL porque sem ele "quantas vezes falhei" contaria falha desde o comeco dos tempos.';
comment on column public.habits.archived_at is
  'Arquivado, no molde de finance_accounts. Some da tela e para de contar, sem apagar o historico.';

create trigger trg_habits_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();

create trigger trg_habits_lock_user_id
  before update on public.habits
  for each row execute function public.prevent_user_id_change();


-- -----------------------------------------------------------------------------
-- habit_entries — o FATO. Uma linha = um dia cumprido.
--
-- A UNIQUE é a trava contra duplo clique e contra duas abas: marcar duas vezes
-- o mesmo dia não pode virar duas linhas, senão "quantas vezes fiz" passa a
-- depender de quantas vezes o botão foi apertado.
--
-- `done_on` é `date` e vem da APLICAÇÃO. Ver o cabeçalho: `current_date` aqui
-- registraria o dia errado toda noite depois das 21h.
-- -----------------------------------------------------------------------------
create table if not exists public.habit_entries (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  habit_id   uuid not null references public.habits (id) on delete cascade,
  done_on    date not null,
  note       text,
  created_at timestamptz not null default now(),

  constraint habit_entries_unique unique (habit_id, done_on),
  constraint habit_entries_note_length check (note is null or char_length(note) <= 500)
);

comment on table public.habit_entries is
  'REGISTRO ESPARSO: uma linha SO quando o dia foi cumprido. Nao existe linha "falhou" — falha e derivada da regra, e por isso nao depende de nenhum processo ter rodado. Desmarcar e DELETE.';
comment on column public.habit_entries.done_on is
  'Dia CIVIL no fuso do aplicativo, vindo de dayRangeInTimeZone(). NUNCA current_date: o servidor roda em UTC e das 21h a meia-noite gravaria o dia seguinte.';

create index if not exists habit_entries_periodo_idx
  on public.habit_entries (user_id, done_on desc);
create index if not exists habit_entries_habito_idx
  on public.habit_entries (habit_id, done_on desc);


-- -----------------------------------------------------------------------------
-- habit_pauses — a EXCEÇÃO. Janelas em que a regra não valia.
--
-- Sem isto, uma semana de férias vira sete falhas e a sequência zera por uma
-- ausência que foi decidida, não sofrida. Um painel que pune férias é um painel
-- que a pessoa para de olhar.
--
-- `ends_on` NULO significa "ainda em curso" — é a pausa aberta, que a tela
-- oferece encerrar.
-- -----------------------------------------------------------------------------
create table if not exists public.habit_pauses (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- NULO = pausa GERAL, vale para todos os hábitos (férias). Preenchido = só
  -- aquele hábito (uma lesão que impede correr, mas não impede ler).
  habit_id   uuid references public.habits (id) on delete cascade,
  starts_on  date not null,
  ends_on    date,
  reason     text,
  created_at timestamptz not null default now(),

  constraint habit_pauses_ordem check (ends_on is null or ends_on >= starts_on),
  constraint habit_pauses_reason_length check (reason is null or char_length(reason) <= 200)
);

comment on table public.habit_pauses is
  'Janelas em que a regra nao valia (ferias, doenca). Sem isto uma semana de ferias vira sete falhas e a sequencia zera por uma ausencia decidida.';
comment on column public.habit_pauses.habit_id is
  'NULO = pausa geral, vale para todos os habitos. Preenchido = so aquele.';
comment on column public.habit_pauses.ends_on is
  'NULO = pausa ainda em curso.';

create index if not exists habit_pauses_periodo_idx
  on public.habit_pauses (user_id, starts_on desc);


-- -----------------------------------------------------------------------------
-- Índices de `habits`
--
-- Um só, e para a consulta que a tela faz: "meus hábitos ativos, na ordem".
-- Parcial em `archived_at is null` porque o arquivado é minoria e ninguém o
-- lista por padrão.
--
-- ⚠️ Toda consulta da tela precisa REPETIR `archived_at is null`, senão o
-- planejador não usa o índice parcial.
-- -----------------------------------------------------------------------------
create index if not exists habits_ativos_idx
  on public.habits (user_id, position, created_at)
  where archived_at is null;

comment on index public.habits_ativos_idx is
  'Atende "meus habitos ativos, na ordem". Parcial: a consulta da tela sempre repete archived_at is null.';

-- Nome único entre os ativos. Dois "Ler" na mesma tela não são distinguíveis, e
-- o painel mostraria duas sequências para o que a pessoa pensa ser uma coisa só.
create unique index if not exists habits_nome_unico_idx
  on public.habits (user_id, lower(btrim(name)))
  where archived_at is null;


-- -----------------------------------------------------------------------------
-- RLS + policies + grants, nas três tabelas
--
-- ⚠️ O `revoke ... from anon` é explícito, e não zelo: a 0014 varreu as tabelas
-- que EXISTIAM naquele momento, e o Supabase configura
-- `alter default privileges ... grant all on tables to anon, authenticated`.
-- Toda tabela nova no schema `public` NASCE alcançável.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['habits', 'habit_entries', 'habit_pauses']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- ⚠️ INTEGRIDADE ENTRE `habit_entries` E O DONO DO HÁBITO
--
-- A FK garante que `habit_id` existe. NÃO garante que o hábito é SEU.
--
-- A checagem de integridade referencial roda com o privilégio do DONO da tabela
-- e IGNORA a RLS — a 0011 já escreveu essa regra. Então, sem esta trigger, um
-- `insert` com o `habit_id` de outra pessoa passaria pela FK; a policy de
-- insert compara `auth.uid() = user_id` da PRÓPRIA linha, que estaria correto.
-- O resultado seria uma marcação minha num hábito alheio.
--
-- Num aplicativo de uma pessoa só isso é teórico — e custa uma linha fechar,
-- enquanto reabrir depois custaria uma migration e uma auditoria de dados.
--
-- `security invoker` faz o SELECT passar pela RLS de quem chama: hábito de
-- outra pessoa é INVISÍVEL e cai no mesmo `null` de hábito inexistente. Resposta
-- idêntica para os dois casos, deliberadamente.
-- -----------------------------------------------------------------------------
create or replace function public.habit_pertence_ao_usuario()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if new.habit_id is null then
    return new;
  end if;

  select h.id into v_id
  from public.habits as h
  where h.id = new.habit_id;

  if v_id is null then
    raise exception 'Habito % nao existe ou nao e seu', new.habit_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

comment on function public.habit_pertence_ao_usuario() is
  'A FK garante que o habito existe; NAO garante que e seu (a checagem de FK roda como dono e ignora RLS). security invoker faz o SELECT passar pela RLS do chamador.';

create trigger trg_habit_entries_dono
  before insert or update of habit_id on public.habit_entries
  for each row execute function public.habit_pertence_ao_usuario();

create trigger trg_habit_pauses_dono
  before insert or update of habit_id on public.habit_pauses
  for each row when (new.habit_id is not null)
  execute function public.habit_pertence_ao_usuario();

-- Função nova não vem no bloco em lote de grants — precisa do revoke explícito.
-- É de trigger (`returns trigger`) e não é chamável diretamente, mas
-- `authenticated` mantém EXECUTE porque as triggers acima rodam como
-- `security invoker` e o privilégio é conferido em tempo de execução.
revoke execute on function public.habit_pertence_ao_usuario() from public, anon;
grant execute on function public.habit_pertence_ao_usuario() to authenticated, service_role;
