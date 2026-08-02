-- =============================================================================
-- Segundo Cérebro — Initial schema
-- Migration: 0001_second_brain_initial.sql
--
-- Runs both in the Supabase SQL Editor and via `supabase db push` / the CLI.
-- All personal tables are protected by Row Level Security (RLS). Sensitive
-- credential material (Google refresh tokens, vault ciphertext) is never
-- readable by the `anon` or `authenticated` roles from the browser.
--
-- Design notes are inline as COMMENT ON / -- comments next to each decision.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;   -- gen_random_uuid()
create extension if not exists "citext"   with schema extensions;   -- case-insensitive email

-- =============================================================================
-- ENUM TYPES
-- Prescriptive value sets from the product spec. New values can be appended
-- later with `alter type ... add value`, so the schema stays growth-friendly
-- without allowing arbitrary strings today.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'theme_preference') then
    create type public.theme_preference as enum ('light', 'dark', 'system');
  end if;
  if not exists (select 1 from pg_type where typname = 'day_mode') then
    create type public.day_mode as enum ('focused', 'light', 'recovery');
  end if;
  if not exists (select 1 from pg_type where typname = 'calendar_view') then
    create type public.calendar_view as enum ('day', 'week', 'month', 'list');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('todo', 'in_progress', 'done', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_source') then
    create type public.task_source as enum ('manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'capture_type') then
    create type public.capture_type as enum ('idea', 'task', 'note', 'reminder');
  end if;
  if not exists (select 1 from pg_type where typname = 'capture_status') then
    create type public.capture_status as enum ('draft', 'inbox', 'organized', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'calendar_account_status') then
    create type public.calendar_account_status as enum ('connected', 'expired', 'error', 'disconnected');
  end if;
  if not exists (select 1 from pg_type where typname = 'vault_item_type') then
    create type public.vault_item_type as enum ('login', 'account', 'document', 'financial', 'secure_note');
  end if;
end
$$;

-- =============================================================================
-- SHARED TRIGGER FUNCTIONS
-- =============================================================================

-- Generic updated_at maintenance. `search_path` is pinned so the function is
-- immune to search_path hijacking when invoked by other roles.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: keeps updated_at in sync. search_path pinned to empty for safety.';

-- Prevents a row from being re-homed to a different user during an UPDATE.
-- Without this, an UPDATE policy that only checks the *existing* user_id could
-- let a user hand a row to someone else (or steal ownership).
create or replace function public.prevent_user_id_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable and cannot be changed';
  end if;
  return new;
end;
$$;
comment on function public.prevent_user_id_change() is
  'BEFORE UPDATE trigger: forbids reassigning user_id to another user.';

-- =============================================================================
-- PROFILES
-- One row per auth.users row. Created automatically by a trigger on signup.
-- =============================================================================
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  timezone     text        not null default 'America/Sao_Paulo',
  locale       text        not null default 'pt-BR',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Public profile data, 1:1 with auth.users.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- USER PREFERENCES
-- =============================================================================
create table public.user_preferences (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  theme                 public.theme_preference not null default 'system',
  day_mode              public.day_mode         not null default 'focused',
  week_starts_on        smallint                not null default 0,   -- 0 = Sunday, 1 = Monday
  default_calendar_view public.calendar_view    not null default 'week',
  created_at            timestamptz             not null default now(),
  updated_at            timestamptz             not null default now(),
  constraint user_preferences_week_starts_on_check check (week_starts_on between 0 and 6)
);
comment on table public.user_preferences is 'Per-user UI/behavior preferences.';

create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- =============================================================================
-- NEW-USER BOOTSTRAP
-- After a user is created in auth.users, provision a profile, default
-- preferences, and the starter category set. SECURITY DEFINER so it can write
-- to these tables regardless of the (absent) session at signup time.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Starter categories (see spec 1.3). Names are normalized on insert below.
  insert into public.categories (user_id, name, color_key, is_system)
  values
    (new.id, 'Trabalho',  'slate',   true),
    (new.id, 'Estudos',   'graphite',true),
    (new.id, 'Pessoal',   'stone',   true),
    (new.id, 'Financeiro','zinc',    true)
  on conflict do nothing;

  return new;
end;
$$;
comment on function public.handle_new_user() is
  'Trigger on auth.users insert: bootstraps profile, preferences and starter categories.';

-- =============================================================================
-- CATEGORIES
-- Owned per-user, unique by normalized name.
-- =============================================================================
create table public.categories (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  -- normalized_name is a generated column used only for the uniqueness constraint,
  -- so "Trabalho" and "trabalho " collide.
  normalized_name text generated always as (lower(btrim(name))) stored,
  color_key       text not null default 'stone',
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint categories_name_not_blank check (btrim(name) <> ''),
  constraint categories_user_normalized_name_key unique (user_id, normalized_name)
);
comment on table public.categories is 'User-owned task/capture categories. Unique by normalized name per user.';
comment on column public.categories.is_system is 'True for the four starter categories seeded on signup.';

create index categories_user_id_idx on public.categories (user_id);

create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();
create trigger trg_categories_lock_user_id
  before update on public.categories
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- TAGS
-- =============================================================================
create table public.tags (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tags_name_not_blank check (btrim(name) <> ''),
  constraint tags_user_normalized_name_key unique (user_id, normalized_name)
);
comment on table public.tags is 'User-owned tags. Unique by normalized name per user.';

create index tags_user_id_idx on public.tags (user_id);

create trigger trg_tags_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();
create trigger trg_tags_lock_user_id
  before update on public.tags
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- TASKS
-- =============================================================================
create table public.tasks (
  id                 uuid primary key default extensions.gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  category_id        uuid references public.categories (id) on delete set null,
  title              text not null,
  description        text,
  status             public.task_status   not null default 'todo',
  priority           public.task_priority not null default 'medium',
  due_at             timestamptz,
  scheduled_start_at timestamptz,
  scheduled_end_at   timestamptz,
  all_day            boolean not null default false,
  estimated_minutes  integer,
  source             public.task_source not null default 'manual',
  completed_at       timestamptz,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tasks_title_not_blank check (btrim(title) <> ''),
  constraint tasks_estimated_minutes_positive check (estimated_minutes is null or estimated_minutes > 0),
  constraint tasks_schedule_order check (
    scheduled_start_at is null
    or scheduled_end_at is null
    or scheduled_end_at >= scheduled_start_at
  )
);
comment on table public.tasks is 'Manually managed tasks. source is always ''manual'' in v1.';

-- Indexes backing the common filters (spec 1.3) and RLS user_id lookups.
create index tasks_user_id_idx     on public.tasks (user_id);
create index tasks_status_idx      on public.tasks (user_id, status);
create index tasks_due_at_idx      on public.tasks (user_id, due_at);
create index tasks_category_id_idx on public.tasks (category_id);
create index tasks_created_at_idx  on public.tasks (user_id, created_at desc);

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger trg_tasks_lock_user_id
  before update on public.tasks
  for each row execute function public.prevent_user_id_change();

-- Keep completed_at/archived_at consistent with status transitions.
create or replace function public.sync_task_lifecycle_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  if new.status = 'archived' and (old.status is distinct from 'archived') then
    new.archived_at := coalesce(new.archived_at, now());
  elsif new.status <> 'archived' then
    new.archived_at := null;
  end if;

  return new;
end;
$$;
comment on function public.sync_task_lifecycle_timestamps() is
  'Keeps completed_at/archived_at aligned with status changes.';

create trigger trg_tasks_lifecycle
  before insert or update on public.tasks
  for each row execute function public.sync_task_lifecycle_timestamps();

-- =============================================================================
-- TASK_TAGS (join)
-- =============================================================================
create table public.task_tags (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, tag_id)
);
comment on table public.task_tags is 'Many-to-many between tasks and tags. user_id denormalized for RLS.';

create index task_tags_user_id_idx on public.task_tags (user_id);
create index task_tags_tag_id_idx  on public.task_tags (tag_id);

-- =============================================================================
-- CAPTURES (inbox)
-- =============================================================================
create table public.captures (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  type              public.capture_type   not null default 'note',
  title             text,
  content           text,
  status            public.capture_status not null default 'inbox',
  category_id       uuid references public.categories (id) on delete set null,
  converted_task_id uuid references public.tasks (id) on delete set null,
  captured_at       timestamptz not null default now(),
  organized_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A capture may only point at one task, and that link is what makes
  -- convert-to-task idempotent (see convert_capture_to_task below).
  constraint captures_converted_task_unique unique (converted_task_id)
);
comment on table public.captures is 'Inbox items. A ''task'' capture can be converted into a tasks row exactly once.';

create index captures_user_id_idx on public.captures (user_id);
create index captures_status_idx  on public.captures (user_id, status);
create index captures_type_idx    on public.captures (user_id, type);

create trigger trg_captures_updated_at
  before update on public.captures
  for each row execute function public.set_updated_at();
create trigger trg_captures_lock_user_id
  before update on public.captures
  for each row execute function public.prevent_user_id_change();

-- Convert a capture into a task inside a single transaction.
-- Idempotent: if the capture was already converted, the existing task id is
-- returned instead of creating a duplicate. SECURITY DEFINER + explicit
-- ownership check so it cannot touch another user's rows.
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

  -- Already converted → return the existing task, do not duplicate.
  if v_capture.converted_task_id is not null then
    return v_capture.converted_task_id;
  end if;

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

  return v_task_id;
end;
$$;
comment on function public.convert_capture_to_task(uuid) is
  'Transaction-safe, idempotent conversion of a capture into a task. Returns the task id.';

-- =============================================================================
-- GOOGLE CALENDAR — account metadata (non-sensitive)
-- Max two accounts per user, one per slot, no duplicate Google identity.
-- =============================================================================
create table public.calendar_accounts (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  slot           smallint not null,
  google_subject text not null,                 -- Google `sub` claim (stable account id)
  email          extensions.citext,
  display_name   text,
  color_key      text not null default 'graphite',
  status         public.calendar_account_status not null default 'connected',
  scopes         text[] not null default '{}',
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Only slots 1 and 2 exist → hard cap of two accounts per user.
  constraint calendar_accounts_slot_check check (slot in (1, 2)),
  -- One account per slot.
  constraint calendar_accounts_user_slot_key unique (user_id, slot),
  -- The same Google account cannot be connected twice for the same user.
  constraint calendar_accounts_user_subject_key unique (user_id, google_subject)
);
comment on table public.calendar_accounts is
  'Non-sensitive Google account metadata. Slot in {1,2} enforces the two-account limit in the database, not just the UI.';

create index calendar_accounts_user_id_idx on public.calendar_accounts (user_id);

create trigger trg_calendar_accounts_updated_at
  before update on public.calendar_accounts
  for each row execute function public.set_updated_at();
create trigger trg_calendar_accounts_lock_user_id
  before update on public.calendar_accounts
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- GOOGLE CALENDAR — calendars within each account
-- =============================================================================
create table public.calendar_sources (
  id                  uuid primary key default extensions.gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  calendar_account_id uuid not null references public.calendar_accounts (id) on delete cascade,
  google_calendar_id  text not null,
  summary             text,
  description         text,
  timezone            text,
  access_role         text,
  background_color    text,
  is_primary          boolean not null default false,
  is_enabled          boolean not null default true,
  next_sync_token     text,
  watch_channel_id    text,
  watch_resource_id   text,
  watch_expiration    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint calendar_sources_account_calendar_key unique (calendar_account_id, google_calendar_id)
);
comment on table public.calendar_sources is
  'Individual Google calendars within an account. Watch* columns are reserved for future push channels (not used in v1).';

create index calendar_sources_user_id_idx on public.calendar_sources (user_id);
create index calendar_sources_account_idx on public.calendar_sources (calendar_account_id);

create trigger trg_calendar_sources_updated_at
  before update on public.calendar_sources
  for each row execute function public.set_updated_at();
create trigger trg_calendar_sources_lock_user_id
  before update on public.calendar_sources
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- GOOGLE CALENDAR — local event cache
-- =============================================================================
create table public.calendar_events (
  id                  uuid primary key default extensions.gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  calendar_account_id uuid not null references public.calendar_accounts (id) on delete cascade,
  calendar_source_id  uuid not null references public.calendar_sources (id) on delete cascade,
  google_event_id     text not null,
  etag                text,
  status              text,                       -- confirmed | tentative | cancelled
  summary             text,
  description         text,
  location            text,
  html_link           text,
  start_at            timestamptz,
  end_at              timestamptz,
  start_date          date,                       -- populated for all-day events
  end_date            date,
  all_day             boolean not null default false,
  organizer           text,
  attendees           jsonb,
  conference_data     jsonb,
  recurring_event_id  text,
  original_start_time timestamptz,
  created_at_google   timestamptz,
  updated_at_google   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Upsert key: one cached row per (calendar, google event).
  constraint calendar_events_source_event_key unique (calendar_source_id, google_event_id)
);
comment on table public.calendar_events is 'Read-only local cache of Google Calendar events. Upserted by sync via (calendar_source_id, google_event_id).';

create index calendar_events_user_id_idx    on public.calendar_events (user_id);
create index calendar_events_account_idx    on public.calendar_events (calendar_account_id);
create index calendar_events_range_idx      on public.calendar_events (user_id, start_at, end_at);
create index calendar_events_start_date_idx on public.calendar_events (user_id, start_date);

create trigger trg_calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();
create trigger trg_calendar_events_lock_user_id
  before update on public.calendar_events
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- GOOGLE OAUTH CREDENTIALS  (BACKEND ONLY — never reachable from the browser)
-- Refresh tokens are stored AES-256-GCM encrypted (ciphertext + iv), never in
-- plaintext. This table has RLS enabled with NO policies, and all grants are
-- revoked from anon/authenticated. Only the service_role (which bypasses RLS)
-- can read it, exclusively from server-side code.
-- =============================================================================
create table public.google_oauth_credentials (
  calendar_account_id      uuid primary key references public.calendar_accounts (id) on delete cascade,
  refresh_token_ciphertext bytea not null,
  refresh_token_iv         bytea not null,
  token_expires_at         timestamptz,
  crypto_version           smallint not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
comment on table public.google_oauth_credentials is
  'SERVER ONLY. Encrypted Google refresh tokens. RLS on with no policies + revoked grants => inaccessible to anon/authenticated. Reachable only via service_role.';

create trigger trg_google_oauth_credentials_updated_at
  before update on public.google_oauth_credentials
  for each row execute function public.set_updated_at();

-- =============================================================================
-- VAULT — master key wrapper (per user)
-- The plaintext master password NEVER reaches the server. The browser derives
-- a key from it (Argon2id) and uses that to wrap a random data key. We only
-- store the wrapped data key, the wrap IV, and the KDF parameters/salt.
-- =============================================================================
create table public.vault_master_keys (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  wrapped_data_key bytea not null,
  wrap_iv          bytea not null,
  kdf_salt         bytea not null,
  kdf_algorithm    text  not null default 'argon2id',
  kdf_parameters   jsonb not null,
  crypto_version   smallint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.vault_master_keys is
  'Wrapped vault data key + KDF params. Never stores the master password. Decryption happens only in the browser.';

create trigger trg_vault_master_keys_updated_at
  before update on public.vault_master_keys
  for each row execute function public.set_updated_at();

-- =============================================================================
-- VAULT — items (all sensitive fields inside encrypted_payload)
-- =============================================================================
create table public.vault_items (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  item_type         public.vault_item_type not null,
  encrypted_payload bytea not null,   -- AES-256-GCM ciphertext of the whole record
  item_iv           bytea not null,
  crypto_version    smallint not null default 1,
  favorite          boolean not null default false,
  display_order     integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
comment on table public.vault_items is
  'Vault entries. Service name, username, password, URL, notes, custom fields — everything sensitive — live inside encrypted_payload. The server only ever sees ciphertext.';

create index vault_items_user_id_idx on public.vault_items (user_id);
create index vault_items_active_idx  on public.vault_items (user_id, item_type) where deleted_at is null;

create trigger trg_vault_items_updated_at
  before update on public.vault_items
  for each row execute function public.set_updated_at();
create trigger trg_vault_items_lock_user_id
  before update on public.vault_items
  for each row execute function public.prevent_user_id_change();

-- =============================================================================
-- VAULT — audit trail (metadata only, never secrets)
-- =============================================================================
create table public.vault_audit_events (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  vault_item_id uuid references public.vault_items (id) on delete set null,
  action        text not null,          -- unlocked | locked | item_created | item_viewed | ...
  occurred_at   timestamptz not null default now(),
  metadata      jsonb
);
comment on table public.vault_audit_events is
  'Non-sensitive audit metadata only. NEVER store passwords, decrypted content or keys here.';

create index vault_audit_events_user_id_idx on public.vault_audit_events (user_id, occurred_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY
-- Every personal table gets RLS + explicit SELECT/INSERT/UPDATE/DELETE policies
-- scoped to the owner via `(select auth.uid()) = user_id`, TO authenticated.
-- The `(select auth.uid())` form lets Postgres cache the value per-statement.
-- =============================================================================

-- profiles / user_preferences key on the PK (id / user_id).
alter table public.profiles         enable row level security;
alter table public.user_preferences enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

create policy user_preferences_select on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_preferences_insert on public.user_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_preferences_update on public.user_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy user_preferences_delete on public.user_preferences
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Helper block: for every owner-keyed table, create the four policies.
do $$
declare
  t text;
  owner_keyed_tables text[] := array[
    'categories', 'tags', 'tasks', 'task_tags', 'captures',
    'calendar_accounts', 'calendar_sources', 'calendar_events',
    'vault_master_keys', 'vault_items', 'vault_audit_events'
  ];
begin
  foreach t in array owner_keyed_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using ((select auth.uid()) = user_id);
    $f$, t);
    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated with check ((select auth.uid()) = user_id);
    $f$, t);
    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    $f$, t);
    execute format($f$
      create policy %1$s_delete on public.%1$I
        for delete to authenticated using ((select auth.uid()) = user_id);
    $f$, t);
  end loop;
end
$$;

-- google_oauth_credentials: RLS ON, NO policies => authenticated/anon get zero
-- rows even if they somehow queried it. service_role bypasses RLS.
alter table public.google_oauth_credentials enable row level security;
-- (intentionally no policies)

-- =============================================================================
-- GRANTS / REVOKES
-- Supabase grants table privileges to anon/authenticated by default via the
-- `public` schema. We explicitly lock down the credential table so it is never
-- exposed to the browser regardless of RLS.
-- =============================================================================
-- Explicit table grants for the authenticated role on every personal table.
-- RLS still restricts *rows*; these grants restrict *operations*. anon gets
-- nothing on personal data.
do $$
declare
  t text;
  authed_tables text[] := array[
    'profiles', 'user_preferences', 'categories', 'tags', 'tasks', 'task_tags',
    'captures', 'calendar_accounts', 'calendar_sources', 'calendar_events',
    'vault_master_keys', 'vault_items', 'vault_audit_events'
  ];
begin
  foreach t in array authed_tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;
end
$$;

-- google_oauth_credentials: never exposed to the browser.
revoke all on table public.google_oauth_credentials from anon, authenticated;
-- service_role keeps its implicit access (bypasses RLS) for server-side use.
grant all on table public.google_oauth_credentials to service_role;

-- Function execution: convert_capture_to_task runs as the authenticated user.
revoke all on function public.convert_capture_to_task(uuid) from public;
grant execute on function public.convert_capture_to_task(uuid) to authenticated, service_role;

-- Bootstrap/utility functions are trigger-invoked; no direct EXECUTE needed by clients.
revoke all on function public.handle_new_user() from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.prevent_user_id_change() from public;
revoke all on function public.sync_task_lifecycle_timestamps() from public;

-- =============================================================================
-- AUTH TRIGGER (created last so referenced tables/functions exist)
-- =============================================================================
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
