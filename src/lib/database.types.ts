/**
 * Hand-authored subset of the database types. In a full setup you would run
 * `supabase gen types typescript` to regenerate this from the live schema.
 * It mirrors 0001_second_brain_initial.sql closely enough for the app's queries.
 */

export type TaskStatus = "todo" | "in_progress" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type CaptureType = "idea" | "task" | "note" | "reminder";
export type CaptureStatus = "draft" | "inbox" | "organized" | "archived";
export type ThemePreference = "light" | "dark" | "system";
export type DayMode = "focused" | "light" | "recovery";
export type CalendarView = "day" | "week" | "month" | "list";
export type CalendarAccountStatus = "connected" | "expired" | "error" | "disconnected";
export type VaultItemType = "login" | "account" | "document" | "financial" | "secure_note";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

export type TaskView = "list" | "board";
export type NotificationChannel = "in_app" | "push" | "both";
export type FinanceAccountKind =
  | "checking"
  | "savings"
  | "credit_card"
  | "cash"
  | "investment"
  | "other";
export type FinanceCategoryKind = "income" | "expense";
export type FinanceTransactionKind = "income" | "expense" | "transfer";

export interface UserPreferences {
  user_id: string;
  theme: ThemePreference;
  day_mode: DayMode;
  week_starts_on: number;
  default_calendar_view: CalendarView;
  default_task_view: TaskView;
  notifications_enabled: boolean;
  notification_lead_minutes: number[];
  notification_channel: NotificationChannel;
  finance_hide_values: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserModule {
  user_id: string;
  module_key: string;
  enabled: boolean;
  sort_order: number;
}

/* ------------------------------------------------------------------ finance */

export interface FinanceAccount {
  id: string;
  user_id: string;
  name: string;
  kind: FinanceAccountKind;
  institution: string | null;
  currency: string;
  opening_balance_cents: number;
  color_key: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Campos de cartão de crédito (0010). São `null` em toda conta que NÃO é
   * cartão, e o CHECK `finance_accounts_credit_card_fields_check` exige os três
   * quando `kind = 'credit_card'`. Anuláveis aqui de propósito: o tipo tem que
   * refletir o banco, não a intenção — uma conta corrente realmente não tem
   * limite, e fingir `number` faria o código esquecer de tratar o caso.
   */
  credit_limit_cents: number | null;
  /** Dia (1-31) em que a fatura FECHA. Compra no próprio dia já é da seguinte. */
  statement_closing_day: number | null;
  /** Dia (1-31) em que a fatura VENCE. Ver `vencimentoDaFatura` em credit.ts. */
  payment_due_day: number | null;
}

/**
 * View `finance_account_balances` (0005, reescrita em 0010).
 *
 * `balance_cents` mantém o significado original — DINHEIRO, e portanto NEGATIVO
 * em cartão, já que compra entra como expense. As três colunas novas existem
 * justamente para que ninguém precise trocar o sinal de `balance_cents` (uma
 * mudança que compilaria em silêncio e passaria a somar cartão ao patrimônio).
 */
export interface FinanceAccountBalance {
  account_id: string;
  user_id: string;
  name: string;
  kind: FinanceAccountKind;
  currency: string;
  opening_balance_cents: number;
  /** No Postgres é `numeric` (sum(bigint) devolve numeric); em centavos inteiros. */
  balance_cents: number;
  /** `kind = 'credit_card'`. Evita repetir a comparação com a string literal. */
  is_credit: boolean;
  /** Dívida do cartão como número POSITIVO (o oposto de balance_cents). 0 fora de cartão. */
  debt_cents: number;
  /**
   * `credit_limit_cents - debt_cents`. NULL fora de cartão ("não se aplica" — 0
   * seria a afirmação falsa "sem limite disponível") e NULL em cartão sem limite
   * cadastrado. Pode ser NEGATIVO quando o limite estourou.
   */
  available_cents: number | null;
}

export interface FinanceCategory {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  kind: FinanceCategoryKind;
  parent_id: string | null;
  color_key: string;
  created_at: string;
  updated_at: string;
}

export interface FinanceTag {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  color_key: string;
  created_at: string;
  updated_at: string;
}

export interface FinanceTransaction {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  kind: FinanceTransactionKind;
  amount_cents: number;
  description: string;
  payee: string | null;
  occurred_on: string;
  transfer_group_id: string | null;
  notes: string | null;
  is_paid: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Parcelamento (0010). "Tudo ou nada": os três são nulos numa compra à vista e
   * todos preenchidos numa parcelada, com 1 <= installment_no <= installment_total
   * (CHECK `finance_tx_installment_check`). Uma compra parcelada é N LINHAS
   * unidas por este grupo — não existe linha "mãe".
   */
  installment_group_id: string | null;
  /** O "3" de "3 de 12". */
  installment_no: number | null;
  /** O "12" de "3 de 12". */
  installment_total: number | null;
  /**
   * Mês da fatura a que a linha pertence, sempre no dia 1 ("YYYY-MM-01", mesmo
   * formato de `finance_budgets.month`). NULL fora de cartão de crédito.
   *
   * É um FATO HISTÓRICO gravado na escrita com `faturaDe()`: não é recalculado
   * para trás quando o dia de fechamento do cartão muda, senão faturas antigas
   * já pagas mudariam de mês e deixariam de bater com o extrato.
   */
  statement_month: string | null;
}

export interface FinanceBudget {
  id: string;
  user_id: string;
  category_id: string;
  month: string;
  limit_cents: number;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------- drive */

export interface DriveFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  color_key: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DriveFile {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  starred: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DriveUsage {
  user_id: string;
  file_count: number;
  total_bytes: number;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  color_key: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  all_day: boolean;
  estimated_minutes: number | null;
  source: "manual";
  completed_at: string | null;
  archived_at: string | null;
  /** Índice fracionário para ordenar dentro da coluna do Kanban. */
  board_position: number | null;
  created_at: string;
  updated_at: string;
}

export interface Capture {
  id: string;
  user_id: string;
  type: CaptureType;
  title: string | null;
  content: string | null;
  status: CaptureStatus;
  category_id: string | null;
  converted_task_id: string | null;
  captured_at: string;
  organized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarAccount {
  id: string;
  user_id: string;
  slot: 1 | 2;
  google_subject: string;
  email: string | null;
  display_name: string | null;
  color_key: string;
  status: CalendarAccountStatus;
  scopes: string[];
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarSource {
  id: string;
  user_id: string;
  calendar_account_id: string;
  google_calendar_id: string;
  summary: string | null;
  description: string | null;
  timezone: string | null;
  access_role: string | null;
  background_color: string | null;
  is_primary: boolean;
  is_enabled: boolean;
  next_sync_token: string | null;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expiration: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  calendar_account_id: string;
  calendar_source_id: string;
  google_event_id: string;
  etag: string | null;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  html_link: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  all_day: boolean;
  organizer: string | null;
  attendees: unknown | null;
  conference_data: unknown | null;
  recurring_event_id: string | null;
  original_start_time: string | null;
  created_at_google: string | null;
  updated_at_google: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Tabelas de vínculo da 0009. Três tabelas estreitas em vez de uma polimórfica:
 * o Postgres não sabe garantir FK polimórfica, e o resultado seria órfão
 * silencioso. Nenhuma tem coluna `id` — a identidade do vínculo é o PAR, que é
 * a chave primária composta.
 */
export interface TaskCaptureLink {
  task_id: string;
  capture_id: string;
  user_id: string;
  created_at: string;
}

export interface TaskEventLink {
  task_id: string;
  calendar_event_id: string;
  user_id: string;
  created_at: string;
}

export interface CaptureEventLink {
  capture_id: string;
  calendar_event_id: string;
  user_id: string;
  created_at: string;
}

/* ------------------------------------------------------------- conhecimento */

/**
 * Documento do ProseMirror, como sai de `knowledge_pages.content` (0011).
 *
 * O tipo é deliberadamente RASO: `type` na raiz e um `content` de nós opacos.
 * Descrever o schema inteiro do editor aqui seria uma segunda fonte de verdade —
 * o schema real mora no editor, muda quando ele ganha um nó novo (tabela, código,
 * citação) e nada neste arquivo perceberia a divergência. `unknown[]` obriga quem
 * for descer na árvore a estreitar o tipo no ponto de uso, que é onde o
 * conhecimento sobre o schema realmente existe.
 *
 * `any` está fora de cogitação: ele desligaria a checagem em cascata para tudo
 * que encostasse no documento, inclusive nos pontos onde ela protege de verdade.
 */
export type ProseMirrorDoc = { type: string; content?: unknown[] };

export interface KnowledgeNotebook {
  id: string;
  user_id: string;
  name: string;
  color_key: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Linha completa de `knowledge_pages`.
 *
 * `search_vector` NÃO aparece aqui de propósito. Ela existe no banco (coluna
 * gerada, tsvector, indexada por GIN), mas é ESCRITA pelo banco e LIDA pelo
 * índice — a aplicação nunca precisa do valor. Declará-la convidaria alguém a
 * pedi-la num `select`, e um tsvector de uma página longa são dezenas de KB de
 * lexemas atravessando a rede para serem ignorados.
 *
 * `content_text` aparece porque é útil na tela (trecho do resultado de busca),
 * mas também é derivada: a aplicação NUNCA escreve nela. Ver o comentário da
 * coluna em 0011 — a extração mora no banco justamente para que qualquer caminho
 * de escrita mantenha a busca coerente.
 */
export interface KnowledgePage {
  id: string;
  user_id: string;
  notebook_id: string;
  parent_id: string | null;
  title: string;
  content: ProseMirrorDoc;
  /** Derivada pelo trigger `trg_knowledge_pages_content_text`. Somente leitura. */
  content_text: string;
  /** Índice fracionário entre irmãs (`numeric` no banco). Ver `posicaoEntre`. */
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Linha LEVE de página: o que a árvore da barra lateral precisa saber.
 *
 * Existe para que a árvore não arraste `content` junto. Um caderno com 200
 * páginas de texto são megabytes de jsonb; a barra lateral usa disso apenas o
 * título. Sem este recorte, abrir uma página baixaria o caderno inteiro.
 */
export interface KnowledgePageSummary {
  id: string;
  notebook_id: string;
  parent_id: string | null;
  title: string;
  position: number;
  updated_at: string;
}

/** Nó já montado da árvore. `depth` começa em 0 nas páginas de topo. */
export interface KnowledgePageNode extends KnowledgePageSummary {
  children: KnowledgePageNode[];
  depth: number;
}

/** Resultado da busca full-text. Mesmas colunas do `select` documentado em 0011. */
export interface KnowledgeSearchHit {
  id: string;
  notebook_id: string;
  parent_id: string | null;
  title: string;
  updated_at: string;
}

/* ------------------------------------------------------------- redes sociais */

/**
 * Linha de `public.social_links` (0012).
 *
 * `url` é sempre a forma CANÔNICA de `URL.toString()` — host em minúsculas, IDN
 * em punycode. Não é detalhe de estilo: é o que o CHECK `social_links_url_https`
 * espera (`like 'https://_%'`, sensível a caixa) e o que o índice único
 * (user_id, url) usa para reconhecer o link repetido. Quem grava aqui passa por
 * `urlSegura()` de src/lib/social.ts, que devolve exatamente essa forma.
 *
 * O valor vira o `href` de um `<a>`. Quem for renderizar: `target="_blank"` sem
 * `rel="noopener noreferrer"` entrega `window.opener` ao destino, que pode
 * trocar o conteúdo da SUA aba por uma tela falsa de login (tabnabbing).
 *
 * `position` NÃO é única no banco (ver o comentário da coluna em 0012): duas
 * linhas podem empatar depois de uma exclusão, e por isso toda leitura ordenada
 * precisa de desempate estável — ver `getSocialLinks` em src/lib/data.ts.
 */
export interface SocialLink {
  id: string;
  user_id: string;
  label: string;
  url: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface VaultMasterKey {
  user_id: string;
  wrapped_data_key: string;
  wrap_iv: string;
  kdf_salt: string;
  kdf_algorithm: string;
  kdf_parameters: Record<string, unknown>;
  crypto_version: number;
  created_at: string;
  updated_at: string;
}

export interface VaultItem {
  id: string;
  user_id: string;
  item_type: VaultItemType;
  encrypted_payload: string;
  item_iv: string;
  crypto_version: number;
  favorite: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/* ------------------------------------------------------------------ ClickUp */

export type ClickUpAccountStatus = "connected" | "invalid" | "error";

/**
 * Metadado da conexão (0016). NÃO contém segredo.
 *
 * O token vive em `clickup_credentials`, que a sessão do navegador não alcança
 * — por isso não existe tipo para aquela tabela aqui: nada no cliente pode
 * receber uma linha dela, e um tipo exportado convidaria a tentar.
 */
export interface ClickUpAccount {
  id: string;
  user_id: string;
  clickup_user_id: string;
  clickup_username: string | null;
  clickup_email: string | null;
  workspace_id: string;
  workspace_name: string | null;
  enabled: boolean;
  space_ids: string[];
  status: ClickUpAccountStatus;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * O que a página de Tarefas precisa saber para decidir se a aba aparece.
 *
 * Deliberadamente MENOR que `ClickUpAccount`: é o que atravessa a fronteira
 * servidor→cliente, e cada campo a mais aqui é um campo que passa a viajar no
 * payload do RSC sem ninguém usar.
 */
export interface ClickUpConnection {
  conectado: boolean;
  ativo: boolean;
  username: string | null;
  workspaceName: string | null;
  status: ClickUpAccountStatus;
}

/* ------------------------------------------------------------- Hábitos --- */

export type HabitScheduleKind = "daily" | "weekdays" | "weekly_target";

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  color_key: string;
  icon_key: string | null;
  schedule_kind: HabitScheduleKind;
  /** 0=domingo..6=sábado. Mesma numeração de `extract(dow)`. */
  weekdays: number[];
  weekly_target: number | null;
  started_on: string;
  archived_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * ⚠️ REGISTRO ESPARSO: existe linha SÓ quando o dia foi cumprido. Não há campo
 * `feito`, e "falhou" não é uma linha — é a ausência dela, derivada da regra em
 * `src/lib/habits.ts`. Ver o cabeçalho da migration 0018.
 */
export interface HabitEntry {
  id: string;
  user_id: string;
  habit_id: string;
  /** Dia CIVIL "AAAA-MM-DD" no fuso do aplicativo. Nunca instante. */
  done_on: string;
  note: string | null;
  created_at: string;
}

export interface HabitPause {
  id: string;
  user_id: string;
  /** `null` = pausa geral, vale para todos os hábitos. */
  habit_id: string | null;
  starts_on: string;
  /** `null` = ainda em curso. */
  ends_on: string | null;
  reason: string | null;
  created_at: string;
}
