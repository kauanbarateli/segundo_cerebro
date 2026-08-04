-- =============================================================================
-- 0017 — Módulo Projetos
--
-- Uma tabela `projects` + uma coluna `project_id` em QUATRO tabelas existentes.
--
-- =============================================================================
-- POR QUE NÃO A TABELA POLIMÓRFICA, E POR QUE NÃO N TABELAS DE PAR
-- =============================================================================
-- A 0009 já rejeitou o polimorfismo POR ESCRITO: FK polimórfica é impossível no
-- Postgres e produz órfão silencioso. Não se repete aqui.
--
-- O argumento contra N tabelas de par NÃO é contagem de objetos de banco — é o
-- custo em TypeScript. O modelo de vínculos da 0009 custou ~600 linhas
-- (`data.ts`, `RelatedSection.tsx`, `LinkCountBadge.tsx`, `vinculos/actions.ts`).
-- Com `project_id`, "as tarefas do projeto X" é `.eq("project_id", id)`.
--
-- E o risco do `alter table` é VERIFICÁVEL, não opinião: a 0003 já fez
-- `alter table public.tasks add column`; não existe um `.upsert()` sequer nas
-- tabelas afetadas (todo write é `.update()` com whitelist explícita); as
-- leituras principais são `select("*")`, então a coluna chega de graça; e
-- grants são de TABELA enquanto RLS é de LINHA, então a coluna nova herda os
-- dois.
--
-- =============================================================================
-- ⚠️ A COLUNA ENTRA NO CONTÊINER, NUNCA NO ITEM — a decisão que mais importa
-- =============================================================================
-- O desenho inicial punha `project_id` também em `knowledge_pages` e em
-- `drive_files`. Está errado, e o motivo é uma invariante que já existe:
--
--   `knowledge_pages` tem `notebook_id not null` MAIS `parent_id`
--   autorreferente, com trigger obrigando mãe e filha ao mesmo caderno e uma
--   CTE recursiva arrastando a subárvore quando o caderno muda. Um
--   `project_id` ali cria um TERCEIRO contêiner numa árvore que já tem
--   invariante escrita — e nada impediria a página P no projeto A com a filha
--   C no projeto B.
--
-- Onde a coluna fica:
--
--   tasks               ✓  já tem `category_id` nulável; projeto é faceta
--                          ortogonal
--   captures            ✓  idem
--   knowledge_notebooks ✓  o caderno já é contêiner OBRIGATÓRIO da página
--   drive_folders       ✓  a pasta já é o endereço do arquivo
--   knowledge_pages     ✗  terceiro contêiner numa árvore com invariante
--   drive_files         ✗  todo upload na pasta do projeto já nasce no projeto
--   calendar_events     ✗  é cache reescrito por sync
--
-- O GANHO É CONCRETO: "o conhecimento do projeto" = as páginas dos cadernos do
-- projeto, de graça. Zero invariante nova, zero trigger de árvore, zero CTE
-- recursiva — e `createPage`, `movePage`, `registerFile` e `moveFile` NÃO MUDAM
-- UMA LINHA.
--
-- Isso fecha um furo que o desenho original não tinha visto: com a coluna no
-- ITEM, QUATRO caminhos de escrita descartariam `project_id` em silêncio (criar
-- subpágina, registrar upload, mover página, mover arquivo).
--
-- =============================================================================
-- REGRA DE DESEMPATE — escrita aqui porque é onde ela nasce
-- =============================================================================
-- ⚠️ O PROJETO DE UMA CAPTURA É `captures.project_id` E SÓ ELE. Vínculo da 0009
-- NUNCA implica pertencimento a projeto.
--
-- Sem essa frase, toda captura convertida tem duas respostas para "de que
-- projeto é isto?" — a coluna dela e a da tarefa que nasceu dela. A cópia na
-- conversão iguala as duas no t0 e não define nada para o t1: mover a tarefa
-- para outro projeto deixa a captura no antigo. A tela lista "Capturas" e
-- "Tarefas" em seções separadas, então a divergência fica VISÍVEL em vez de
-- silenciosa.
--
-- =============================================================================
-- A AGENDA DO PROJETO NÃO SAI DOS VÍNCULOS DA 0009
-- =============================================================================
-- Ela sai dos campos que as tarefas JÁ TÊM (`due_at`, `scheduled_start_at`,
-- `scheduled_end_at`, `all_day`).
--
-- O cabeçalho da 0009 define vínculo como PROCEDÊNCIA — "esta tarefa nasceu
-- daquela reunião". Derivar a agenda dele transforma procedência em
-- pertencimento: a 1:1 semanal ligada a tarefas de três projetos apareceria nas
-- três agendas, sem forma de tirá-la de uma sem apagar um vínculo que quer
-- dizer outra coisa.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- projects
--
-- SOFT DELETE, casando com `knowledge_notebooks` e `drive_folders`. Apagar um
-- projeto num segundo cérebro não pode ser porta de mão única.
--
-- V1 SÓ AGRUPA: não há status nem prazo próprios. Um projeto com prazo próprio
-- passaria a competir com os prazos das tarefas dele, e a pergunta "este
-- projeto está atrasado?" teria duas respostas.
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text,
  color_key   text not null default 'stone',
  deleted_at  timestamptz,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_name_length check (char_length(name) <= 100),
  constraint projects_description_length check (description is null or char_length(description) <= 2000)
);

comment on table public.projects is
  'Agrupa tarefas, capturas, cadernos e pastas. A coluna project_id fica no CONTEINER (caderno, pasta), nunca no item (pagina, arquivo) — ver o cabecalho da migration. Soft delete, como cadernos e pastas.';

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger trg_projects_lock_user_id
  before update on public.projects
  for each row execute function public.prevent_user_id_change();

-- Nome único entre os VIVOS. Dois projetos "Site" na mesma tela não são
-- distinguíveis, e o seletor de projeto mostraria duas opções idênticas.
create unique index if not exists projects_nome_unico_idx
  on public.projects (user_id, lower(btrim(name)))
  where deleted_at is null;

create index if not exists projects_ativos_idx
  on public.projects (user_id, position, created_at)
  where deleted_at is null;

comment on index public.projects_ativos_idx is
  'Atende "meus projetos, na ordem". Parcial: toda consulta da tela repete deleted_at is null.';

alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.projects to authenticated;

-- ⚠️ EXPLÍCITO, e não zelo: a 0016 já documentou por que não se confia na ordem
-- de aplicação. Toda tabela nova no schema `public` NASCE alcançável, porque o
-- Supabase configura `alter default privileges ... grant all on tables to anon`.
revoke all on table public.projects from anon;


-- -----------------------------------------------------------------------------
-- A coluna, nas quatro tabelas de contêiner.
--
-- ⚠️ `on delete set null` É APENAS BACKSTOP, e precisa estar escrito.
--
-- Com soft delete, ele NUNCA DISPARA: apagar um projeto é um `update` de
-- `deleted_at`, não um `delete`. Ele só serve para um DELETE físico feito pelo
-- console SQL. Sem esta nota, o próximo leitor acha que é a proteção principal
-- — e o modelo produz exatamente o "órfão silencioso" que a 0009 usou como
-- argumento para matar o polimorfismo.
--
-- A proteção REAL é a trigger de guarda, logo abaixo.
-- -----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.captures
  add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.knowledge_notebooks
  add column if not exists project_id uuid references public.projects (id) on delete set null;
alter table public.drive_folders
  add column if not exists project_id uuid references public.projects (id) on delete set null;

comment on column public.tasks.project_id is
  'Projeto ao qual a tarefa pertence. NULO = sem projeto. on delete set null e APENAS backstop: com soft delete ele nunca dispara — quem protege e trg_tasks_project_alive.';
comment on column public.captures.project_id is
  'Projeto da captura. ⚠️ REGRA DE DESEMPATE: o projeto de uma captura e ESTA coluna e so ela. Vinculo da 0009 nunca implica pertencimento a projeto.';
comment on column public.knowledge_notebooks.project_id is
  'Projeto do caderno. A coluna fica no CONTEINER: "o conhecimento do projeto" sao as paginas dos cadernos do projeto, sem coluna nenhuma em knowledge_pages.';
comment on column public.drive_folders.project_id is
  'Projeto da pasta. Todo upload dentro dela ja nasce no projeto, sem coluna em drive_files.';


-- -----------------------------------------------------------------------------
-- ⚠️ A TRIGGER DE GUARDA — a proteção de verdade
--
-- Três detalhes que decidem se ela funciona:
--
--   `security invoker` faz o SELECT passar pela RLS do CHAMADOR. Projeto de
--   outra pessoa é invisível e cai no mesmo `null` de projeto inexistente —
--   resposta idêntica para os três casos (não existe / não é seu / foi
--   apagado), deliberadamente. Distinguir contaria a existência de projeto
--   alheio.
--
--   `when (new.project_id is not null)` NO TRIGGER, e não dentro da função.
--   `tasks` é tabela quente e a maioria das escritas não tem projeto; com a
--   condição na trigger, o caminho comum não paga nem a chamada da função.
--
--   BEFORE COMUM, não `constraint trigger deferrable`. A 0011 só precisou de
--   adiamento por causa da CTE recursiva que arrastava a subárvore. Como este
--   desenho NÃO PROPAGA NADA, a forma barata está disponível — e isso é o
--   pagamento concreto da decisão de pôr a coluna no contêiner.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_project_alive_same_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ok uuid;
begin
  select p.id into v_ok
  from public.projects as p
  where p.id = new.project_id
    and p.deleted_at is null;

  if v_ok is null then
    raise exception 'Projeto % nao existe, nao esta visivel ou foi apagado', new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_project_alive_same_owner() is
  'A FK garante que o projeto existe; nao garante que e SEU nem que esta vivo (a checagem de FK roda como dono, ignora RLS, e soft delete nao dispara set null). security invoker faz o SELECT passar pela RLS do chamador.';

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'captures', 'knowledge_notebooks', 'drive_folders']
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_project_alive', t);
    execute format(
      'create trigger %I before insert or update of project_id on public.%I
         for each row when (new.project_id is not null)
         execute function public.enforce_project_alive_same_owner()',
      'trg_' || t || '_project_alive', t);
  end loop;
end
$$;

-- Função nova não vem no bloco em lote de grants da 0014.
revoke execute on function public.enforce_project_alive_same_owner() from public, anon;
grant execute on function public.enforce_project_alive_same_owner() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Índices parciais
--
-- ⚠️ QUATRO ÍNDICES, E OS QUATRO TÊM CONSULTA DE VERDADE: a tela do projeto
-- lista as quatro coisas. A 0008 existe porque três índices redundantes foram
-- criados "por precaução" e depois cortados — cada um custa disco e deixa TODA
-- escrita mais lenta.
--
-- Parciais em `project_id is not null` porque a maioria das linhas não tem
-- projeto, e indexar o NULL comum seria pagar por linha que ninguém consulta.
--
-- ⚠️ A consulta da tela precisa REPETIR o predicado, senão o planejador não usa
-- o índice parcial.
-- -----------------------------------------------------------------------------
create index if not exists tasks_project_idx
  on public.tasks (project_id, due_at) where project_id is not null;
create index if not exists captures_project_idx
  on public.captures (project_id, created_at desc) where project_id is not null;
create index if not exists knowledge_notebooks_project_idx
  on public.knowledge_notebooks (project_id) where project_id is not null;
create index if not exists drive_folders_project_idx
  on public.drive_folders (project_id) where project_id is not null;

comment on index public.tasks_project_idx is
  'Atende "as tarefas do projeto X, por prazo" — a secao Tarefas e a Agenda da tela do projeto.';
comment on index public.captures_project_idx is
  'Atende "as capturas do projeto X, mais recentes primeiro".';
comment on index public.knowledge_notebooks_project_idx is
  'Atende "os cadernos do projeto X" — e, por consequencia, o conhecimento do projeto inteiro.';
comment on index public.drive_folders_project_idx is
  'Atende "as pastas do projeto X".';


-- =============================================================================
-- convert_capture_to_task — TERCEIRA versão (0001 → 0009 → 0017)
--
-- ⚠️ O RISCO AQUI NÃO É O `project_id`. É A CÓPIA MANUAL.
--
-- O perigo concreto é perder na transcrição o bloco
-- `insert into public.task_capture_links ... on conflict do nothing` que a 0009
-- acrescentou. Isso regride a funcionalidade inteira daquela migration EM
-- SILÊNCIO: os selos de vínculo somem só nas conversões NOVAS, nada falha, nada
-- avisa, e a causa fica a duas migrations de distância.
--
-- Por isso existe `src/test/migracao-0017-conversao-de-captura.test.ts`, que lê
-- este arquivo e afirma sobre a forma da função. As únicas mudanças desta
-- versão estão marcadas com "[0017]".
--
-- ⚠️ E POR QUE O `project_id` PRECISA DE FILTRO PRÓPRIO AQUI:
--
-- Esta função é `security definer` com `set search_path = ''` — roda FORA da
-- RLS. A trigger `enforce_project_alive_same_owner`, que é `security invoker`,
-- avalia aqui como DONA das tabelas e NÃO BARRA NADA. A checagem vira no-op
-- justamente no caminho onde ninguém olha.
--
-- A saída é o subselect abaixo: projeto morto vira NULL em vez de importar o
-- órfão.
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
  -- concreto: as capturas convertidas ANTES daquela migration não têm vínculo, e
  -- sem passar por aqui a única forma de criá-lo seria o usuário desfazer e
  -- refazer a conversão — o que a coluna UNIQUE não permite. Assim a segunda
  -- chamada conserta o que falta, sem duplicar nada.
  --
  -- [0017] E ele NÃO TOCA em `tasks.project_id`. A tarefa já existe e pode ter
  -- sido movida de projeto desde a conversão; reatribuí-la aqui desfaria uma
  -- decisão do usuário toda vez que ele reconvertesse a captura.
  if v_capture.converted_task_id is not null then
    v_task_id := v_capture.converted_task_id;
  else
    insert into public.tasks (user_id, category_id, project_id, title, description, source, status, priority)
    values (
      v_capture.user_id,
      v_capture.category_id,
      -- [0017] O projeto da captura, SE ele ainda estiver vivo. A trigger de
      -- guarda não protege este caminho (ver o cabeçalho), então o filtro mora
      -- aqui. Projeto apagado vira NULL, e a tarefa nasce sem projeto em vez de
      -- nascer órfã.
      (select p.id from public.projects as p
        where p.id = v_capture.project_id and p.deleted_at is null),
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
  'Converte captura em tarefa e cria o vinculo da 0009 na mesma transacao. [0017] Copia project_id da captura, filtrando projeto apagado — a trigger de guarda NAO protege esta funcao, que e security definer e roda fora da RLS. O ramo idempotente nao toca em project_id.';

-- A 0014 revogou EXECUTE de public e anon e concedeu a authenticated e
-- service_role. `create or replace` PRESERVA os grants existentes, então não há
-- o que refazer — registrado aqui para que a ausência seja lida como conclusão.
