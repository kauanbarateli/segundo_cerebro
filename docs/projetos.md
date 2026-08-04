# Projetos

Agrupa tarefas, capturas, cadernos e pastas que **já existem**. Nada é
duplicado — é uma etiqueta que ganha uma tela própria.

---

## ⚠️ A decisão que manda em tudo: a coluna fica no CONTÊINER

| Tabela | `project_id`? | Por quê |
|---|---|---|
| `tasks` | ✅ | Já tem `category_id` nulável; projeto é faceta ortogonal |
| `captures` | ✅ | Idem |
| `knowledge_notebooks` | ✅ | O caderno já é contêiner **obrigatório** da página |
| `drive_folders` | ✅ | A pasta já é o endereço do arquivo |
| ~~`knowledge_pages`~~ | ❌ | Terceiro contêiner numa árvore com invariante |
| ~~`drive_files`~~ | ❌ | Todo upload na pasta do projeto já nasce no projeto |
| ~~`calendar_events`~~ | ❌ | É cache reescrito por sync |

`knowledge_pages` já tem `notebook_id not null` **mais** `parent_id`
autorreferente, com trigger obrigando mãe e filha ao mesmo caderno e uma CTE
recursiva arrastando a subárvore quando o caderno muda. Um `project_id` ali
criaria um **terceiro** contêiner numa árvore que já tem invariante escrita — e
nada impediria a página P no projeto A com a filha C no projeto B.

**O ganho é concreto:** "o conhecimento do projeto" são as páginas dos cadernos
do projeto, **de graça**. Zero invariante nova, zero trigger de árvore, zero CTE
recursiva — e `createPage`, `movePage`, `registerFile` e `moveFile` **não mudaram
uma linha**.

Isso também fechou um furo: com a coluna no *item*, **quatro** caminhos de
escrita descartariam `project_id` em silêncio (criar subpágina, registrar
upload, mover página, mover arquivo).

---

## ⚠️ `on delete set null` é apenas backstop

`projects` tem **soft delete** (`deleted_at`), casando com cadernos e pastas.
Consequência que precisa estar escrita:

> Com soft delete, `on delete set null` **nunca dispara**. Apagar um projeto é um
> `update`, não um `delete`. Ele só serve para um DELETE físico pelo console SQL.

Sem essa nota, o próximo leitor acha que é a proteção principal — e o modelo
produz exatamente o "órfão silencioso" que a `0009` usou como argumento para
matar o polimorfismo.

**A proteção real é a trigger** `enforce_project_alive_same_owner`, nas quatro
tabelas. Três detalhes que decidem se ela funciona:

- **`security invoker`** faz o SELECT passar pela RLS de quem chama: projeto de
  outra pessoa é invisível e cai no mesmo `null` de projeto inexistente.
  Resposta idêntica para os três casos (não existe / não é seu / foi apagado),
  deliberadamente — distinguir contaria a existência de projeto alheio.
- **`when (new.project_id is not null)` no trigger**, não dentro da função:
  `tasks` é tabela quente e a maioria das escritas não tem projeto, então o
  caminho comum não paga nem a chamada.
- **BEFORE comum**, não `constraint trigger deferrable`. A `0011` só precisou de
  adiamento por causa da CTE recursiva. Como este desenho não propaga nada, a
  forma barata está disponível — e isso é o pagamento concreto da decisão de pôr
  a coluna no contêiner.

Apagar um projeto **não mexe** no `project_id` de nada: restaurar devolve o
conteúdo inteiro. As telas filtram por `deleted_at is null`, então o conteúdo
aparece "sem projeto" enquanto o projeto estiver apagado.

---

## Regra de desempate

> **O projeto de uma captura é `captures.project_id` e só ele. Vínculo da `0009`
> nunca implica pertencimento a projeto.**

Sem essa frase, toda captura convertida tem duas respostas para "de que projeto é
isto?" — a coluna dela e a da tarefa que nasceu dela. A conversão iguala as duas
no t0 e não define nada para o t1: mover a tarefa para outro projeto deixa a
captura no antigo.

A tela lista **Capturas e Tarefas em seções separadas**, então a divergência fica
*visível* em vez de silenciosa.

---

## A agenda sai das tarefas, não dos vínculos

Usa `due_at` / `scheduled_start_at` — campos que as tarefas **já têm**.

O cabeçalho da `0009` define vínculo como **procedência** ("esta tarefa nasceu
daquela reunião"). Derivar a agenda dele transformaria procedência em
pertencimento: a 1:1 semanal ligada a tarefas de três projetos apareceria nas
três agendas, sem forma de tirá-la de uma sem apagar um vínculo que quer dizer
outra coisa.

---

## ⚠️ `convert_capture_to_task` foi reescrita pela TERCEIRA vez

Caminho: `0001` (criação) → `0009` (acrescentou o vínculo) → `0017`
(acrescenta `project_id`). Cada versão transcreve o corpo inteiro da anterior.

**O perigo não é o `project_id`.** É perder na transcrição o bloco
`insert into public.task_capture_links ... on conflict do nothing` que a `0009`
acrescentou. Isso regride a funcionalidade daquela migration **em silêncio**: os
selos de vínculo somem só nas conversões novas, nada falha, nada avisa, e a
causa fica a duas migrations de distância do sintoma.

Por isso existe [`migracao-0017-conversao-de-captura.test.ts`](../src/test/migracao-0017-conversao-de-captura.test.ts),
que lê o `.sql` e afirma sobre a **forma** da função. Verificado que ele fica
vermelho quando o insert do vínculo é removido.

E há um segundo cuidado, que só o teste não pega: a função é `security definer`
com `set search_path = ''`, ou seja **roda fora da RLS**. A trigger de guarda,
sendo `security invoker`, avalia ali como *dona* das tabelas e **não barra
nada** — a checagem vira no-op justamente no caminho onde ninguém olha. Por isso
o `project_id` copiado passa por um subselect que filtra projeto apagado.

---

## Roteiro de verificação manual

- [ ] 🔧 Aplicar a migration `0017` e rodar o **BLOCO 14** da `verificacao.sql`
- [ ] ⚠️ No BLOCO 14, conferir que `col_paginas_DEVE_SER_0` e
      `col_arquivos_DEVE_SER_0` são **zero**. É a prova de que a decisão de
      modelo foi respeitada
- [ ] 🔧 **Abrir `/projetos` no navegador.** Os três comandos verdes não são
      evidência de que o módulo carrega
- [ ] Criar um projeto, atribuí-lo a uma tarefa e a um caderno
- [ ] Criar uma página dentro daquele caderno → ela aparece na seção
      **Conhecimento** do projeto, **sem** ter `project_id`
- [ ] Apagar o projeto → as tarefas e cadernos continuam existindo
- [ ] Converter uma captura com projeto → a tarefa nasce no mesmo projeto **e o
      selo de vínculo aparece** (é a regressão que o teste de migration protege)
- [ ] Desligar o módulo em Configurações → o link some da barra lateral, e o
      seletor de projeto some dos formulários de tarefa e captura
