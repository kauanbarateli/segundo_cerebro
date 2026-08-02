-- =============================================================================
-- 0011 — Conhecimento (cadernos, páginas, editor e busca)
--
-- ESCOPO CONGELADO DA v1: caderno, página, editor, bloco de código, busca.
-- Ficam DE FORA por decisão registrada no plano: colar imagem, favoritos,
-- lixeira, exportar PDF, histórico de versões. Nenhum deles tem coluna, tabela
-- ou índice aqui, e a ausência é deliberada — o custo desses recursos não é o
-- código, é a superfície que passa a exigir manutenção e teste.
--
-- (A coluna `deleted_at` existe nas duas tabelas porque é o padrão de soft
-- delete do projeto inteiro e porque `select` sem ela seria a exceção. Isso NÃO
-- é a lixeira: não há índice de lixeira, não há tela e não há restauração. Toda
-- leitura da v1 filtra `deleted_at is null`.)
--
-- MODELO DE DADOS — decidido no plano, registrado aqui para não ser reaberto:
--
--   content como jsonb, NÃO HTML
--     Editores ProseMirror trabalham com documento estruturado. JSON evita
--     sanitizar HTML — onde nascem os XSS — e permite migrar o schema do editor
--     depois sem reprocessar string.
--
--   content_text em coluna separada
--     Não existe busca textual decente dentro de jsonb aninhado. Um TRIGGER
--     extrai o texto plano na ESCRITA; a busca lê a coluna. Escrever é mais
--     raro que buscar, então o custo fica no lado certo da conta.
--
--   Trigger anti-ciclo reaproveitada do Drive (0007)
--     Hierarquia de páginas tem exatamente o mesmo risco de laço infinito na
--     montagem do breadcrumb.
--
--   Índices únicos PARCIAIS reaproveitados do Drive (0007)
--     O padrão está aplicado em `knowledge_notebooks`. Em `knowledge_pages` ele
--     foi CONSIDERADO E RECUSADO — a seção 2.4 explica por quê, em detalhe.
--
-- ARMADILHAS TRATADAS AQUI (as três que já morderam este projeto):
--
--   1. NULL <> NULL. `unique (notebook_id, parent_id, lower(btrim(title)))`
--      NÃO impediria duas páginas homônimas no TOPO do caderno, porque no
--      Postgres dois NULL nunca colidem num índice único. Onde a unicidade é
--      imposta (nome de caderno), o índice é parcial e não depende de NULL.
--
--   2. NULL em predicado. `x <> valor` avalia para NULL — não para TRUE —
--      quando x é NULL, e a linha SOME do resultado em silêncio. Toda
--      comparação de nulabilidade duvidosa neste arquivo usa
--      `is distinct from`.
--
--   3. NULL em coluna de busca. `'a' || NULL` é NULL, e `to_tsvector` de NULL é
--      NULL. Uma linha com tsvector NULL não entra no índice GIN: a página
--      ficaria invisível na busca sem ninguém perceber. Daí os `coalesce`
--      redundantes na expressão da coluna gerada.
--
-- Idempotente: `if not exists` / `drop ... if exists` / `create or replace` em
-- tudo.
-- =============================================================================

begin;

-- =============================================================================
-- 1. CADERNOS
--
-- Um caderno é só um agrupador nomeado. Não tem hierarquia própria de propósito:
-- a árvore mora nas PÁGINAS (parent_id), e caderno dentro de caderno seria uma
-- segunda hierarquia para o usuário manter na cabeça sem ganho nenhum.
-- =============================================================================

create table if not exists public.knowledge_notebooks (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  color_key  text not null default 'stone',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- `name` é NOT NULL, e isso é pré-requisito deste CHECK: um CHECK que avalia
  -- para NULL é considerado SATISFEITO pelo Postgres. Se `name` fosse anulável,
  -- `btrim(name) <> ''` deixaria passar a linha com nome nulo — a armadilha 2 do
  -- cabeçalho, na sua forma mais silenciosa.
  constraint knowledge_notebooks_name_not_blank check (btrim(name) <> ''),
  constraint knowledge_notebooks_color_key_not_blank check (btrim(color_key) <> '')
);

comment on table public.knowledge_notebooks is
  'Cadernos do módulo Conhecimento. Agrupador simples: a hierarquia real está em knowledge_pages.parent_id, não aqui.';
comment on column public.knowledge_notebooks.color_key is
  'Chave de cor do design system (canvas, surface, ink, accent, stone...). Guarda a CHAVE, nunca um hex: trocar a paleta não pode exigir UPDATE em massa.';
comment on column public.knowledge_notebooks.deleted_at is
  'Soft delete. NÃO existe lixeira na v1 (fora de escopo por decisão): a coluna só garante que apagar não perde dado. Toda leitura filtra deleted_at is null.';

-- -----------------------------------------------------------------------------
-- Índices de knowledge_notebooks
-- -----------------------------------------------------------------------------

-- Lado REFERENCIANTE da FK para auth.users. O Postgres NÃO indexa esse lado
-- automaticamente: sem este índice, cada DELETE em auth.users varre a tabela
-- inteira procurando as filhas. O índice único abaixo NÃO substitui este,
-- porque é PARCIAL (`where deleted_at is null`) e a checagem do cascade precisa
-- alcançar também as linhas já apagadas logicamente. Mesmo motivo de
-- drive_folders_user_idx (0007) e das junções de 0009.
create index if not exists knowledge_notebooks_user_idx
  on public.knowledge_notebooks (user_id);
comment on index public.knowledge_notebooks_user_idx is
  'Lado referenciante da FK para auth.users (cascade de exclusão de conta). O índice único de nome é parcial e não serve para isso. Ver 0011.';

-- Unicidade de nome de caderno por usuário.
--
-- `lower(btrim(name))` porque "Trabalho", "trabalho " e " TRABALHO" são o mesmo
-- caderno para quem usa — e dois cadernos indistinguíveis na barra lateral é
-- defeito, não liberdade.
--
-- Parcial em `deleted_at is null` para que apagar um caderno libere o nome de
-- volta. Aqui NÃO há a armadilha do NULL <> NULL do 0007, porque não existe
-- coluna nulável dentro da chave: `user_id` e a expressão de nome são ambos NOT
-- NULL. Um único índice parcial basta.
create unique index if not exists knowledge_notebooks_unique_name
  on public.knowledge_notebooks (user_id, lower(btrim(name)))
  where deleted_at is null;
comment on index public.knowledge_notebooks_unique_name is
  'Nome de caderno único por usuário, sem depender de caixa nem de espaços nas pontas. Parcial: apagar o caderno devolve o nome. Ver 0011.';

-- =============================================================================
-- 2. PÁGINAS
-- =============================================================================

create table if not exists public.knowledge_pages (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  notebook_id uuid not null references public.knowledge_notebooks (id) on delete cascade,
  -- NULL = página de topo do caderno. Lista de adjacência, igual a 0007.
  parent_id   uuid references public.knowledge_pages (id) on delete cascade,

  -- NOT NULL com default em vez de anulável: ver o comentário da coluna.
  title       text not null default 'Sem titulo',

  -- Documento do ProseMirror. Formato esperado:
  --   { "type": "doc",
  --     "content": [ { "type": "paragraph",
  --                    "content": [ { "type": "text", "text": "..." } ] } ] }
  content     jsonb not null default '{}'::jsonb,

  -- Derivada de `content` por trigger. NUNCA escrita pela aplicação.
  content_text text not null default '',

  -- Coluna GERADA. Ver a seção 5 para a decisão "coluna gerada x índice de
  -- expressão" e para o porquê de 'portuguese' e não 'simple'.
  search_vector tsvector generated always as (
    to_tsvector(
      'portuguese',
      -- Os dois `coalesce` são a armadilha 3 do cabeçalho: com `title` NOT NULL
      -- e `content_text` NOT NULL eles são hoje redundantes. Ficam de propósito
      -- — no dia em que alguém tornar uma das colunas anulável, `'a' || NULL`
      -- viraria NULL, o tsvector viraria NULL, a linha sairia do índice GIN e a
      -- página simplesmente deixaria de aparecer na busca. Sem erro, sem log.
      --
      -- O `left(...)` é limite de segurança, não estética: um tsvector tem teto
      -- de 1 MB e `to_tsvector` LEVANTA EXCEÇÃO ao estourá-lo. Numa coluna
      -- gerada isso faria o UPDATE do usuário falhar no meio da digitação de uma
      -- página gigante (um "colar" de livro inteiro, por exemplo) e ele perderia
      -- o texto. Truncar o que é INDEXADO não perde nada: `content` e
      -- `content_text` continuam completos, só o fim do texto deixa de ser
      -- pesquisável.
      left(coalesce(title, '') || ' ' || coalesce(content_text, ''), 900000)
    )
  ) stored,

  -- Ordem entre irmãs. Índice fracionário, mesmo raciocínio de
  -- tasks.board_position (0003): mover uma página custa 1 UPDATE, não uma
  -- renumeração da lista inteira.
  position   numeric not null default extract(epoch from clock_timestamp()),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- O documento do ProseMirror é sempre um objeto. Aceitar `[]` ou `"texto"`
  -- aqui só adiaria o erro para o editor, que quebraria ao montar o documento.
  -- `content` é NOT NULL, então este CHECK não cai na armadilha do CHECK que
  -- avalia para NULL.
  constraint knowledge_pages_content_is_object check (jsonb_typeof(content) = 'object')
);

comment on table public.knowledge_pages is
  'Páginas do módulo Conhecimento. Hierarquia por lista de adjacência (parent_id NULL = topo do caderno). O texto de busca e o tsvector são DERIVADOS: a aplicação escreve apenas title, content e position.';

comment on column public.knowledge_pages.parent_id is
  'Página-mãe. NULL = página de topo do caderno. FK para a própria tabela com on delete cascade: apagar uma página apaga a subárvore inteira.';

comment on column public.knowledge_pages.title is
  'Título da página. NOT NULL com default, e de propósito SEM o check de não-branco que knowledge_notebooks.name tem: o usuário apaga o título enquanto edita, e recusar a escrita no meio da digitação seria absurdo. A UI mostra "Sem titulo" quando btrim(title) = ''''. O NOT NULL não é decoração: se a coluna fosse anulável, um check "btrim(title) <> ''''" acrescentado depois avaliaria para NULL na linha de título nulo e o Postgres trataria isso como sucesso.';

comment on column public.knowledge_pages.content is
  'Documento do ProseMirror em jsonb (nunca HTML): dispensa sanitização — que é onde nascem os XSS — e deixa o schema do editor migrável. Forma: {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}.';

comment on column public.knowledge_pages.content_text is
  'Texto plano extraído de content. DERIVADA — a aplicação NUNCA escreve nesta coluna. A extração mora no BANCO, e não na server action, porque assim QUALQUER caminho de escrita mantém a busca coerente: a action de salvar, um script de migração de dados, uma correção feita à mão no SQL console do Supabase, um restore. Se a extração morasse na aplicação, bastaria um UPDATE fora dela para a página virar um fantasma — visível na árvore, invisível na busca, sem nada que denunciasse a incoerência.';

comment on column public.knowledge_pages.search_vector is
  'Coluna GERADA (stored) sobre title + content_text, configuração ''portuguese''. Indexada por GIN. É o que .textSearch() consulta — a aplicação nunca escreve aqui.';

comment on column public.knowledge_pages.position is
  'Ordem entre irmãs. Índice fracionário (numeric): inserir entre A e B = (A+B)/2, então arrastar custa 1 UPDATE. O default é o epoch fracionário do relógio, de modo que a página nova já nasce no FIM da lista sem a aplicação precisar de um "select max(position)" antes do insert — consulta que, além do ida-e-volta, teria corrida entre duas abas abertas. clock_timestamp() e não now(): now() é fixo na transação e duas páginas criadas juntas empatariam.';

comment on column public.knowledge_pages.deleted_at is
  'Soft delete. NÃO existe lixeira na v1 (fora de escopo). O índice de busca é parcial em deleted_at is null, então página apagada some da busca imediatamente.';

-- -----------------------------------------------------------------------------
-- 2.1 até 2.3 — Índices de knowledge_pages
--
-- Antes de criar qualquer coisa aqui: índice redundante NÃO é neutro. Custa
-- disco, é mantido em toda escrita e polui as estatísticas do planejador — o
-- banco fica MAIS LENTO (é o cabeçalho inteiro de 0008). Então são exatamente
-- quatro índices, cada um com um trabalho que nenhum outro faz.
-- -----------------------------------------------------------------------------

-- [1] Lado referenciante da FK para auth.users. Mesmo argumento de 0009: sem
--     ele, apagar uma conta varre knowledge_pages inteira.
create index if not exists knowledge_pages_user_idx
  on public.knowledge_pages (user_id);
comment on index public.knowledge_pages_user_idx is
  'Lado referenciante da FK para auth.users (cascade de exclusão de conta). Ver 0011.';

-- [2] Faz DOIS trabalhos, e é por isso que ele não é partido em dois índices:
--
--     (a) Lado referenciante da FK para knowledge_notebooks. Apagar um caderno
--         precisa achar suas páginas por `where notebook_id = ?`, e `notebook_id`
--         é o PREFIXO desta chave.
--     (b) A árvore da barra lateral:
--             where notebook_id = ? and parent_id is null order by position
--         entrega filtro E ordem de uma vez, sem sort.
--
--     NÃO é parcial em `deleted_at is null` justamente por causa de (a): a
--     checagem do cascade tem de enxergar também as páginas já apagadas
--     logicamente, e um índice parcial as esconderia — o cascade cairia em
--     varredura sequencial exatamente no caso que ele existe para acelerar.
--
--     `user_id` NÃO entra na chave. A RLS acrescenta `user_id = auth.uid()` a
--     toda consulta, mas `notebook_id` já é altamente seletivo (um caderno
--     pertence a um único dono), então o filtro de user_id se resolve na heap sem
--     custo relevante — e a coluna extra engordaria o índice em 16 bytes por
--     linha sem ganho mensurável. É o mesmo raciocínio da seção 2 de 0009.
--
--     `parent_id` é anulável e isso está OK aqui: um btree INDEXA os NULLs, e
--     `where parent_id is null` usa o índice normalmente. A armadilha do
--     NULL <> NULL é de índice ÚNICO, não de índice de busca.
create index if not exists knowledge_pages_notebook_tree_idx
  on public.knowledge_pages (notebook_id, parent_id, position);
comment on index public.knowledge_pages_notebook_tree_idx is
  'Duplo uso: prefixo notebook_id atende o cascade da FK para knowledge_notebooks, e a chave inteira entrega filtro + ordem da árvore da barra lateral. Não é parcial de propósito: o cascade precisa ver as linhas com deleted_at preenchido. Ver 0011.';

-- [3] Lado referenciante da FK AUTORREFERENTE (parent_id -> id). Sem ele, apagar
--     uma página faz varredura sequencial para achar as filhas — e como o
--     cascade é recursivo, uma varredura POR NÍVEL da subárvore. O índice [2]
--     não serve: a chave dele começa por notebook_id, e o cascade procura só por
--     parent_id.
create index if not exists knowledge_pages_parent_idx
  on public.knowledge_pages (parent_id);
comment on index public.knowledge_pages_parent_idx is
  'Lado referenciante da FK autorreferente parent_id. Sem ele o cascade de exclusão de subárvore varre a tabela uma vez por nível. Ver 0011.';

-- [4] Busca full-text. Ver seção 5.
create index if not exists knowledge_pages_search_idx
  on public.knowledge_pages using gin (search_vector)
  where deleted_at is null;
comment on index public.knowledge_pages_search_idx is
  'GIN sobre a coluna gerada search_vector. PARCIAL: para o planejador poder usá-lo, a consulta PRECISA repetir o predicado deleted_at is null (em supabase-js: .is(''deleted_at'', null)). Ver 0011.';

-- -----------------------------------------------------------------------------
-- 2.4 — UNICIDADE DE TÍTULO ENTRE IRMÃS: DECIDIDO **NÃO** IMPOR
--
-- Esta ausência é DELIBERADA. Está escrita, e não apenas omitida, porque quem
-- ler este arquivo depois de 0007 vai estranhar a falta — e "estranhou, tirou
-- conclusão errada, adicionou o índice" é como a decisão se perderia.
--
-- No Drive (0007) a unicidade de nome entre irmãos é obrigatória, e por um
-- motivo concreto: lá o nome VIRA CAMINHO. Dois arquivos "contrato.pdf" na mesma
-- pasta tornam "/Documentos/contrato.pdf" ambíguo, e a UI de mover/renomear
-- passa a mentir. Aqui nada disso vale: uma página é endereçada por uuid
-- (/conhecimento/pagina/<uuid>), o título é prosa, e o título não participa de
-- nenhuma chave de navegação.
--
-- O que decidiu a questão foi o caminho mais comum do módulo. A página nasce sem
-- título — o botão "Nova página" cria a linha e leva o cursor para o editor, com
-- o default 'Sem titulo'. Com o índice único, a SEGUNDA página nova do mesmo
-- ramo estouraria 23505 na cara do usuário, no ato mais frequente que existe
-- aqui. As saídas seriam gerar "Sem titulo 2" (que tem corrida entre duas abas e
-- ainda produz nomes feios) ou permitir título em branco e perder o rótulo da
-- barra lateral. Nenhuma delas paga o preço.
--
-- E o dano que a restrição evitaria é pequeno e reversível: duas "Ideias" no
-- mesmo ramo são CONFUSAS, não corrompem nada. Confusão de leitura se resolve na
-- UI (mostrar a data ou um trecho do conteúdo ao lado do título), que é onde o
-- problema realmente está. Restrição de banco que bloqueia o fluxo principal é
-- pior que a duplicata cosmética que ela previne.
--
-- SE UM DIA FOR IMPOSTA, o molde é o de 0007 e são DOIS índices parciais, nunca
-- um só. `unique (notebook_id, parent_id, lower(btrim(title)))` sozinho NÃO
-- impede duas páginas homônimas no TOPO do caderno, porque para o índice único
-- NULL <> NULL e as duas linhas com parent_id nulo nunca colidem:
--
--   create unique index if not exists knowledge_pages_unique_titled
--     on public.knowledge_pages (notebook_id, parent_id, lower(btrim(title)))
--     where deleted_at is null and parent_id is not null;
--
--   create unique index if not exists knowledge_pages_unique_root_titled
--     on public.knowledge_pages (notebook_id, lower(btrim(title)))
--     where deleted_at is null and parent_id is null;
--
-- (E aí o botão "Nova página" precisa parar de criar linha com título default.)
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 3. EXTRAÇÃO DE TEXTO DO DOCUMENTO DO PROSEMIRROR
--
-- Percorre o jsonb em QUALQUER profundidade e concatena todo campo "text".
--
-- IMPLEMENTAÇÃO: `jsonb_path_query_array(content, '$.**.text')`, e não recursão
-- manual com jsonb_each/jsonb_array_elements. O acessor recursivo `.**` do
-- jsonpath existe desde o Postgres 12 (o Supabase roda 15+), resolve o problema
-- inteiro em uma expressão e roda em C — uma função plpgsql recursiva faria o
-- mesmo trabalho com uma chamada de função por nó do documento.
--
-- MODO LAX (o default do jsonpath) é essencial e não é detalhe: `.**` desce por
-- objetos E por arrays, e aplicar `.text` a um valor que não é objeto — a string
-- "paragraph", por exemplo — é um erro ESTRUTURAL, que o modo lax suprime
-- devolvendo sequência vazia em vez de levantar exceção. Em modo strict a mesma
-- expressão explodiria no primeiro nó que não fosse objeto. Não escreva
-- 'strict $.**.text' aqui.
--
-- Como os nós de texto do ProseMirror ficam dentro do array "content", este
-- comportamento é o que faz a função funcionar. É o mesmo caso do exemplo
-- `lax $.**.HR` da documentação do Postgres, em que o valor procurado está
-- dentro de objetos dentro de um array.
--
-- DEVOLVE '' E NUNCA NULL. Motivo prático: content_text alimenta search_vector,
-- e `'a' || NULL` é NULL, e um tsvector NULL não entra no índice GIN. A página
-- ficaria invisível na busca sem nenhum sinal de erro.
--
-- `security invoker` + `set search_path = ''` como toda função do projeto. Não
-- há prefixo a colocar porque jsonb_path_query_array, jsonb_array_elements_text,
-- array_to_string e btrim vivem em pg_catalog, que continua no caminho de busca
-- mesmo com search_path vazio.
--
-- IMMUTABLE é verdade, não conveniência: para o mesmo jsonb a saída é sempre a
-- mesma, e todas as funções usadas são elas próprias immutable. Isso deixa a
-- função utilizável em expressão de índice ou de coluna gerada, caso um dia se
-- decida cortar o intermediário content_text.
-- =============================================================================

create or replace function public.knowledge_extract_text(p_content jsonb)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_texto text;
begin
  -- Documento ausente, nulo ou escalar: nada a extrair. Sai por '' — nunca NULL.
  if p_content is null or jsonb_typeof(p_content) not in ('object', 'array') then
    return '';
  end if;

  select array_to_string(
           array(
             select t.value
             from jsonb_array_elements_text(
                    jsonb_path_query_array(p_content, '$.**.text')
                  ) as t (value)
             -- Um nó com "text": null viraria NULL aqui; um nó com "text": ""
             -- viraria espaço duplo. Nenhum dos dois quebra a busca, mas os dois
             -- sujam o texto que a UI usa como trecho de resultado.
             where t.value is not null
               and btrim(t.value) <> ''
           ),
           ' '
         )
    into v_texto;

  -- array() nunca devolve NULL (no pior caso devolve '{}'), então
  -- array_to_string já devolveria ''. O coalesce é o cinto sobre o suspensório
  -- da regra "esta função não devolve NULL".
  return coalesce(btrim(v_texto), '');
end;
$$;

comment on function public.knowledge_extract_text(jsonb) is
  'Extrai o texto plano de um documento do ProseMirror concatenando todo campo "text" em qualquer profundidade, via jsonpath lax $.**.text. Devolve string vazia — nunca NULL — para que a coluna de busca jamais saia do índice GIN.';

-- =============================================================================
-- 4. TRIGGER QUE PREENCHE content_text
--
-- Dispara `before insert or update of content, content_text`. Repare que
-- `content_text` está na lista de colunas de propósito: se alguém tentar
-- escrever direto nessa coluna derivada, o trigger dispara e RECALCULA o valor a
-- partir de `content`, descartando o que foi escrito. Sem isso, um
-- `update ... set content_text = 'qualquer coisa'` passaria intocado e a busca
-- passaria a mentir. Custo zero no caminho quente: a lista de colunas faz o
-- trigger NÃO disparar quando só title ou position mudam.
--
-- E quando só o title muda, a busca continua correta mesmo assim — porque
-- search_vector é coluna GERADA e o Postgres recalcula coluna gerada em TODO
-- UPDATE, independente de trigger. É um dos motivos de ela ser coluna gerada e
-- não um segundo trigger (seção 5).
--
-- ORDEM DE EXECUÇÃO — o detalhe do qual todo este desenho depende: o Postgres
-- roda os triggers BEFORE ROW e só DEPOIS calcula as colunas geradas STORED.
-- Portanto `search_vector` enxerga o `content_text` já preenchido por este
-- trigger, e não o valor antigo.
-- =============================================================================

create or replace function public.knowledge_pages_sync_content_text()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.content_text := public.knowledge_extract_text(new.content);
  return new;
end;
$$;

comment on function public.knowledge_pages_sync_content_text() is
  'BEFORE INSERT/UPDATE em knowledge_pages: deriva content_text de content. Também dispara quando content_text é mencionado no UPDATE, para sobrescrever qualquer escrita direta na coluna derivada.';

drop trigger if exists trg_knowledge_pages_content_text on public.knowledge_pages;
create trigger trg_knowledge_pages_content_text
  before insert or update of content, content_text on public.knowledge_pages
  for each row execute function public.knowledge_pages_sync_content_text();

-- =============================================================================
-- 5. BUSCA FULL-TEXT — COLUNA GERADA, NÃO ÍNDICE DE EXPRESSÃO
--
-- A coluna `search_vector` foi declarada junto da tabela (seção 2) e o índice
-- GIN sobre ela na seção 2.1. Esta seção existe para registrar a decisão.
--
-- A alternativa era um índice de expressão:
--
--   create index ... using gin (
--     to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(content_text,''))
--   );
--
-- e ela foi RECUSADA por um motivo operacional, não estético: um índice de
-- expressão só é usado quando a consulta repete a MESMA expressão, LITERALMENTE.
-- Qualquer divergência — trocar a ordem dos campos, esquecer um coalesce, o
-- PostgREST montando a expressão de um jeito ligeiramente diferente — e o
-- planejador simplesmente ignora o índice e cai em varredura sequencial. Não dá
-- erro: só fica lento, e fica lento depois, quando já houver dados. Com uma
-- coluna, a consulta referencia a COLUNA (`search_vector @@ ...`), que não tem
-- como divergir. É também o único formato que o `.textSearch()` do supabase-js
-- sabe gerar, já que ele recebe um nome de coluna.
--
-- O Postgres exige que a expressão de coluna gerada seja IMMUTABLE.
-- `to_tsvector('portuguese', x)` com a configuração LITERAL resolve para a
-- variante de dois argumentos `to_tsvector(regconfig, text)`, que É immutable. A
-- variante de UM argumento, `to_tsvector(x)`, depende de
-- default_text_search_config e é apenas STABLE — ela NÃO pode ser usada aqui, e
-- o Postgres recusaria a coluna. Não "simplifique" removendo o 'portuguese'.
--
-- POR QUE 'portuguese' E NÃO 'simple':
--   'simple' apenas quebra o texto em palavras e abaixa a caixa. Não faz
--   stemming e não remove stop words. Na prática, buscar "correcoes" não acharia
--   uma página que diz "correcao", buscar "reunioes" não acharia "reuniao", e
--   "de", "para", "que" e "com" entrariam no índice engordando-o sem discriminar
--   nada. Com 'portuguese', o stemmer reduz as duas formas ao mesmo radical e a
--   busca acerta. O preço é que a MESMA configuração precisa ser usada do lado
--   da CONSULTA: `websearch_to_tsquery('portuguese', termo)`. Consultar com a
--   configuração default (que costuma ser 'english') geraria lexemas de outro
--   idioma e a busca voltaria a errar — em silêncio, devolvendo zero resultados.
--   Em supabase-js isso é o `{ config: 'portuguese' }` do .textSearch().
--
-- POR QUE O ÍNDICE É PARCIAL (`where deleted_at is null`):
--   Página apagada não deve aparecer na busca, e o filtro no índice é mais
--   barato que o filtro na heap. O contrato disso é que a CONSULTA precisa
--   repetir o predicado — sem `deleted_at is null`, o planejador não pode provar
--   que o índice parcial cobre o resultado e não o usa. Está dito também no
--   comment do índice.
--
-- POR QUE **NÃO** HÁ btree_gin COM user_id NA CHAVE:
--   Um índice `gin (user_id, search_vector)` exigiria a extensão btree_gin.
--   Foi descartado: a RLS já acrescenta `user_id = auth.uid()`, e o planejador
--   combina o GIN com knowledge_pages_user_idx num BitmapAnd quando isso vale a
--   pena. Instalar extensão para economizar um bitmap não se paga, e extensão é
--   dependência nova em toda reconstrução do banco.
-- =============================================================================

-- =============================================================================
-- 6. ANTI-CICLO NA HIERARQUIA DE PÁGINAS
--
-- Molde de public.drive_prevent_folder_cycle (0007), guarda de profundidade
-- inclusa. Uma página não pode ser filha de si mesma nem de uma descendente sua:
-- o ramo ficaria órfão e, pior, a montagem do breadcrumb (que sobe de parent_id
-- em parent_id até achar NULL) entraria em laço infinito e derrubaria a
-- renderização da página inteira.
--
-- A guarda de 256 níveis existe para o caso em que um ciclo JÁ esteja gravado —
-- por um restore parcial, por uma escrita feita com service_role fora da
-- aplicação — e a subida nunca terminasse. Melhor levantar exceção do que travar
-- a conexão.
--
-- `security invoker`: a subida da cadeia roda sob a RLS do chamador, então uma
-- página de outro usuário é simplesmente invisível e a cadeia termina ali. Não é
-- lacuna: se a mãe não é visível, o trigger de mesmo caderno (seção 7) recusa a
-- linha de qualquer jeito.
--
-- Dispara apenas em `update of parent_id`: se parent_id não mudou, a posição
-- desta linha na árvore não mudou, e um ciclo criado por OUTRA linha é
-- responsabilidade do trigger daquela linha.
-- =============================================================================

create or replace function public.knowledge_prevent_page_cycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ancestor uuid := new.parent_id;
  v_guard    int  := 0;
begin
  -- Página de topo do caderno: não há cadeia para subir.
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Uma pagina nao pode ser mae de si mesma'
      using errcode = 'check_violation';
  end if;

  while v_ancestor is not null loop
    v_guard := v_guard + 1;
    if v_guard > 256 then
      raise exception 'Hierarquia de paginas profunda demais (possivel ciclo)'
        using errcode = 'check_violation';
    end if;

    if v_ancestor = new.id then
      raise exception 'Nao e possivel mover uma pagina para dentro de uma subpagina dela'
        using errcode = 'check_violation';
    end if;

    -- SELECT INTO sem linha correspondente deixa a variável em NULL, o que
    -- encerra o laço. É o que acontece ao chegar na raiz da árvore.
    select p.parent_id into v_ancestor
    from public.knowledge_pages as p
    where p.id = v_ancestor;
  end loop;

  return new;
end;
$$;

comment on function public.knowledge_prevent_page_cycle() is
  'Impede ciclos na hierarquia de páginas ao inserir ou mover. Sem isso o breadcrumb entra em laço infinito. Molde de drive_prevent_folder_cycle (0007), com guarda de profundidade.';

drop trigger if exists trg_knowledge_pages_no_cycle on public.knowledge_pages;
create trigger trg_knowledge_pages_no_cycle
  before insert or update of parent_id on public.knowledge_pages
  for each row execute function public.knowledge_prevent_page_cycle();

-- =============================================================================
-- 7. CADERNO VÁLIDO, E MÃE NO MESMO CADERNO — o buraco que a FK NÃO fecha
--
-- A checagem de integridade referencial roda com o privilégio do DONO da tabela
-- e IGNORA a RLS. Ou seja, as duas FKs provam que o caderno EXISTE e que a mãe
-- EXISTE — não provam que são do usuário, nem que estão vivos, nem que combinam
-- entre si. São três buracos, e todos se fecham aqui.
--
--   (i) A MÃE PRECISA ESTAR NO MESMO CADERNO. Sem isso, uma subpágina do caderno
--       "Estudos" pode ter mãe no caderno "Trabalho": a árvore da barra lateral
--       (que consulta `where notebook_id = ? and parent_id is null`) nunca a
--       alcançaria, e o breadcrumb subiria para fora do caderno aberto. Página
--       órfã na prática, existindo no banco.
--
--  (ii) O CADERNO PRECISA SER VISÍVEL PARA O INVOCADOR E ESTAR VIVO. É o mesmo
--       argumento aplicado a `notebook_id`, e ele vale INCLUSIVE para página de
--       topo — que é onde a checagem da mãe não tem o que fazer. O caso concreto
--       não exige adivinhar uuid nenhum: duas abas abertas, o usuário apaga o
--       caderno "Estudos" numa e arrasta uma página de topo para ele na outra. A
--       FK aprova (a linha do caderno continua lá, só com `deleted_at`
--       preenchido) e a página some da árvore para sempre — `listNotebooks`
--       filtra `deleted_at is null` — enquanto continua aparecendo na BUSCA, que
--       lê knowledge_pages sem olhar o caderno. Sem erro e sem log. A variante
--       com o uuid de um caderno de OUTRO usuário termina igual, com o agravante
--       de a linha ficar pendurada em caderno alheio.
--
--       `createPage` faz essa leitura de conferência antes do insert, mas
--       `movePage` manda `notebook_id` cru do request para o UPDATE e confia no
--       banco. Repetir a conferência em cada action seria uma segunda
--       implementação para divergir da primeira; a invariante mora aqui, e
--       assim TODO caminho de escrita a respeita — inclusive um UPDATE feito à
--       mão no console SQL.
--
-- DUAS PEÇAS, e a divisão é proposital:
--
--   (7a) CONSTRAINT TRIGGER **DEFERRABLE INITIALLY DEFERRED** que valida a
--        invariante. Ser adiada para o COMMIT é o ponto todo. Um trigger BEFORE
--        comum validaria a linha no instante da escrita, e isso QUEBRARIA a
--        movimentação de subárvore de (7b): aquele UPDATE altera mãe e filhas na
--        MESMA instrução, e a ordem em que o Postgres processa as linhas de uma
--        instrução NÃO é definida. Se a neta fosse processada antes da filha, a
--        checagem imediata veria a filha ainda no caderno antigo e recusaria uma
--        operação perfeitamente válida — de forma intermitente, que é o pior
--        tipo de defeito. Adiada para o commit, ela vê o estado final.
--
--        Por ser adiada, a função RELÊ a linha e a mãe pela tabela em vez de
--        confiar em NEW. NEW é a foto do momento do evento; se a mesma linha for
--        alterada de novo mais tarde na transação, aquela foto está velha e a
--        checagem acusaria uma violação que já não existe.
--
--   (7b) TRIGGER AFTER que PROPAGA a troca de caderno para a subárvore. Sem ela,
--        mover uma página com filhas para outro caderno deixaria as filhas para
--        trás — exatamente a incoerência que (7a) recusaria no commit, ou seja,
--        a operação mais natural do módulo passaria a falhar. Propagar é o
--        comportamento que o usuário espera: mover uma página move o que está
--        dentro dela.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (7a) As invariantes: caderno válido (i e ii da seção 7) e mãe no mesmo caderno
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_pages_check_same_notebook()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent_id       uuid;
  v_notebook_id     uuid;
  v_parent_notebook uuid;
  v_caderno_vivo    uuid;
begin
  -- Estado ATUAL da linha, não NEW: ver o comentário da seção 7 sobre foto
  -- velha. Linha apagada mais adiante na mesma transação simplesmente não tem
  -- mais o que validar.
  select p.parent_id, p.notebook_id
    into v_parent_id, v_notebook_id
  from public.knowledge_pages as p
  where p.id = new.id;

  if not found then
    return null;
  end if;

  -- (ii) O CADERNO. Roda ANTES da checagem da mãe de propósito: página de topo
  -- sai pelo `return` logo abaixo e não passaria por checagem nenhuma — era
  -- exatamente por aí que uma página ia parar num caderno apagado ou alheio.
  --
  -- `security invoker` faz este SELECT passar pela RLS do chamador, então
  -- caderno de outro usuário é invisível e cai no mesmo `null` de um caderno
  -- inexistente. A resposta é a mesma para os três casos, e isso é deliberado:
  -- distinguir "não é seu" de "não existe" confirmaria a existência de linha
  -- alheia a quem chutasse uuid.
  select n.id into v_caderno_vivo
  from public.knowledge_notebooks as n
  where n.id = v_notebook_id
    and n.deleted_at is null;

  if v_caderno_vivo is null then
    raise exception 'Caderno % nao existe, nao esta visivel para o usuario atual ou foi apagado', v_notebook_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Página de topo do caderno: não há mãe com quem concordar.
  if v_parent_id is null then
    return null;
  end if;

  select m.notebook_id into v_parent_notebook
  from public.knowledge_pages as m
  where m.id = v_parent_id;

  -- notebook_id é NOT NULL na tabela, logo NULL aqui só significa "a linha da
  -- mãe não existe ou não está visível para este usuário". Vale como checagem de
  -- propriedade de brinde: a mãe de outra pessoa é invisível sob a RLS, então
  -- ninguém pendura uma página na árvore alheia.
  if v_parent_notebook is null then
    raise exception 'Pagina-mae % nao existe ou nao esta visivel para o usuario atual', v_parent_id
      using errcode = 'foreign_key_violation';
  end if;

  -- `is distinct from` e não `<>`: com `<>`, um lado NULL faria a comparação
  -- avaliar para NULL, o `if` não entraria e a violação passaria em silêncio.
  -- Os dois lados são NOT NULL neste ponto, mas a forma segura custa o mesmo.
  if v_parent_notebook is distinct from v_notebook_id then
    raise exception
      'A pagina % esta no caderno % mas sua pagina-mae % esta no caderno %: mae e filha precisam estar no mesmo caderno',
      new.id, v_notebook_id, v_parent_id, v_parent_notebook
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function public.knowledge_pages_check_same_notebook() is
  'Constraint trigger ADIADA: no commit, garante que o caderno da página existe, está visível para o invocador e não foi apagado logicamente, e que a página-mãe está nesse mesmo caderno. Relê o estado atual da tabela em vez de confiar em NEW, porque NEW é a foto do momento do evento. As FKs rodam com privilégio do dono e ignoram a RLS: elas provam que caderno e mãe existem, não que são do usuário, não que estão vivos e não que combinam.';

drop trigger if exists trg_knowledge_pages_same_notebook on public.knowledge_pages;
create constraint trigger trg_knowledge_pages_same_notebook
  after insert or update of parent_id, notebook_id on public.knowledge_pages
  deferrable initially deferred
  for each row execute function public.knowledge_pages_check_same_notebook();

-- -----------------------------------------------------------------------------
-- (7b) A propagação
--
-- Uma única instrução com CTE recursiva move a subárvore inteira. `union` e não
-- `union all`: se um ciclo já estivesse gravado no banco (restore parcial,
-- escrita com service_role fora da aplicação), `union all` giraria para sempre;
-- `union` deduplica e a recursão termina.
--
-- `is distinct from` no WHERE do UPDATE tem dois papéis: evita reescrever linhas
-- que já estão no caderno certo e, com isso, faz a propagação CONVERGIR. Isso
-- importa porque este mesmo trigger dispara de novo para cada descendente
-- movido — como a primeira instrução já moveu a subárvore inteira de uma vez,
-- essas reentradas encontram zero linhas para atualizar, não geram novos eventos
-- e o processo para. A alternativa seria travar a reentrada com
-- pg_trigger_depth(), e ela foi RECUSADA de propósito: acertar o nível de
-- aninhamento é sutil, e errar para mais faz a propagação NUNCA rodar — trocar
-- um desperdício pequeno e limitado por um defeito silencioso é péssimo negócio.
--
-- `security invoker`: o UPDATE passa pela RLS do chamador, então só alcança as
-- páginas do próprio usuário.
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_pages_cascade_notebook()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with recursive descendentes (id) as (
    select f.id
    from public.knowledge_pages as f
    where f.parent_id = new.id

    union

    select f.id
    from public.knowledge_pages as f
    join descendentes as d on f.parent_id = d.id
  )
  update public.knowledge_pages as p
  set notebook_id = new.notebook_id
  from descendentes as d
  where p.id = d.id
    and p.notebook_id is distinct from new.notebook_id;

  return null;
end;
$$;

comment on function public.knowledge_pages_cascade_notebook() is
  'AFTER UPDATE em knowledge_pages: quando a página muda de caderno, leva a subárvore inteira junto. Sem isso as filhas ficariam para trás e violariam a invariante de trg_knowledge_pages_same_notebook no commit.';

drop trigger if exists trg_knowledge_pages_cascade_notebook on public.knowledge_pages;
create trigger trg_knowledge_pages_cascade_notebook
  after update of notebook_id on public.knowledge_pages
  for each row
  when (new.notebook_id is distinct from old.notebook_id)
  execute function public.knowledge_pages_cascade_notebook();

-- =============================================================================
-- 8. TRIGGERS PADRÃO DO PROJETO
--
-- set_updated_at e prevent_user_id_change, nas duas tabelas, no estilo do
-- bloco do-loop de 0007.
--
-- Nota sobre a ordem de disparo: dentro do mesmo evento e da mesma temporização,
-- o Postgres roda os triggers em ordem ALFABÉTICA do nome. Em knowledge_pages os
-- BEFORE UPDATE saem nesta ordem — content_text, lock_user_id, no_cycle,
-- updated_at — e nenhum deles depende do resultado de outro, então a ordem é
-- indiferente aqui. Vale saber ao acrescentar o próximo.
-- =============================================================================
do $$
declare
  t text;
  tbls text[] := array['knowledge_notebooks', 'knowledge_pages'];
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

-- =============================================================================
-- 9. RLS + GRANTS (bloco do-loop, estilo 0007 e 0009)
--
-- Quatro policies por tabela, todas `to authenticated`, todas com
-- `(select auth.uid()) = user_id` — o `select` envolvendo auth.uid() faz o
-- Postgres avaliar a função UMA vez por consulta em vez de uma vez por linha.
--
-- `revoke all from anon`: caderno de notas pessoais nunca é público. Esconder o
-- link não é controle de acesso; a RLS é.
-- =============================================================================
do $$
declare
  t text;
  tbls text[] := array['knowledge_notebooks', 'knowledge_pages'];
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
-- 10. COMO A APLICAÇÃO CONSULTA A BUSCA
--
-- A consulta precisa de TRÊS coisas, e faltar qualquer uma delas degrada em
-- silêncio (não dá erro, só devolve menos ou fica lento):
--
--   (a) `{ config: 'portuguese' }` — sem isso o PostgREST usa a configuração
--       default do banco (normalmente 'english') para montar o tsquery, e os
--       lexemas da CONSULTA não batem com os do ÍNDICE. Resultado: zero linhas.
--
--   (b) `.is('deleted_at', null)` — o índice GIN é PARCIAL nesse predicado. Sem
--       repeti-lo o planejador não pode usar o índice e cai em varredura
--       sequencial.
--
--   (c) `{ type: 'websearch' }` — usa websearch_to_tsquery, que aceita texto de
--       usuário cru (aspas, OR, `-termo`) e NUNCA levanta erro de sintaxe.
--       `to_tsquery` levantaria, e o usuário veria um 500 ao digitar um
--       parêntese.
--
--   const { data, error } = await supabase
--     .from('knowledge_pages')
--     .select('id, notebook_id, parent_id, title, updated_at')
--     .eq('user_id', userId)
--     .is('deleted_at', null)
--     .textSearch('search_vector', termo, { config: 'portuguese', type: 'websearch' })
--     .order('updated_at', { ascending: false })
--     .limit(30);
--
-- O `.eq('user_id', userId)` é redundante com a RLS em termos de SEGURANÇA, mas
-- não em termos de PLANO: ele dá ao planejador um predicado que casa com
-- knowledge_pages_user_idx.
--
-- Verificação rápida da extração de texto (somente leitura; se virar rotina,
-- mova para supabase/verificacao.sql):
--
--   select public.knowledge_extract_text(
--     '{"type":"doc","content":[{"type":"paragraph","content":[
--        {"type":"text","text":"Correcoes"},{"type":"text","text":"do texto"}]}]}'::jsonb
--   );
--   -- esperado: 'Correcoes do texto'
--
--   select to_tsvector('portuguese', 'correcoes') @@ websearch_to_tsquery('portuguese', 'correcao');
--   -- esperado: true (é o stemming pagando pela escolha de 'portuguese')
-- =============================================================================
