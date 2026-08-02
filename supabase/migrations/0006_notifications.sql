-- =============================================================================
-- 0006 — Notificações de reunião (Melhoria #7)
--
-- Fase 7a (em app) usa: preferências + notification_deliveries.
-- Fase 7b (push real) usa também: push_subscriptions.
--
-- pg_cron / pg_net NÃO entram aqui — dependem de extensão habilitada no projeto
-- e da URL de produção. Ver docs/database-setup.md.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Preferências
-- -----------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists notification_lead_minutes smallint[] not null default '{15}',
  add column if not exists notification_channel text not null default 'in_app';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_preferences_notification_channel_check') then
    alter table public.user_preferences
      add constraint user_preferences_notification_channel_check
      check (notification_channel in ('in_app', 'push', 'both'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_preferences_lead_minutes_check') then
    -- Valida também no banco, não só na UI: no máximo 3 lembretes, e apenas
    -- valores do conjunto que a interface oferece.
    alter table public.user_preferences
      add constraint user_preferences_lead_minutes_check
      check (
        array_length(notification_lead_minutes, 1) between 1 and 3
        and notification_lead_minutes <@ array[0, 5, 10, 15, 30, 60, 120]::smallint[]
      );
  end if;
end
$$;

comment on column public.user_preferences.notification_lead_minutes is
  'Antecedências em minutos (até 3). Ex.: {30,5} avisa 30 min e 5 min antes.';

-- -----------------------------------------------------------------------------
-- Entregas — a constraint UNIQUE é a trava de idempotência.
-- Com o cron rodando a cada minuto, sem ela o mesmo lembrete seria reenviado
-- indefinidamente. O despacho faz INSERT ... ON CONFLICT DO NOTHING RETURNING:
-- se voltou linha, é a primeira vez e envia; se não voltou, alguém já enviou.
-- -----------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events (id) on delete cascade,
  lead_minutes      smallint not null,
  channel           text not null,
  scheduled_for     timestamptz not null,
  delivered_at      timestamptz,
  error             text,
  created_at        timestamptz not null default now(),
  constraint notification_deliveries_channel_check check (channel in ('in_app', 'push')),
  constraint notification_deliveries_unique unique (calendar_event_id, lead_minutes, channel)
);
comment on table public.notification_deliveries is
  'Registro de lembretes enviados. A UNIQUE (evento, antecedência, canal) é a trava atômica anti-duplicação.';

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (user_id, scheduled_for)
  where delivered_at is null;

-- -----------------------------------------------------------------------------
-- Inscrições de Web Push (fase 7b)
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);
comment on table public.push_subscriptions is
  'Inscrições Web Push. Apagar a linha quando o serviço responder 404/410 (inscrição morta).';

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array['notification_deliveries', 'push_subscriptions'];
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
  end loop;
end
$$;

commit;
