import { z } from "zod";
import { LIMITE_DE_LINKS, urlSegura } from "@/lib/social";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done", "archived"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const captureTypeSchema = z.enum(["idea", "task", "note", "reminder"]);
export const themeSchema = z.enum(["light", "dark", "system"]);
export const vaultItemTypeSchema = z.enum([
  "login",
  "account",
  "document",
  "financial",
  "secure_note",
]);

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalDateTime = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? new Date(v).toISOString() : null));

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Informe um título").max(200),
  description: optionalString,
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  priority: taskPrioritySchema.default("medium"),
  status: taskStatusSchema.default("todo"),
  dueAt: optionalDateTime,
  scheduledStartAt: optionalDateTime,
  scheduledEndAt: optionalDateTime,
  allDay: z.coerce.boolean().default(false),
  estimatedMinutes: z.coerce.number().int().positive().nullable().optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export const captureInputSchema = z.object({
  type: captureTypeSchema.default("note"),
  title: optionalString,
  content: z.string().trim().max(10_000).optional().default(""),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type CaptureInput = z.infer<typeof captureInputSchema>;

// Edição de uma captura já existente. Difere do schema de criação em dois
// pontos, e os dois são de propósito: exige o `id` (sem ele não há o que
// atualizar) e não aplica default em `type` — na criação "note" é um chute
// razoável, na edição um tipo ausente significaria sobrescrever silenciosamente
// a escolha que o usuário já tinha feito.
export const captureUpdateSchema = z.object({
  id: z.string().uuid(),
  type: captureTypeSchema,
  title: optionalString,
  content: z.string().trim().max(10_000).optional().default(""),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type CaptureUpdateInput = z.infer<typeof captureUpdateSchema>;

/** The encrypted item the client sends to the server — never plaintext. */
export const vaultItemUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  itemType: vaultItemTypeSchema,
  encryptedPayload: z.string().min(1), // base64 ciphertext
  itemIv: z.string().min(1), // base64 iv
  favorite: z.boolean().default(false),
});

export type VaultItemUpsertInput = z.infer<typeof vaultItemUpsertSchema>;

// `day_mode` continua existindo no banco (a coluna é mantida de propósito —
// remover coluna é destrutivo e o custo de deixar é zero), mas saiu da
// interface e não é mais aceita como entrada.
export const preferencesInputSchema = z.object({
  theme: themeSchema.optional(),
  defaultCalendarView: z.enum(["day", "week", "month", "list"]).optional(),
  defaultTaskView: z.enum(["list", "board"]).optional(),
  financeHideValues: z.boolean().optional(),
});

/* ------------------------------------------------------------------- perfil */

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(1, "Informe um nome").max(60, "Máximo de 60 caracteres"),
});

/* ------------------------------------------------------------------ módulos */

export const moduleToggleSchema = z.object({
  moduleKey: z.string().trim().min(1).max(40),
  enabled: z.boolean(),
});

/* ------------------------------------------------------------ notificações */

export const LEAD_MINUTE_OPTIONS = [0, 5, 10, 15, 30, 60, 120] as const;

export const notificationPreferencesSchema = z.object({
  notificationsEnabled: z.boolean(),
  leadMinutes: z
    .array(z.number().int().refine((n) => (LEAD_MINUTE_OPTIONS as readonly number[]).includes(n)))
    .min(1, "Escolha ao menos uma antecedência")
    .max(3, "No máximo 3 antecedências"),
  channel: z.enum(["in_app", "push", "both"]),
});

/* ------------------------------------------------------------------ kanban */

export const moveTaskSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  position: z.number(),
});

/* --------------------------------------------------------------- financeiro */

/**
 * Dia do mês de fechamento/vencimento do cartão.
 *
 * `nullable().optional()` e não `optional()` só: o formulário precisa conseguir
 * LIMPAR o campo (ao trocar o tipo de "cartão" para "conta corrente"), e um
 * campo ausente é indistinguível de "não mexi nele". `null` diz "apague".
 */
const diaDoMes = (rotulo: string) =>
  z
    .number({ invalid_type_error: `Informe o dia ${rotulo}` })
    .int(`O dia ${rotulo} precisa ser um número inteiro`)
    .min(1, `O dia ${rotulo} precisa estar entre 1 e 31`)
    .max(31, `O dia ${rotulo} precisa estar entre 1 e 31`)
    .nullable()
    .optional();

export const financeAccountSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Informe um nome").max(80),
    kind: z.enum(["checking", "savings", "credit_card", "cash", "investment", "other"]),
    institution: optionalString,
    openingBalanceCents: z.number().int(),
    colorKey: z.string().trim().max(20).default("stone"),
    // Cartão de crédito (0010). Opcionais no schema porque a esmagadora maioria
    // das contas não é cartão; o superRefine abaixo os torna obrigatórios quando
    // precisam ser.
    creditLimitCents: z
      .number()
      .int()
      .positive("O limite do cartão precisa ser maior que zero")
      .nullable()
      .optional(),
    statementClosingDay: diaDoMes("de fechamento"),
    paymentDueDay: diaDoMes("de vencimento"),
  })
  /**
   * Espelha o CHECK `finance_accounts_credit_card_fields_check` da 0010. As duas
   * barreiras existem de propósito e não são redundância: aqui a recusa vira
   * mensagem em português apontando o campo, e o usuário conserta; lá é a
   * garantia de que nenhum caminho de escrita (outra action, um script, o SQL
   * editor do Supabase) consegue gravar um cartão pela metade. Validação de
   * formulário protege a pessoa, constraint protege o dado.
   *
   * `superRefine` e não `refine`: são três campos independentes e cada um
   * precisa do seu `path`, senão o formulário destaca o campo errado (ou nenhum).
   */
  .superRefine((valores, ctx) => {
    if (valores.kind !== "credit_card") return;

    // `== null` cobre null E undefined de uma vez — os dois significam "não
    // informado" aqui, e tratar só um deixaria o outro passar direto.
    const exigidos: [keyof typeof valores, unknown, string][] = [
      ["creditLimitCents", valores.creditLimitCents, "Informe o limite do cartão"],
      [
        "statementClosingDay",
        valores.statementClosingDay,
        "Informe o dia em que a fatura fecha",
      ],
      ["paymentDueDay", valores.paymentDueDay, "Informe o dia em que a fatura vence"],
    ];

    for (const [campo, valor, mensagem] of exigidos) {
      if (valor == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensagem });
      }
    }
  });

export const financeCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe um nome").max(60),
  kind: z.enum(["income", "expense"]),
  colorKey: z.string().trim().max(20).default("stone"),
});

export const financeTagSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe um nome").max(40),
  colorKey: z.string().trim().max(20).default("stone"),
});

export const financeTransactionSchema = z.object({
  id: z.string().uuid().optional(),
  accountId: z.string().uuid("Escolha uma conta"),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  kind: z.enum(["income", "expense"]),
  amountCents: z.number().int().positive("Informe um valor maior que zero"),
  description: z.string().trim().min(1, "Informe uma descrição").max(160),
  payee: optionalString,
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  notes: optionalString,
  isPaid: z.boolean().default(true),
  tagIds: z.array(z.string().uuid()).max(10).default([]),
});

export const financeTransferSchema = z.object({
  fromAccountId: z.string().uuid("Escolha a conta de origem"),
  toAccountId: z.string().uuid("Escolha a conta de destino"),
  amountCents: z.number().int().positive("Informe um valor maior que zero"),
  description: z.string().trim().min(1).max(160),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Compra parcelada no cartão (0010).
 *
 * O que entra é o TOTAL da compra e o número de parcelas — nunca o valor da
 * parcela. Pedir o valor da parcela obrigaria a multiplicar por N para reconstruir
 * o total, e 3 × R$ 33,33 não é R$ 100,00: a compra nasceria devendo um centavo.
 * O rateio é de `parcelas()` em src/lib/credit.ts, com a última absorvendo o resto.
 */
export const financeInstallmentSchema = z
  .object({
    accountId: z.string().uuid("Escolha uma conta"),
    categoryId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
    // 140 e não 160 (o limite de financeTransactionSchema) porque a descrição de
    // cada linha ganha o sufixo " (12/36)". Cortar aqui, na borda, dá uma
    // mensagem clara; cortar depois truncaria a descrição do usuário em silêncio.
    description: z
      .string()
      .trim()
      .min(1, "Informe uma descrição")
      .max(140, "Máximo de 140 caracteres (o número da parcela ainda entra na descrição)"),
    totalAmountCents: z.number().int().positive("Informe um valor maior que zero"),
    installments: z
      .number()
      .int("O número de parcelas precisa ser inteiro")
      .min(1, "No mínimo 1 parcela")
      .max(36, "No máximo 36 parcelas"),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
    tagIds: z.array(z.string().uuid()).max(10).default([]),
  })
  /**
   * Cada parcela vira um lançamento, e `finance_tx_amount_positive` exige
   * amount_cents > 0. Com total < parcelas o rateio produz linhas de zero centavo
   * e o INSERT inteiro é recusado pelo banco com uma mensagem crua de constraint.
   * A condição é exata: `trunc(total / n) >= 1` se e somente se `total >= n`.
   */
  .refine((v) => v.totalAmountCents >= v.installments, {
    path: ["installments"],
    message: "Parcelas demais para esse valor: cada parcela precisa ter ao menos um centavo",
  });

/**
 * Pagamento de fatura de cartão (0010).
 *
 * Não tem `description`: ela é montada no servidor a partir do mês da fatura,
 * para que toda linha de pagamento seja reconhecível e o texto não vire mais um
 * campo livre que ninguém preenche igual.
 *
 * `mesFatura` é o mês em que a fatura FECHA, canônico "YYYY-MM-01" (mesmo
 * formato de `finance_budgets.month` e de `finance_transactions.statement_month`).
 * Ele é ESCOLHA do usuário e não é derivado da data do pagamento: quem paga a
 * fatura de abril no dia 5 de maio está pagando abril, e `faturaDe()` sobre a
 * data do pagamento responderia "maio".
 */
export const financeStatementPaymentSchema = z
  .object({
    cardAccountId: z.string().uuid("Escolha o cartão"),
    fromAccountId: z.string().uuid("Escolha a conta de origem"),
    mesFatura: z.string().regex(/^\d{4}-\d{2}-01$/, "Mês da fatura inválido"),
    amountCents: z.number().int().positive("Informe um valor maior que zero"),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  })
  .refine((v) => v.cardAccountId !== v.fromAccountId, {
    path: ["fromAccountId"],
    message: "O cartão não pode pagar a si mesmo: escolha a conta de onde sai o dinheiro",
  });

export const financeBudgetSchema = z.object({
  categoryId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/, "Mês inválido"),
  limitCents: z.number().int().positive(),
});

/* ----------------------------------------------------------------- vínculos */

/**
 * Tipo do vínculo entre duas entidades (0009).
 *
 * Enum FECHADO, e isso é requisito de segurança, não preferência de estilo: a
 * action traduz este valor em nome de TABELA e de COLUNA. Se o tipo fosse
 * `z.string()`, o nome da tabela passaria a vir, por um caminho indireto, da
 * entrada do usuário. Com o enum, qualquer valor fora dos três é recusado na
 * borda e o mapa de tradução na action é literal no código.
 *
 * A ordem das pontas segue o nome: em 'task-capture', `aId` é a tarefa e `bId` é
 * a captura. Trocar a ordem não "quase funciona" — cai no `uuid` errado e o
 * trigger de propriedade do banco recusa.
 */
export const linkKindSchema = z.enum(["task-capture", "task-event", "capture-event"]);
export type LinkKind = z.infer<typeof linkKindSchema>;

export const linkInputSchema = z.object({
  tipo: linkKindSchema,
  // Server action é endpoint HTTP: os dois ids são validados como uuid ANTES de
  // qualquer ida ao banco. Sem isso, um id malformado não vira "0 linhas" —
  // vira erro de cast do Postgres, e a mensagem crua acaba no toast do usuário.
  aId: z.string().uuid("Item inválido"),
  bId: z.string().uuid("Item inválido"),
});
export type LinkInput = z.infer<typeof linkInputSchema>;

/* -------------------------------------------------------------------- drive */

// Nome sem barra e sem os caracteres proibidos no Windows — evita surpresa ao
// baixar o arquivo.
const safeName = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(120)
  .refine((v) => !/[/\\:*?"<>|]/.test(v), "O nome contém caracteres inválidos");

export const driveFolderSchema = z.object({
  id: z.string().uuid().optional(),
  name: safeName,
  parentId: z.string().uuid().nullable().default(null),
});

export const driveRenameSchema = z.object({
  id: z.string().uuid(),
  name: safeName,
});

export const driveMoveSchema = z.object({
  id: z.string().uuid(),
  targetFolderId: z.string().uuid().nullable(),
});

/**
 * NÃO tem `sizeBytes`, e a ausência é o ponto.
 *
 * O campo existia e era gravado direto em `drive_files.size_bytes` — o número
 * que `drive_usage` soma para desenhar a barra de armazenamento. Vindo do
 * cliente, era um valor que o cliente escolhia: 40 MB enviados podiam ser
 * declarados como 1 KB. Agora `registerFile` pergunta o tamanho ao Storage.
 *
 * Deixar o campo aqui como opcional-e-ignorado seria pior que removê-lo: o
 * schema é o contrato que se lê para saber o que a ação aceita, e um campo que
 * aparece no contrato mas não tem efeito é um convite a alguém religá-lo. Zod
 * ignora chaves extras por padrão, então um cliente que ainda mande `sizeBytes`
 * continua passando — o valor apenas não vai a lugar nenhum.
 */
export const driveFileRegisterSchema = z.object({
  name: safeName,
  storagePath: z.string().min(1),
  mimeType: z.string().max(160).nullable().default(null),
  folderId: z.string().uuid().nullable().default(null),
});

/* ------------------------------------------------------------- conhecimento */

/**
 * Teto do documento serializado, em unidades de código UTF-16 do JSON.
 *
 * ~1 MB é folgado para prosa (um livro inteiro tem ~2 MB de texto puro) e ainda
 * assim impede que um cliente hostil despeje um documento de 500 MB no corpo da
 * server action. A conta é em `length` da string, não em bytes UTF-8 exatos:
 * medir bytes de verdade exigiria `new TextEncoder().encode(json)`, que aloca
 * uma cópia inteira do documento a cada salvamento — custo real, no caminho mais
 * quente do módulo, para refinar um limite que é uma barreira grosseira por
 * natureza. Para texto ASCII os dois números coincidem; para acentuado, o limite
 * efetivo em bytes é maior, e isso está OK.
 */
const PROSEMIRROR_MAX_LEN = 1_000_000;

/**
 * Profundidade máxima de aninhamento do documento.
 *
 * Documento do ProseMirror é raso na prática: doc > tabela > linha > célula >
 * lista > item > parágrafo > texto não passa de uma dúzia de níveis. 100 dá
 * margem enorme e ainda barra o ataque, que é mandar `[[[[[...]]]]]` com dezenas
 * de milhares de níveis. Sem esse teto, o aninhamento vira negação de serviço em
 * três lugares de uma vez: no `JSON.stringify` daqui, na trigger de extração de
 * texto do banco (que percorre o documento inteiro em toda escrita) e no editor
 * do navegador, que remonta o documento nó a nó.
 */
const PROSEMIRROR_MAX_DEPTH = 100;

/**
 * Mede a profundidade com PILHA EXPLÍCITA, nunca com recursão.
 *
 * Uma travessia recursiva estouraria a pilha de chamadas exatamente na entrada
 * maliciosa que ela deveria recusar — o `RangeError` viraria um 500 no lugar de
 * uma mensagem de validação. Aqui o crescimento é em memória (heap), já limitado
 * pelo teste de tamanho que roda antes, e a saída é antecipada assim que o
 * limite é ultrapassado.
 */
function profundidadeExcede(raiz: unknown, limite: number): boolean {
  const pilha: { valor: unknown; nivel: number }[] = [{ valor: raiz, nivel: 1 }];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (!atual) break;
    if (atual.nivel > limite) return true;
    const valor = atual.valor;
    if (Array.isArray(valor)) {
      for (const item of valor) pilha.push({ valor: item, nivel: atual.nivel + 1 });
    } else if (valor !== null && typeof valor === "object") {
      for (const item of Object.values(valor)) pilha.push({ valor: item, nivel: atual.nivel + 1 });
    }
  }
  return false;
}

/**
 * Documento do editor que chega do cliente.
 *
 * Server action é ENDPOINT HTTP: o que chega aqui é um objeto arbitrário vindo
 * da rede, não "o que o editor mandou". Aceitá-lo cru seria aceitar qualquer
 * jsonb de qualquer tamanho — e o CHECK do banco só exige que seja um objeto.
 *
 * Três barreiras, nesta ordem, e a ordem importa:
 *
 *   1. `type: "doc"` na raiz. Barato, elimina o lixo óbvio e garante ao editor
 *      que o que ele recebe de volta é montável. O CHECK do banco
 *      (`jsonb_typeof(content) = 'object'`) aceitaria `{"foo":1}`.
 *   2. TAMANHO, via `JSON.stringify` dentro de try/catch. O try/catch não é
 *      decoração: `stringify` é recursivo e levanta `RangeError` num documento
 *      fundo demais — sem capturar, a validação derrubaria a requisição com 500
 *      em vez de recusar educadamente. Referência cíclica também cai aqui.
 *   3. PROFUNDIDADE. Roda depois do tamanho de propósito: com o documento já
 *      limitado a ~1 MB, a travessia é O(n) sobre algo pequeno.
 *
 * `.passthrough()` é OBRIGATÓRIO. O modo padrão do zod REMOVE chaves
 * desconhecidas: um `.object()` normal apagaria em silêncio todo campo da raiz
 * que não estivesse declarado aqui e gravaria o documento mutilado no banco. O
 * conteúdo interno passa como `z.unknown()` pelo mesmo motivo — quem conhece o
 * schema dos nós é o editor, não este arquivo.
 */
export const prosemirrorDocSchema = z
  .object({
    type: z.literal("doc", {
      errorMap: () => ({ message: "Documento inválido: a raiz precisa ser do tipo 'doc'" }),
    }),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((doc, ctx) => {
    let serializado: string;
    try {
      serializado = JSON.stringify(doc);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Documento inválido" });
      return;
    }

    if (serializado.length > PROSEMIRROR_MAX_LEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Esta página ficou grande demais: divida o conteúdo em páginas menores",
      });
      return;
    }

    if (profundidadeExcede(doc, PROSEMIRROR_MAX_DEPTH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Documento com aninhamento profundo demais",
      });
    }
  });

export const knowledgeNotebookSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe um nome").max(80),
  colorKey: z.string().trim().max(20).default("stone"),
});

/**
 * Título da página, no caminho em que ele é OBRIGATÓRIO (criar, renomear).
 *
 * O autosave usa outra regra — ver `knowledgePageContentSchema`.
 */
const knowledgePageTitle = z.string().trim().min(1, "Informe um título").max(200);

export const knowledgePageSchema = z.object({
  id: z.string().uuid().optional(),
  notebookId: z.string().uuid("Escolha um caderno"),
  parentId: z.string().uuid().nullable().default(null),
  title: knowledgePageTitle,
  content: prosemirrorDocSchema,
});

/**
 * Criação: título e conteúdo são opcionais.
 *
 * "Nova página" cria a linha e joga o cursor no editor — não existe formulário
 * onde digitar o título antes. A action preenche os dois com os padrões de
 * `src/lib/knowledge.ts`. Derivado de `knowledgePageSchema` com `.partial()` em
 * vez de reescrito: duas listas de campos parecidas divergem na primeira
 * mudança, e a divergência não dá erro de compilação.
 */
export const knowledgeCreatePageSchema = knowledgePageSchema.partial({
  title: true,
  content: true,
});

/**
 * Carimbo de tempo devolvido pelo banco, ecoado de volta VERBATIM.
 *
 * Regex explícita, e não `z.string().datetime()`: o PostgREST devolve
 * timestamptz com microssegundos e deslocamento ("2026-08-02T12:34:56.789123+00:00"),
 * uma forma que as variantes de `datetime()` aceitam ou não conforme a opção
 * `offset`. Errar aqui não daria um bug visível — daria autosave sempre
 * recusado.
 *
 * A regex também é lista branca de caracteres, e isso importa: este valor vira
 * um filtro do PostgREST (`updated_at=eq.<valor>`), onde vírgula, parêntese e
 * aspas têm significado sintático. Nada disso passa.
 */
const knowledgeTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/,
    "Carimbo de tempo inválido",
  );

/**
 * Salvamento do editor (autosave). É o schema do caminho mais quente do módulo.
 *
 * `title` aqui NÃO tem `min(1)` nem `.trim()`, ao contrário de todos os outros
 * títulos do projeto, e os dois desvios são deliberados:
 *
 *   - sem `min(1)`: o usuário apaga o título inteiro para reescrevê-lo, e o
 *     autosave dispara no meio disso. Recusar a gravação nesse instante
 *     descartaria também o CONTEÚDO que veio junto no mesmo pacote. O banco
 *     aceita título em branco de propósito (ver o comentário da coluna em 0011)
 *     e a tela mostra "Sem título" no lugar.
 *   - sem `.trim()`: `trim` é transformação, não validação. Ela devolveria ao
 *     cliente um texto diferente do digitado e o cursor pularia a cada espaço
 *     digitado no fim do título.
 *
 * `updatedAt` é o coração do controle de concorrência — ver a action.
 */
export const knowledgePageContentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200, "Máximo de 200 caracteres").optional(),
  content: prosemirrorDocSchema,
  updatedAt: knowledgeTimestamp,
});

export const knowledgeRenamePageSchema = z.object({
  id: z.string().uuid(),
  title: knowledgePageTitle,
});

/**
 * Mover uma página: troca de mãe, de caderno e/ou de posição entre irmãs.
 *
 * `notebookId` é OBRIGATÓRIO mesmo quando o caderno não muda. A alternativa
 * seria a action descobrir o caderno de destino lendo a linha da mãe — uma ida
 * ao banco a mais em toda operação de arrastar, para adivinhar algo que a tela
 * já sabe (ela desenhou a árvore daquele caderno). A coerência entre mãe e
 * caderno continua garantida pelo banco: `trg_knowledge_pages_same_notebook` é
 * uma constraint trigger adiada e recusa a transação inteira no commit.
 *
 * `parentId` nulável = mover para o topo do caderno. `position` ausente = manter
 * a posição atual (útil ao mudar só de mãe).
 */
export const knowledgeMovePageSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  notebookId: z.string().uuid(),
  // `.finite()` barra Infinity e NaN, que o JSON.parse não produz mas o cliente
  // pode montar à mão. Um NaN aqui viraria erro de cast no Postgres.
  position: z.number().finite().optional(),
});

export const knowledgeSearchSchema = z.object({
  termo: z.string().max(200),
  notebookId: z.string().uuid().nullable().optional(),
});

/* ------------------------------------------------------------- redes sociais */

/**
 * Teto do rótulo. Espelha o CHECK `social_links_label_length` da 0012.
 *
 * A constante existe porque o número está em DOIS lugares por necessidade (aqui
 * e no banco) e um terceiro literal solto na interface seria o que quebra: o
 * campo aceitando 60 e o banco recusando em 41 vira uma mensagem crua de
 * constraint no toast do usuário, no lugar de um aviso legível enquanto digita.
 */
export const TAMANHO_MAXIMO_DO_LABEL = 40;

/**
 * BARREIRA 1 das três contra `href` perigoso.
 *
 * `z.string().url()` NÃO É USADO AQUI, e a omissão é o ponto inteiro do schema:
 * por baixo ele constrói `new URL()`, e `new URL("javascript:alert(1)")` é uma
 * URL perfeitamente VÁLIDA. Ela só não é navegável — mas é executável, e o campo
 * "meu Instagram" viraria um XSS armazenado na mesma origem do Cofre.
 *
 * A regra mora em `urlSegura()` (src/lib/social.ts) e é CHAMADA daqui em vez de
 * reescrita: allowlist de protocolo, recusa de credenciais embutidas, exigência
 * de domínio e canonização. Duas cópias da regra divergem na primeira mudança, e
 * a divergência não dá erro de compilação — dá um buraco.
 *
 * `.transform((valor, ctx) => ...)` e não `.refine(...)` porque a função faz as
 * DUAS coisas de uma vez: decide se aceita e devolve a forma canônica
 * (`URL.toString()`). Um `refine` validaria e deixaria passar o texto CRU do
 * usuário, e aí o banco receberia "Instagram.com/fulano " em vez de
 * "https://instagram.com/fulano" — reprovado pelo CHECK `social_links_url_https`
 * e, pior, invisível para o índice único que impede o link repetido.
 *
 * A mensagem vem do `motivo` da própria função: ela já explica em português qual
 * das regras falhou ("Só endereços https:// são aceitos.", "Endereço sem domínio
 * válido."), e reescrever aqui produziria um segundo texto para o mesmo defeito.
 */
const socialUrlSchema = z.string({ invalid_type_error: "Informe um endereço" }).transform(
  (valor, ctx) => {
    const resultado = urlSegura(valor);
    if (!resultado.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.motivo });
      // `z.NEVER` interrompe a cadeia: sem ele o zod seguiria adiante com um
      // valor inválido no lugar de parar na primeira falha.
      return z.NEVER;
    }
    return resultado.url;
  },
);

export const socialLinkSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Informe um rótulo")
    .max(TAMANHO_MAXIMO_DO_LABEL, `Máximo de ${TAMANHO_MAXIMO_DO_LABEL} caracteres`),
  url: socialUrlSchema,
});

export type SocialLinkInput = z.infer<typeof socialLinkSchema>;

/**
 * Edição. Derivado com `.extend` em vez de reescrito: duas listas de campos
 * parecidas divergem na primeira mudança, e o zod não avisa.
 */
export const socialLinkUpdateSchema = socialLinkSchema.extend({
  // Server action é endpoint HTTP: o id é validado como uuid ANTES do banco.
  // Sem isso, um id malformado não vira "0 linhas afetadas" — vira erro de cast
  // do Postgres, e "invalid input syntax for type uuid" acaba no toast.
  id: z.string().uuid("Link inválido"),
});

/**
 * Reordenação: a lista de ids na ordem nova.
 *
 * O `.refine` de ids repetidos NÃO é preciosismo. A action grava a nova ordem
 * num ÚNICO `insert ... on conflict do update` (ver o comentário lá), e o
 * Postgres recusa a instrução inteira com "ON CONFLICT DO UPDATE command cannot
 * affect row a second time" quando o mesmo id aparece duas vezes no lote. Barrar
 * aqui troca um erro cru de banco por uma mensagem em português — e, como a
 * duplicata só chega de um cliente adulterado ou de um defeito de arrastar, é
 * também o aviso de que algo está errado antes de tocar no dado.
 *
 * O teto é LIMITE_DE_LINKS pelo mesmo motivo que a criação: uma lista de 10.000
 * ids não deve nem chegar à consulta.
 */
export const socialLinkReorderSchema = z.object({
  ids: z
    .array(z.string().uuid("Link inválido"))
    .min(1, "Nada para reordenar")
    .max(LIMITE_DE_LINKS, `São no máximo ${LIMITE_DE_LINKS} links`)
    .refine((ids) => new Set(ids).size === ids.length, "A nova ordem tem links repetidos"),
});
