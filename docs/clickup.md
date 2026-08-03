# Integração ClickUp

Escopo fechado de propósito: o objetivo não é "integrar", é integrar de um jeito
em que **o aplicativo seja incapaz** de fazer mais do que três coisas — mesmo
que o token permita tudo.

---

## O contrato

### O que o aplicativo faz

1. Lê as tarefas em que você é responsável
2. Muda o status dessas tarefas
3. Comenta nessas tarefas

São oito operações de API no total (`/user`, `/team`, `/team/{id}/task`,
`/task/{id}`, `/list/{id}`, `/task/{id}/comment` ×2, `PUT /task/{id}`).

### O que ele **não consegue** fazer

Não "não faz" — **não consegue**, porque o caminho não existe no código:

- Apagar tarefa, lista, pasta, espaço ou comentário — `DELETE` não é expressável
- Criar tarefa, lista ou pasta
- Renomear, reescrever descrição, mudar prazo ou prioridade
- **Adicionar ou remover responsáveis** (inclusive tirar um colega da tarefa)
- Arquivar ou mover entre listas
- Mexer em qualquer tarefa da qual você **não** é responsável
- Anexos, apontamento de tempo, custom fields, webhooks

> ⚠️ **O token pessoal do ClickUp não tem escopo.** Ele é a chave da sua conta
> inteira no workspace da empresa. A limitação acima mora no **código deste
> aplicativo**, não no token — quem obtiver o token não fica limitado a nada.
> Por isso ele vive cifrado numa tabela que a sessão do navegador não alcança.

---

## As três invariantes

| | Invariante | Onde vive | Prova |
|---|---|---|---|
| **I1** | O token nunca sai do servidor | `credentials.ts` (admin client) | varredura do bundle no CI |
| **I2** | Um só arquivo fala com `api.clickup.com` | `capabilities.ts` | `capabilities.test.ts` |
| **I3** | Toda escrita verifica a responsabilidade antes | `guard.ts` | `guard.test.ts` |

**I1** — nem em prop, nem em resposta de action, nem mascarado. A tela mostra
nome e workspace, que é o que responde "é a conta certa?". Uma máscara
`pk_••••3f2a` entregaria quatro caracteres sem necessidade.

**I2** — há um teste que varre `src/` e falha se `api.clickup.com` aparecer em
qualquer outro arquivo. É o que impede a erosão: quando alguém precisar de "só
mais um endpoint", a suíte quebra e a conversa acontece antes do commit.

**I3** — `"use server"` **não** é fronteira de confiança. O Next publica um id
por função exportada e qualquer um manda POST direto com o `taskId` que quiser.
Sem a verificação, "só nas minhas tarefas" seria uma frase sobre a tela.

---

## A armadilha que orienta o desenho

`PUT /api/v2/task/{task_id}` **não é** o endpoint de "mudar status". É o de
**alterar tarefa**, e o que ele faz depende do corpo:

```jsonc
{
  "status": "in progress",             // o que queremos
  "name": "outro nome",                // renomeia
  "due_date": "1754092800000",         // muda prazo
  "assignees": { "rem": [12345] },     // TIRA UM COLEGA DA TAREFA
  "archived": true                     // arquiva
}
```

Um allowlist por *rota* deixaria tudo isso passar. Por isso a limitação está no
**corpo**, e por **construção** — não por filtragem:

```ts
// A função recebe uma STRING e monta o objeto. Não existe parâmetro por onde
// entrar outra coisa.
export async function mudarStatus(token: string, taskId: string, status: string) {
  return chamar("mudarStatus", token, { taskId }, { corpo: { status } });
}
```

---

## Onde cada coisa mora

```
src/lib/clickup/
  capabilities.ts   ⭐ tabela de 8 operações + o ÚNICO fetch do projeto
  client.ts            as 8 funções, cada uma montando o próprio corpo
  guard.ts          ⭐ garantirResponsavel() — a invariante I3
  credentials.ts       ler/gravar o token cifrado (admin client)
  mapper.ts            resposta crua → modelo da UI (datas em ms!)
  types.ts / erros.ts

src/app/(app)/configuracoes/clickup-actions.ts   conectar, testar, desconectar
src/app/(app)/tarefas/clickup-actions.ts         listar, detalhar, status, comentar
```

**Nenhuma variável de ambiente nova.** O token vem do banco e usa
`TOKEN_ENCRYPTION_KEY(S)`, que já existe e já é rotacionável desde a 0015. O AAD
tem namespace próprio (`clickup:<id>:<versão>`), separado do Google.

---

## Conectar

1. ClickUp → foto do perfil → **Settings → Apps → API Token**
2. Segundo Cérebro → **Configurações → Integrações → ClickUp** → colar → Conectar

O token é **testado antes de ser gravado**: se o ClickUp recusar, nada é salvo e
o erro aparece ali, com nome de gente na tela quando dá certo.

**Desligar ≠ desconectar.** O interruptor esconde a aba e para as chamadas,
mantendo o token. Desconectar apaga — e não altera nada no ClickUp.

---

## Roteiro de verificação manual

A parte automatizada (61 testes + varredura do bundle no CI) cobre o código.
Estes passos cobrem o que só a execução real mostra.

- [ ] Token **inválido** → erro claro, e **nada gravado** (confirme no BLOCO 13
      da `verificacao.sql`: nenhuma linha nas duas tabelas)
- [ ] Desligar → a aba some; religar → volta sem precisar reconectar
- [ ] Desconectar → as duas linhas somem
- [ ] **ClickUp fora do ar** (bloqueie `api.clickup.com` no arquivo `hosts`) →
      `/tarefas` abre normal e na mesma velocidade; só a aba do ClickUp acusa
- [ ] DevTools → **Network**: nenhuma requisição do navegador para `clickup.com`
- [ ] DevTools → resposta das Server Actions: o token **não** aparece em nenhuma
- [ ] Mudar status daqui → confere no ClickUp
- [ ] Comentar daqui → aparece no ClickUp com o seu nome
- [ ] No console do navegador, com o id de uma tarefa **de um colega**:
      chamar a action de mudar status → **recusado**

> Os três últimos são os que importam. O penúltimo prova a I1; o último prova a
> I3, que é a única coisa entre este aplicativo e a tarefa de outra pessoa.

---

## Fora de escopo, por escrito

Registrado para que "não implementamos" seja distinguível de "esquecemos":

| Fora | Por quê |
|---|---|
| Criar tarefa | O contexto está lá; criar daqui pede lista, espaço, campos obrigatórios |
| Apagar qualquer coisa | Nunca. Nem numa versão futura |
| Editar nome, descrição, prazo, prioridade | Amplia o corpo do PUT |
| Mexer em responsáveis | O jeito mais fácil de estragar a tarefa de um colega |
| Anexos, custom fields, tempo | Superfície grande, valor pessoal baixo |
| Webhooks | Só faz sentido com push, que não existe |
| Persistir tarefas ou comentários | Dados de terceiros em banco pessoal |
| Fundir com a tabela `tasks` | Contaminaria "Cérebro em ordem" e acoplaria as falhas |
