# Plano de execução — Integração ClickUp (leitura, status e comentário)

> Escopo fechado e deliberadamente pequeno. O objetivo declarado não é só
> "integrar": é integrar de um jeito em que **o aplicativo seja incapaz** de
> fazer mais do que três coisas, mesmo que o token permita tudo.
>
> Projeto: Segundo Cérebro · Data: 2026-08-02 · Migration base: 0015

---

## Índice

- [§0 — O contrato: o que o app pode e o que ele não consegue](#0--o-contrato)
- [§1 — A armadilha central do escopo](#1--a-armadilha-central-do-escopo)
- [§2 — Arquitetura](#2--arquitetura)
- [Fase 1 — Banco](#fase-1--banco-migration-0016)
- [Fase 2 — Núcleo de segurança](#fase-2--núcleo-de-segurança-sem-ui)
- [Fase 3 — Configurações](#fase-3--configurações-conectar-e-desconectar)
- [Fase 4 — Leitura](#fase-4--leitura-a-aba-clickup)
- [Fase 5 — Escrita](#fase-5--escrita-status-e-comentário)
- [Fase 6 — Prova de que a limitação é real](#fase-6--prova-de-que-a-limitação-é-real)
- [§7 — O que fica de fora, por escrito](#7--o-que-fica-de-fora-por-escrito)
- [§8 — Checklist de execução](#8--checklist-de-execução)

---

## §0 — O contrato

Esta seção é normativa. Tudo abaixo existe para sustentá-la.

### O aplicativo PODE

| # | Operação | Endpoint | Método |
|---|---|---|---|
| 1 | Descobrir quem sou no ClickUp | `/user` | GET |
| 2 | Descobrir meus workspaces | `/team` | GET |
| 3 | Listar tarefas **onde sou responsável** | `/team/{id}/task?assignees[]={eu}` | GET |
| 4 | Ler uma tarefa específica | `/task/{id}` | GET |
| 5 | Ler os status válidos de uma lista | `/list/{id}` | GET |
| 6 | Ler comentários de uma tarefa | `/task/{id}/comment` | GET |
| 7 | **Mudar o status** de uma tarefa minha | `/task/{id}` | PUT |
| 8 | **Comentar** numa tarefa minha | `/task/{id}/comment` | POST |

Oito operações. Nem uma a mais.

### O aplicativo NÃO CONSEGUE

Não "não faz" — **não consegue**, porque o caminho não existe no código:

- Apagar tarefa, lista, pasta, espaço ou comentário (`DELETE` não é expressável)
- Criar tarefa, lista ou pasta
- Renomear tarefa, reescrever descrição, mudar prazo, mudar prioridade
- **Adicionar ou remover responsáveis** (inclusive tirar um colega da tarefa)
- Arquivar tarefa
- Mover tarefa entre listas
- Mexer em qualquer tarefa da qual eu **não** sou responsável
- Anexar arquivo, apontar tempo, mexer em custom field
- Criar webhook, ver ou alterar membros do workspace

### As três invariantes

**I1 — O token nunca sai do servidor.** Nem em prop, nem em resposta de action,
nem mascarado, nem em log. Vive cifrado no Postgres e em memória de processo
durante a chamada.

**I2 — Um só arquivo fala com `api.clickup.com`.** Qualquer `fetch` para o
ClickUp fora de `src/lib/clickup/capabilities.ts` é defeito, e há um teste que
falha se aparecer.

**I3 — Toda escrita verifica a responsabilidade antes.** Antes de qualquer PUT
ou POST, o servidor confere na API que a tarefa tem o meu id em `assignees[]`.
Sem confirmação, recusa.

---

## §1 — A armadilha central do escopo

**Este é o parágrafo mais importante do documento.**

`PUT /api/v2/task/{task_id}` não é o "endpoint de mudar status". É o endpoint de
**alterar tarefa**, e o que ele faz depende do corpo:

```jsonc
{
  "status": "in progress",             // o que queremos
  "name": "outro nome",                // renomeia
  "description": "...",                // reescreve
  "due_date": "1754092800000",         // muda prazo
  "priority": 1,                       // muda prioridade
  "assignees": { "rem": [12345] },     // TIRA UM COLEGA DA TAREFA
  "archived": true,                    // arquiva
  "parent": "outro_id"                 // move
}
```

Um allowlist por *endpoint* deixaria tudo isso passar. Duas consequências de
projeto:

**A limitação tem que estar no corpo, não na rota.** E não por filtragem — por
**construção**. A função não recebe um objeto e remove o que não pode; ela recebe
uma string e monta o objeto do zero:

```ts
// ERRADO — filtrar. Um campo novo do ClickUp passa até alguém lembrar de bloquear.
async function alterarTarefa(id: string, campos: Record<string, unknown>) {
  const limpo = pick(campos, ["status"]);
  return chamar("PUT", `/task/${id}`, limpo);
}

// CERTO — construir. O corpo tem exatamente uma chave porque foi escrito assim.
// Não existe parâmetro por onde entrar outra coisa.
export async function mudarStatus(taskId: string, status: string) {
  return chamar("mudarStatus", { taskId }, { status });
  //                                        ^^^^^^^^^^ literal, não repassado
}
```

**Server Action não é fronteira de confiança.** O próprio
[`rate-limit.ts`](segundo-cerebro/src/lib/rate-limit.ts) já documenta isso: o
Next publica um id por função exportada e qualquer um manda POST direto, sem
passar pelo formulário. Então `mudarStatus(taskId, status)` pode ser chamada com
**qualquer** `taskId` do workspace inteiro — inclusive tarefas de colegas. É
exatamente por isso que a invariante I3 existe e não é opcional.

---

## §2 — Arquitetura

### Arquivos novos

```
supabase/
  migrations/0016_clickup.sql            ← duas tabelas + RLS + grants
  verificacao.sql                        ← + BLOCO 12 (ClickUp)

src/lib/clickup/
  capabilities.ts        ← ⭐ tabela de operações + o único fetch do projeto
  capabilities.test.ts   ← ⭐ prova que o resto é impossível
  client.ts              ← as 8 funções, cada uma montando seu próprio corpo
  types.ts               ← tipos da resposta, reduzidos ao que a tela usa
  mapper.ts              ← resposta crua → modelo da UI (datas, status, etc.)
  mapper.test.ts
  credentials.ts         ← ler/gravar token cifrado (admin client)
  guard.ts               ← garantirResponsavel() — a invariante I3
  guard.test.ts
  erros.ts               ← 401/403/429/5xx → frase em português

src/app/(app)/configuracoes/clickup-actions.ts   ← conectar, testar, desconectar
src/app/(app)/tarefas/clickup-actions.ts         ← listar, mudar status, comentar

src/components/features/settings/IntegrationsPanel.tsx
src/components/features/tasks/ClickUpPanel.tsx
src/components/features/tasks/ClickUpTaskSheet.tsx
```

### Arquivos alterados

| Arquivo | Mudança | Risco |
|---|---|---|
| `src/lib/crypto/tokens.ts` | extrair núcleo genérico | ⚠️ **alto** — ver Fase 2.1 |
| `src/lib/validation.ts` | schemas Zod do ClickUp | baixo |
| `src/app/(app)/configuracoes/page.tsx` | montar `IntegrationsPanel` | baixo |
| `src/components/.../SettingsPanels.tsx` | reexportar o painel novo | baixo |
| `src/app/(app)/tarefas/page.tsx` | ler estado da conexão | baixo |
| `src/components/features/tasks/TasksView.tsx` | terceira aba | médio |
| `src/lib/database.types.ts` | tipos das tabelas novas | baixo |

### Variáveis de ambiente

**Nenhuma nova.** O token vem do banco, e `TOKEN_ENCRYPTION_KEY` /
`TOKEN_ENCRYPTION_KEYS` já existem e já são rotacionáveis desde a 0015. Uma
integração inteira sem tocar em `.env` — é a vantagem de ter construído a
cifragem direito antes.

### Onde o dado é buscado, e por que não no servidor da página

A aba do ClickUp busca **ao ser clicada**, por Server Action, a partir do
cliente. Não em `tarefas/page.tsx`.

O motivo é concreto: `page.tsx` roda um `Promise.all` com cinco leituras antes
de renderizar. Enfiar uma chamada de rede externa ali faz **a sua lista pessoal
esperar pelo ClickUp** — e num dia em que a API deles estiver lenta, `/tarefas`
inteira fica lenta. Buscando sob demanda, o pior caso é uma aba com "não foi
possível carregar", e a lista pessoal nunca sabe que houve problema.

`page.tsx` faz apenas uma leitura barata no Postgres (conectado? ativo?) para
decidir se a aba aparece. Isso entra no `Promise.all` que já existe, então não
custa ida e volta a mais.

---

## Fase 1 — Banco (migration 0016)

**Entregável:** `supabase/migrations/0016_clickup.sql` + BLOCO 12 na verificação.
**Quem aplica:** você, no editor SQL do Supabase. O agente só escreve o arquivo.

### Modelo

Duas tabelas, espelhando exatamente a separação que o Google já usa
(`calendar_accounts` público + `google_oauth_credentials` fechado):

**`public.clickup_accounts`** — metadado não sensível, RLS pelo dono:

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → auth.users, **unique** | uma conexão por pessoa, garantido no banco |
| `clickup_user_id` | text not null | meu id no ClickUp — o filtro de `assignees[]` |
| `clickup_username` | text | para a tela dizer "conectado como Fulano" |
| `clickup_email` | citext | |
| `workspace_id` | text not null | o `team_id` da API |
| `workspace_name` | text | |
| `enabled` | boolean not null default true | o liga/desliga |
| `space_ids` | text[] not null default '{}' | filtro; vazio = todos |
| `status` | text not null default 'connected' | `connected` / `invalid` / `error` |
| `last_error` | text | |
| `last_checked_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | trigger `set_updated_at` |

**`public.clickup_credentials`** — o token:

| Coluna | Tipo |
|---|---|
| `clickup_account_id` | uuid pk → `clickup_accounts` **on delete cascade** |
| `token_ciphertext` | bytea not null |
| `token_iv` | bytea not null |
| `crypto_version` | smallint not null default 2 |
| `key_id` | text |
| `created_at` / `updated_at` | timestamptz |

### Regras obrigatórias na migration

```sql
-- clickup_accounts: RLS pelo dono, como as demais tabelas pessoais.
alter table public.clickup_accounts enable row level security;
create policy clickup_accounts_select on public.clickup_accounts
  for select to authenticated using (auth.uid() = user_id);
create policy clickup_accounts_insert on public.clickup_accounts
  for insert to authenticated with check (auth.uid() = user_id);
create policy clickup_accounts_update on public.clickup_accounts
  for update to authenticated using (auth.uid() = user_id)
                                 with check (auth.uid() = user_id);
create policy clickup_accounts_delete on public.clickup_accounts
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.clickup_accounts to authenticated;
revoke all on public.clickup_accounts from anon;

-- clickup_credentials: o molde de google_oauth_credentials, literalmente.
-- RLS ligada SEM policy nenhuma => authenticated e anon leem zero linhas.
-- Os grants revogados fecham a operação, não só a linha. service_role passa
-- por cima da RLS e é o único caminho.
alter table public.clickup_credentials enable row level security;
-- (nenhuma policy, de propósito)
revoke all on table public.clickup_credentials from anon, authenticated;
grant all on table public.clickup_credentials to service_role;
```

Mais: trigger `set_updated_at` nas duas, trigger `prevent_user_id_change` em
`clickup_accounts` (existe desde a 0001), e `comment on table` explicando o
papel de cada uma — a 0001 faz isso e é o que torna a intenção legível para quem
abrir o banco daqui a um ano.

> ⚠️ **A 0014 fechou `anon` numa varredura por lista de tabelas.** Tabela nova
> criada depois dela **não herda** nada: o Supabase concede privilégios a `anon`
> e `authenticated` por padrão no schema `public`. Os `revoke` acima não são
> zelo — são o que impede a tabela nova de nascer aberta. Sem eles, a 0016
> desfaz silenciosamente parte do trabalho da 0014.

### BLOCO 12 da verificação

Acrescentar em `supabase/verificacao.sql`, sem alterar a numeração existente (a
0008 e os planos citam blocos por número):

```sql
-- BLOCO 12 — ClickUp
select
  to_regclass('public.clickup_accounts')    is not null as tabela_contas_ok,
  to_regclass('public.clickup_credentials') is not null as tabela_cred_ok,
  (select relrowsecurity from pg_class
    where oid = 'public.clickup_credentials'::regclass)  as rls_cred_ligada,
  (select count(*) from pg_policies
    where tablename = 'clickup_credentials')             as policies_cred, -- deve ser 0
  (select count(*) from pg_policies
    where tablename = 'clickup_accounts')                as policies_contas, -- deve ser 4
  has_table_privilege('anon',          'public.clickup_credentials', 'select') as anon_le_cred,   -- false
  has_table_privilege('authenticated', 'public.clickup_credentials', 'select') as auth_le_cred,   -- false
  has_table_privilege('anon',          'public.clickup_accounts',    'select') as anon_le_contas; -- false
```

### Critério de aceite

Todos `true` menos os três últimos, que devem ser `false`; `policies_cred = 0`;
`policies_contas = 4`.

---

## Fase 2 — Núcleo de segurança (sem UI)

Nada aqui aparece na tela. É a fase que decide se o resto é seguro, e a ordem
importa: **2.1 antes de tudo**, porque mexe em código que já tem dado cifrado em
produção.

### 2.1 — Generalizar a cifragem ⚠️ ALTO RISCO

`tokens.ts` amarra o AAD à conta de calendário:

```ts
function aad(calendarAccountId: string, versao: number): Buffer {
  return Buffer.from(`${calendarAccountId}:${versao}`, "utf8");
}
```

**O que NÃO fazer:** passar o id do ClickUp em `encryptRefreshToken`. Funciona
hoje e cria dois problemas — o nome do parâmetro passa a mentir (num arquivo de
criptografia, onde a leitura precisa ser literal), e Google e ClickUp passam a
compartilhar o mesmo espaço de AAD, que é justamente o que o AAD existe para
separar.

**O que fazer:** extrair o núcleo e dar a cada integração o seu prefixo.

```ts
/** Núcleo. Recebe o AAD pronto — quem chama decide o namespace. */
export function cifrar(plaintext: string, aadPronto: Buffer): SegredoCifrado
export function decifrar(linha: LinhaCifrada, aadPronto: Buffer | null): string

// Calendário — formato INALTERADO. `<id>:<versao>`, sem prefixo.
// Mudar isto invalidaria todo refresh token já gravado.
function aadCalendario(id: string, v: number) { return Buffer.from(`${id}:${v}`) }

// ClickUp — namespace próprio desde a primeira linha.
function aadClickUp(id: string, v: number) { return Buffer.from(`clickup:${id}:${v}`) }
```

`encryptRefreshToken` / `decryptRefreshToken` viram invólucros finos sobre
`cifrar` / `decifrar` e **mantêm a assinatura atual**. Nenhum chamador do Google
muda de forma.

**Teste obrigatório antes de seguir:** um caso que cifra com `aadCalendario`,
decifra com `aadClickUp` e **espera falha**. É o que prova que a separação de
namespace funciona — sem ele, a extração é só um refactor com uma promessa.

**Critério de aceite:** `tokens.test.ts` passa inteiro **sem alteração**. Se um
caso existente precisou mudar, o formato mudou junto, e aí os dados em produção
já não abrem. Nesse cenário: pare e reveja.

### 2.2 — `capabilities.ts` — o cofre ⭐

O coração. **O único módulo do projeto que pode chamar `api.clickup.com`.**

```ts
import "server-only";

const BASE = "https://api.clickup.com/api/v2";

/**
 * As oito operações que existem. Não é configuração — é a definição do que o
 * aplicativo é capaz de fazer. Acrescentar uma linha aqui é ampliar o poder do
 * token sobre o workspace da empresa, e por isso a mudança tem que ser
 * conspícua: não há como ampliar sem editar esta tabela.
 *
 * `DELETE` não aparece em lugar nenhum. Não por omissão: por decisão. Apagar
 * tarefa não é uma coisa que este aplicativo deva ser capaz de fazer nem por
 * engano, nem sob requisição forjada, nem daqui a dois anos quando ninguém
 * lembrar por quê.
 */
const OPERACOES = {
  identificar:   { metodo: "GET",  rota: () => `/user` },
  workspaces:    { metodo: "GET",  rota: () => `/team` },
  minhasTarefas: { metodo: "GET",  rota: (p) => `/team/${p.teamId}/task` },
  umaTarefa:     { metodo: "GET",  rota: (p) => `/task/${p.taskId}` },
  statusDaLista: { metodo: "GET",  rota: (p) => `/list/${p.listId}` },
  lerComentarios:{ metodo: "GET",  rota: (p) => `/task/${p.taskId}/comment` },
  mudarStatus:   { metodo: "PUT",  rota: (p) => `/task/${p.taskId}` },
  comentar:      { metodo: "POST", rota: (p) => `/task/${p.taskId}/comment` },
} as const;

export type Operacao = keyof typeof OPERACOES;
```

Requisitos de `chamar()`:

1. **Assinatura fechada.** `chamar(op: Operacao, params, body?, query?)`. `op` é
   uma chave da tabela, então TypeScript recusa qualquer outra coisa em tempo de
   compilação, e uma checagem em tempo de execução recusa o que vier pela rede.
2. **`taskId` e `listId` validados por regex** (`/^[A-Za-z0-9_-]+$/`) antes de
   entrar na URL. Sem isso, um id com `../` viaja o path e alcança outra rota —
   e a tabela de operações teria sido contornada pela string.
3. **Header cru:** `Authorization: <token>`, **sem `Bearer`**. Com `Bearer` é
   401, e o 401 leva você a achar que o token está errado.
4. **Timeout** de ~10 s via `AbortSignal.timeout`. Sem ele, ClickUp lento
   segura a função serverless até o teto da plataforma.
5. **O token nunca é logado.** Erro de rede vira mensagem sem headers.
   Um `console.error(erroDoFetch)` cru pode carregar a requisição inteira.
6. **429 vira erro tipado**, não string — a UI precisa distinguir "tente daqui a
   pouco" de "deu erro".
7. **Sem retry automático em PUT/POST.** Retry de escrita é como o mesmo
   comentário aparece duas vezes na tarefa de um colega. GET pode retentar uma
   vez.

### 2.3 — `client.ts` — as oito funções

Uma função por operação. **Todas montam o próprio corpo**, nenhuma repassa
objeto recebido (§1). Assinaturas:

```ts
identificar(token): Promise<{ id: string; username: string; email: string }>
listarWorkspaces(token): Promise<{ id: string; name: string }[]>
listarMinhasTarefas(token, { teamId, meuId, spaceIds, pagina }): Promise<TarefaCrua[]>
obterTarefa(token, taskId): Promise<TarefaCrua>
statusDaLista(token, listId): Promise<{ status: string; cor: string; ordem: number }[]>
lerComentarios(token, taskId): Promise<ComentarioCru[]>
mudarStatus(token, taskId, status): Promise<void>      // corpo: { status }
comentar(token, taskId, texto): Promise<{ id: string }> // corpo: { comment_text, notify_all: false }
```

Detalhes que evitam retrabalho:

- `listarMinhasTarefas` **sempre** manda `assignees[]` com o meu id. Não é
  parâmetro opcional — sem ele o endpoint devolve o workspace inteiro.
- Paginação de 100 em 100, com **teto rígido de 5 páginas (500 tarefas)**. Um
  teto evita que um workspace enorme vire um laço que consome a cota de
  requisições da API. Quando o teto for atingido, a UI diz que há mais.
- `notify_all: false` em `comentar` — comentário vindo daqui não deve disparar
  notificação para o time inteiro.
- Datas do ClickUp são **string de milissegundos** (`"1754092800000"`). A
  conversão fica em `mapper.ts`, nunca espalhada pelos componentes.

### 2.4 — `credentials.ts`

```ts
salvarToken(userId, token, perfil): Promise<void>   // cifra e grava
lerToken(userId): Promise<string | null>            // decifra
apagarConexao(userId): Promise<void>                // cascade apaga a credencial
```

Usa `createAdminClient()` — é o único caminho até `clickup_credentials`.

> **Cuidado que vale a linha:** o admin client **ignora RLS**. Todo `select` e
> `update` aqui precisa de `.eq("user_id", userId)` explícito, com o `userId`
> vindo de `auth.getUser()` no servidor — nunca de parâmetro do cliente. É a
> mesma advertência que já está no cabeçalho de
> [`admin.ts`](segundo-cerebro/src/lib/supabase/admin.ts).

### 2.5 — `guard.ts` — a invariante I3

```ts
/**
 * Recusa a operação se a tarefa não tiver o meu id em `assignees[]`.
 *
 * Custa um GET a mais por escrita, e esse custo é o ponto: sem ele,
 * `mudarStatus` aceita qualquer id do workspace, porque Server Action é
 * endpoint HTTP público e o `taskId` chega pela rede. A verificação é o que
 * transforma "só nas tarefas que sou responsável" de intenção em garantia.
 *
 * Falhou a checagem por erro de rede? RECUSA. Em dúvida sobre autorização,
 * fechar é o único modo de falha aceitável.
 */
export async function garantirResponsavel(
  token: string, taskId: string, meuClickUpId: string,
): Promise<TarefaCrua>   // devolve a tarefa, para o chamador não buscar de novo
```

Devolver a tarefa evita um segundo GET: `mudarStatus` já precisa dela para
validar o status contra os status daquela lista.

### Testes desta fase

| Teste | O que prova |
|---|---|
| AAD cruzado Google↔ClickUp falha | os namespaces estão separados |
| `tokens.test.ts` intacto | nenhum dado cifrado foi invalidado |
| `chamar("apagar", …)` não compila / recusa | DELETE não é expressável |
| `taskId = "../../team/123"` é recusado | a regex protege o path |
| `mudarStatus` produz corpo com **exatamente** `{status}` | §1 |
| `garantirResponsavel` recusa tarefa de outro | I3 |
| `garantirResponsavel` recusa quando o GET falha | falha fechado |
| Nenhum `fetch` para clickup fora de `capabilities.ts` | I2 |

---

## Fase 3 — Configurações (conectar e desconectar)

**Entregável:** painel funcionando; ainda sem nada em Tarefas.

### `clickup-actions.ts` (configurações)

```ts
conectarClickUp(token: string): Promise<{ ok, error?, perfil? }>
alternarClickUp(ativo: boolean): Promise<ActionResult>
desconectarClickUp(): Promise<ActionResult>
definirEspacos(spaceIds: string[]): Promise<ActionResult>   // opcional
```

`conectarClickUp` — a ordem importa:

1. Zod: `/^pk_[A-Za-z0-9_]+$/`, 20–200 caracteres. Formato errado nem chega a
   virar requisição.
2. `bloqueioPorLimite("clickup:conectar", user.id, { maximo: 5, janelaMs: 60_000 })`.
   Mais apertado que o padrão de 30: conectar é operação rara, e sem freio a
   action vira um oráculo para testar tokens.
3. `identificar(token)` — se der 401, devolve *"Token recusado pelo ClickUp.
   Confira se copiou inteiro."* e **não grava nada**.
4. `listarWorkspaces(token)` — pega o primeiro. Se houver mais de um, grava o
   primeiro e a tela avisa qual foi.
5. Cifra e grava as duas tabelas.
6. `revalidatePath("/configuracoes")` e `revalidatePath("/tarefas")`.

Ponto de projeto: **testar antes de gravar.** Token inválido falha na hora, com
nome de gente na tela, em vez de virar uma aba quebrada em Tarefas depois.

### `IntegrationsPanel.tsx`

Estado desconectado: campo `type="password"`, `autoComplete="off"`,
`spellCheck={false}`, link para gerar o token no ClickUp, botão "Conectar".

Estado conectado:

```
ClickUp                                    [ ativo ● ]
✓ Conectado como Kauan Barateli
  Workspace: Acme · verificado hoje 14:32

  [ Testar conexão ]        [ Desconectar ]
```

Regras de interface:

- **O token nunca volta ao cliente.** Nem mascarado. A tela mostra nome e
  workspace, que é o que responde "é a conta certa?". Uma máscara
  `pk_••••3f2a` vazaria 4 caracteres sem necessidade — a decisão aqui é diferente
  da do brainstorming, e mais restritiva: os últimos caracteres não são
  necessários para identificar a conta quando o nome já está na tela.
- **Desconectar pede confirmação** e diz o que acontece: *"O token será apagado.
  Nada no ClickUp é alterado."* — isso importa, porque "desconectar" numa
  ferramenta de trabalho soa como se fosse mexer lá.
- **Desligar ≠ desconectar.** O toggle esconde a aba e para as chamadas; o token
  continua. São ações diferentes e ficam visualmente separadas.

`definirEspacos` fica para depois. A lista já vem filtrada por responsável; só
vale a pena se vier poluída.

### Critério de aceite

Colar token válido → nome e workspace aparecem. Colar token inválido → erro
claro, **nada gravado**. Desconectar → linha some das duas tabelas (confirmar no
BLOCO 12). Recarregar a página → estado persiste.

---

## Fase 4 — Leitura (a aba ClickUp)

### `tarefas/page.tsx`

Uma leitura a mais dentro do `Promise.all` que já existe — `getClickUpConnection()`,
devolvendo `{ conectado, ativo, username } | null`. Sem chamada de rede externa
aqui (§2).

### `TasksView.tsx`

`useState<"list" | "board">` vira `useState<"list" | "board" | "clickup">`. A
terceira aba só é renderizada quando `conexao?.ativo`.

> ⚠️ `initialView` vem de `ctx.preferences.default_task_view`, que é gravado no
> banco com um CHECK de dois valores. **Não** grave `"clickup"` como visão
> padrão sem uma migration que amplie o CHECK — e a recomendação é não gravar:
> a aba de trabalho não deve ser o que abre por padrão numa aplicação pessoal.

### `ClickUpPanel.tsx`

Busca ao montar, por Server Action. Estados obrigatórios, todos com texto real:

| Estado | Tela |
|---|---|
| Carregando | esqueleto de 3 cartões |
| Vazio | "Nenhuma tarefa atribuída a você." |
| Erro 401 | "O ClickUp recusou o token. Reconecte em Configurações." + link |
| Erro 429 | "Muitas consultas ao ClickUp. Tente em alguns instantes." |
| Erro geral | "Não foi possível falar com o ClickUp." + [Tentar de novo] |
| Teto de páginas | "Mostrando as primeiras 500." |

Cartão de tarefa: nome, lista, status (com a cor que a API devolve), prazo,
prioridade, e **link para abrir no ClickUp** (`url` vem na resposta) com
`target="_blank" rel="noopener noreferrer"` — o projeto já tem
`external-link.ts` para isso.

Ordenação padrão por prazo, vencidos primeiro. `include_closed=false`.

### Cache de sessão

Guardar o resultado em estado do React com carimbo de tempo e **não refazer a
busca por 60 s** ao alternar de aba. Sem isso, ir e voltar entre Lista e ClickUp
gasta a cota da API à toa.

### Critério de aceite

A aba lista suas tarefas reais. `/tarefas` continua abrindo na mesma velocidade
com o ClickUp desligado — e continua abrindo **mesmo com o ClickUp fora do ar**.

---

## Fase 5 — Escrita (status e comentário)

Só comece com a Fase 4 usada por alguns dias. Escrita é a única parte visível
para outras pessoas.

### `ClickUpTaskSheet.tsx`

Clicar num cartão abre um painel lateral: descrição, status atual, comentários
(buscados agora, **nunca persistidos** — são dados de colegas), campo de
comentário e seletor de status.

O seletor é populado por `statusDaLista(listId)` da lista **daquela** tarefa.
Não há dropdown fixo: cada Space define os seus.

### `tarefas/clickup-actions.ts`

```ts
listarTarefasClickUp(): Promise<{ ok, tarefas?, erro? }>
detalharTarefaClickUp(taskId): Promise<{ ok, tarefa?, comentarios?, statusPossiveis? }>
mudarStatusClickUp(taskId, status): Promise<ActionResult>
comentarClickUp(taskId, texto): Promise<ActionResult>
```

**Sequência obrigatória de toda escrita** — e as seis etapas são todas
necessárias:

```
1. auth.getUser()                        → sessão válida
2. bloqueioPorLimite("clickup:escrita")  → 10/min, mais apertado que o padrão
3. Zod                                   → taskId com formato de id; texto 1..10000
4. lerToken(user.id)                     → conexão existe e está ativa
5. garantirResponsavel(taskId)           → ⭐ I3 — a tarefa é minha?
6. a chamada                             → corpo montado, nunca repassado
```

Em `mudarStatusClickUp`, entre 5 e 6: **validar o status contra os status reais
da lista**. Status inválido é 400 do ClickUp com mensagem crua; validar antes dá
uma frase em português e não gasta a requisição.

### Comentário enviado duas vezes

O risco concreto: duplo clique, retry, ou `useTransition` mal amarrado, e o mesmo
comentário aparece duas vezes numa tarefa que colegas leem.

Três camadas, proporcionais ao problema:

1. Botão desabilitado durante o envio (`useTransition`) — resolve o duplo clique
2. Sem retry automático em POST (Fase 2.2) — resolve o retry
3. Limite de taxa em 10/min — resolve o laço

O campo só é limpo **depois** do `ok`. Se falhar, o texto continua lá: nada pior
que perder o que se escreveu porque a rede caiu.

### Confirmação

Mudar status: sem diálogo — é reversível e de baixo impacto. Otimista na UI, com
reversão se falhar.

Comentar: **sem** diálogo extra, mas o botão diz o destino de forma inequívoca —
*"Comentar no ClickUp"*, nunca só "Enviar". A pessoa precisa saber que aquilo sai
do aplicativo pessoal e aparece para o time.

### Critério de aceite

Mudar status daqui reflete no ClickUp. Comentar daqui aparece no ClickUp com o
seu nome. Chamar `mudarStatusClickUp` com o id de uma tarefa de outra pessoa
(teste manual, via console) → **recusado**.

---

## Fase 6 — Prova de que a limitação é real

Uma feature de segurança que não é verificável é uma intenção. Esta fase produz
as provas.

### 6.1 — Teste de superfície (I2)

```ts
it("só capabilities.ts fala com a API do ClickUp", async () => {
  const arquivos = await glob("src/**/*.{ts,tsx}");
  const infratores = arquivos.filter((f) =>
    leia(f).includes("api.clickup.com") &&
    !f.endsWith("lib/clickup/capabilities.ts"),
  );
  expect(infratores).toEqual([]);
});
```

Este teste é o que impede a erosão. Daqui a seis meses, quando alguém (ou um
agente) precisar de "só mais um endpoint", a suíte falha e a conversa acontece.

### 6.2 — Teste de operações (§0)

```ts
it("a tabela de operações tem exatamente as oito previstas", () => {
  expect(Object.keys(OPERACOES).sort()).toEqual([...]);  // lista literal
});

it("nenhuma operação usa DELETE", () => {
  for (const op of Object.values(OPERACOES)) expect(op.metodo).not.toBe("DELETE");
});
```

O primeiro parece bobo e é o mais valioso: **acrescentar uma operação quebra o
teste**, então ampliar o poder do aplicativo passa a ser um ato deliberado, com
uma linha de teste para editar junto.

### 6.3 — Teste de corpo (§1)

Com `fetch` interceptado, afirmar que o corpo de `mudarStatus` tem exatamente
uma chave, e que passar `{status, archived: true, name: "x"}` não produz
`archived` nem `name` na requisição.

### 6.4 — Varredura de vazamento (I1)

```bash
npm run build && grep -ril "clickup_credentials\|pk_" .next/static/chunks/
```

Deve devolver **zero**. Mesma técnica que pegou a regressão do `process.env[key]`
naquela sessão — e ela pegou o que typecheck, lint, 42 testes e build não
pegaram.

### 6.5 — Roteiro manual

- [ ] Token inválido → erro, nada gravado (BLOCO 12 confirma)
- [ ] Desligar → aba some; religar → volta sem reconectar
- [ ] Desconectar → as duas linhas somem
- [ ] ClickUp fora do ar (bloquear o domínio no `hosts`) → `/tarefas` abre normal
- [ ] DevTools → Network: nenhuma requisição do navegador para `clickup.com`
- [ ] DevTools → resposta das Server Actions: o token não aparece em nenhuma
- [ ] Mudar status → confere no ClickUp
- [ ] Comentar → confere no ClickUp, com o seu nome
- [ ] Console: `mudarStatusClickUp("<id de tarefa de colega>", "done")` → recusado

O penúltimo e o último são os que importam. Faça os dois.

---

## §7 — O que fica de fora, por escrito

Registrado para que "não implementamos" seja distinguível de "esquecemos":

| Fora do escopo | Por quê |
|---|---|
| Criar tarefa no ClickUp | O contexto está lá; criar daqui pede lista, espaço, campos obrigatórios |
| Apagar qualquer coisa | Nunca. Nem numa versão futura |
| Editar nome, descrição, prazo, prioridade | Amplia o corpo do PUT — §1 |
| Mexer em responsáveis | O caminho mais fácil de estragar a tarefa de um colega |
| Anexos, custom fields, tempo | Superfície grande, valor pessoal baixo |
| Webhooks | Só faz sentido com push implementado, que não existe |
| Persistir tarefas ou comentários | Dados de terceiros em banco pessoal |
| Fundir com a tabela `tasks` | Contaminaria "Cérebro em ordem" e acoplaria as falhas |
| Subtarefas aninhadas na UI | `subtasks=true` traz; exibir plano na V1 |

---

## §8 — Checklist de execução

**Fase 1 — Banco**
- [ ] `0016_clickup.sql` escrita (duas tabelas, RLS, grants, triggers, comments)
- [ ] BLOCO 12 acrescentado à `verificacao.sql`
- [ ] 🧑 **Você aplica a 0016 no Supabase**
- [ ] 🧑 **Você roda o BLOCO 12** — todos `true`, os três de acesso `false`

**Fase 2 — Núcleo**
- [ ] 2.1 `cifrar`/`decifrar` extraídos · `tokens.test.ts` passa **sem alteração**
- [ ] 2.1 teste de AAD cruzado falhando como esperado
- [ ] 2.2 `capabilities.ts` com as oito operações e o único `fetch`
- [ ] 2.3 `client.ts` — corpos construídos, nunca repassados
- [ ] 2.4 `credentials.ts` com `.eq("user_id", …)` em toda consulta
- [ ] 2.5 `guard.ts` falhando fechado
- [ ] Oito testes da Fase 2 passando

**Fase 3 — Configurações**
- [ ] Actions + `IntegrationsPanel` montado
- [ ] 🧑 **Você conecta com o seu token** e confere nome e workspace

**Fase 4 — Leitura**
- [ ] Aba ClickUp com os seis estados
- [ ] 🧑 **Você confere** que `/tarefas` não ficou mais lenta

**Fase 5 — Escrita**
- [ ] Painel lateral, seletor por lista, comentário
- [ ] Sequência de seis etapas em ambas as actions
- [ ] 🧑 **Você testa** mudar status e comentar de verdade

**Fase 6 — Prova**
- [ ] 6.1 a 6.4 automatizados e verdes
- [ ] 🧑 **Você roda o roteiro manual** — em especial os dois últimos itens

**Antes de considerar pronto**
- [ ] `PLANO-CLICKUP.md` no `.gitignore`
- [ ] `.env.local` sem `SENHA_MESTRA` e `KIT_DE_RECUPERACAO` (pendente desde a
      primeira sessão — acrescentar credencial de trabalho antes de resolver isso
      é aumentar a aposta numa mesa que ainda não está limpa)

---

## Ordem recomendada

Fases 1 e 2 juntas, e só então parar para revisar — é onde mora todo o risco
real. Fases 3 e 4 podem ir em seguida sem pausa; entregam valor e não escrevem
nada em lugar nenhum. **A Fase 5 merece uma pausa antes**: use a leitura por
alguns dias e confirme que escrever daqui é algo que você de fato quer, em vez de
algo que dá para construir.
