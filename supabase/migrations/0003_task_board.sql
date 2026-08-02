-- =============================================================================
-- 0003 — Kanban nas Tarefas (Melhoria #3)
--
-- Índice fracionário (`numeric`) para ordenar dentro da coluna: mover um card
-- custa 1 UPDATE, independente do tamanho da coluna.
-- =============================================================================

begin;

alter table public.tasks
  add column if not exists board_position numeric;

comment on column public.tasks.board_position is
  'Ordem dentro da coluna do Kanban. Índice fracionário: inserir entre A e B = (A+B)/2, então mover = 1 UPDATE.';

-- Backfill determinístico com a ordenação que a lista já usava.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, status
           order by due_at nulls last, created_at desc
         )::numeric as pos
  from public.tasks
  where board_position is null
)
update public.tasks t
set board_position = r.pos
from ranked r
where r.id = t.id;

-- Índice que serve exatamente à query do quadro.
create index if not exists tasks_board_idx
  on public.tasks (user_id, status, board_position);

-- Preferência de visualização (lista ou quadro).
-- text + check em vez de enum: `ALTER TYPE ... ADD VALUE` não permite usar o
-- valor novo na mesma transação, e todas as migrations rodam em begin/commit.
alter table public.user_preferences
  add column if not exists default_task_view text not null default 'list';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_preferences_default_task_view_check'
  ) then
    alter table public.user_preferences
      add constraint user_preferences_default_task_view_check
      check (default_task_view in ('list', 'board'));
  end if;
end
$$;

-- Limpeza de dívida técnica: 'list' saiu da UI do Calendário (só restaram
-- day/week/month), mas pode estar gravado de versões anteriores.
update public.user_preferences
set default_calendar_view = 'week'
where default_calendar_view = 'list';

commit;
