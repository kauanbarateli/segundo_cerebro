-- =============================================================================
-- Segundo Cérebro — Seed
--
-- Contains NO personal data and NO credentials. Safe to run repeatedly.
--
-- The four starter categories (Trabalho, Estudos, Pessoal, Financeiro) are
-- created automatically for every new user by the `handle_new_user` trigger
-- (see 0001_second_brain_initial.sql). This seed only *backfills* those
-- categories for any users that already existed before the trigger was in
-- place, so it is idempotent and side-effect free on a fresh database.
-- =============================================================================

-- Backfill starter categories for existing users that don't have them yet.
insert into public.categories (user_id, name, color_key, is_system)
select u.id, c.name, c.color_key, true
from auth.users u
cross join (values
  ('Trabalho',   'slate'),
  ('Estudos',    'graphite'),
  ('Pessoal',    'stone'),
  ('Financeiro', 'zinc')
) as c(name, color_key)
on conflict (user_id, normalized_name) do nothing;

-- Ensure every existing user has a preferences row (idempotent).
insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Ensure every existing user has a profile row (idempotent).
insert into public.profiles (id, display_name)
select id, split_part(coalesce(email, ''), '@', 1)
from auth.users
on conflict (id) do nothing;
