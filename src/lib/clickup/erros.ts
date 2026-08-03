/**
 * Erros do ClickUp — tipados, porque a interface reage diferente a cada um.
 *
 * Uma string de erro obrigaria a tela a procurar substring ("inclui 401?") para
 * decidir se oferece "Reconectar" ou "Tentar de novo". Procurar substring em
 * mensagem é o tipo de acoplamento que quebra no dia em que alguém melhora o
 * texto.
 */

export type MotivoClickUp =
  /** 401/403 — o token foi recusado. Pede reconectar. */
  | "token_invalido"
  /** 429 — cota da API. Pede esperar, NÃO pede reconectar. */
  | "limite_de_taxa"
  /** 404 — a tarefa/lista não existe (ou não é visível para este token). */
  | "nao_encontrado"
  /** A tarefa existe, mas eu não sou responsável. Ver guard.ts. */
  | "nao_sou_responsavel"
  /** Timeout ou falha de rede. */
  | "indisponivel"
  /** 4xx/5xx que não se encaixa nos acima. */
  | "falhou";

export class ErroClickUp extends Error {
  readonly motivo: MotivoClickUp;
  /** Status HTTP, quando houve resposta. Só para diagnóstico. */
  readonly status?: number;

  constructor(motivo: MotivoClickUp, mensagem: string, status?: number) {
    super(mensagem);
    this.name = "ErroClickUp";
    this.motivo = motivo;
    this.status = status;
  }
}

/**
 * Frase para a tela, a partir do motivo.
 *
 * Fica junto do tipo de propósito: assim acrescentar um motivo novo sem
 * escrever a frase correspondente é um erro de compilação (o `Record` é
 * exaustivo), e não uma tela mostrando "undefined".
 */
const FRASES: Record<MotivoClickUp, string> = {
  token_invalido: "O ClickUp recusou o token. Reconecte em Configurações.",
  limite_de_taxa: "Muitas consultas ao ClickUp. Tente em alguns instantes.",
  nao_encontrado: "Tarefa não encontrada no ClickUp.",
  nao_sou_responsavel:
    "Esta tarefa não está atribuída a você. O aplicativo só altera tarefas das quais você é responsável.",
  indisponivel: "Não foi possível falar com o ClickUp.",
  falhou: "Não foi possível falar com o ClickUp.",
};

export function fraseDoErro(erro: unknown): string {
  if (erro instanceof ErroClickUp) return FRASES[erro.motivo];
  return FRASES.falhou;
}

export function motivoDoErro(erro: unknown): MotivoClickUp {
  return erro instanceof ErroClickUp ? erro.motivo : "falhou";
}
