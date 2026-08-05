import { diaDaSemana, segundaDaSemana, somarDias, type CadenciaHabito } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * O VOCABULÁRIO DE LEITURA DO MÓDULO — como um hábito vira frase, número e
 * glifo na tela.
 *
 * ⚠️ NADA AQUI CALCULA RESULTADO. Sequência, taxa e falha continuam vindo de
 * `src/lib/habits.ts`, que é o módulo que a tela E o e-mail semanal consomem.
 * Este arquivo só traduz o que já foi calculado — é a camada de apresentação, e
 * a separação existe para que ninguém seja tentado a "dar um jeitinho" num
 * número aqui e criar a segunda implementação da mesma conta.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE: AS TRÊS CADÊNCIAS SÃO TRÊS LEITURAS
 * ============================================================================
 * A tela antiga desenhava as três iguais — um distintivo com texto e um número
 * de sequência —, e com isso escondia a diferença que o banco faz questão de
 * manter:
 *
 *   daily          a unidade é o DIA. "12 dias seguidos" responde tudo.
 *   weekdays       a unidade é o DIA ELEGÍVEL. A pergunta é "quais dias?", e a
 *                  resposta é a lista deles — não um número.
 *   weekly_target  a unidade é a SEMANA. "12" aqui são SEMANAS, e o que a
 *                  pessoa precisa ver hoje é quanto falta para fechar ESTA
 *                  semana: 2 de 3. Um hábito de 3× por semana não falha na
 *                  terça — falha no domingo à noite.
 *
 * Quem lê uma leitura errada toma decisão errada: sem "2 de 3", a pessoa não
 * sabe se ainda dá tempo, e o domingo chega com a semana perdida.
 */

/* ------------------------------------------------------- datas por extenso */

/**
 * Os nomes são LITERAIS, e não vêm de `Intl.DateTimeFormat`.
 *
 * Dois motivos, nesta ordem. O primeiro é hidratação: estes componentes são de
 * cliente e renderizam no servidor antes. Node e navegador podem discordar num
 * detalhe de ICU ("5 de agosto" vs "5 de agosto de 2026"), e a diferença vira
 * aviso de hidratação no console — barulho por conveniência.
 *
 * O segundo é o mesmo princípio de `src/lib/habits.ts`: aqui só circula chave
 * "AAAA-MM-DD". Passar por `Date` para formatar reabriria a porta do fuso que o
 * módulo inteiro foi escrito para manter fechada.
 */
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Rótulo do eixo do mapa de calor. Três letras cabem numa coluna de semana. */
export const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** 0=domingo..6=sábado — a mesma numeração do banco e de `extract(dow)`. */
export const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Inicial para o eixo do mapa. Ambíguas de propósito: a POSIÇÃO desambigua. */
export const DIAS_INICIAL = ["D", "S", "T", "Q", "Q", "S", "S"];

function partes(chave: string): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return { ano: ano!, mes: mes!, dia: dia! };
}

/** "2026-08-05" → "5 de agosto". Sem ano: a tela só mostra os últimos 90 dias. */
export function formatarDiaMedio(chave: string): string {
  const { mes, dia } = partes(chave);
  return `${dia} de ${MESES[mes - 1]}`;
}

/**
 * "2026-08-05" → "quarta-feira, 5 de agosto".
 *
 * É o texto que entra no `aria-label` do botão de marcar: sem o dia, o leitor
 * de tela anuncia "Marcar Ler 20 páginas" e a pessoa não sabe se está marcando
 * hoje ou o dia que estava aberto na tela.
 */
export function formatarDiaLongo(chave: string): string {
  return `${DIAS_LONGOS[diaDaSemana(chave)]}, ${formatarDiaMedio(chave)}`;
}

/** "2026-08-05" → "05/08". Formato de `title`, onde o espaço é curto. */
export function formatarDiaCurto(chave: string): string {
  const [, mes, dia] = chave.split("-");
  return `${dia}/${mes}`;
}

export function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* ------------------------------------------------------------- cadências -- */

/**
 * Os dias fixos em ordem de SEMANA DO HÁBITO — segunda primeiro.
 *
 * Ordenar por 0..6 colocaria domingo na frente ("dom, seg e qua"), o que
 * contradiz a semana que `segundaDaSemana` define para todo o módulo.
 */
export function listarDiasFixos(weekdays: number[]): string {
  const nomes = [...weekdays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => DIAS_CURTOS[d] ?? "?");

  if (nomes.length === 0) return "nenhum dia";
  if (nomes.length === 7) return "todo dia";
  if (nomes.length === 1) return nomes[0]!;
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** A regra numa linha, do jeito que a pessoa a escreveria. */
export function descreverCadencia(h: {
  schedule_kind: CadenciaHabito;
  weekdays: number[];
  weekly_target: number | null;
}): string {
  if (h.schedule_kind === "daily") return "Todo dia";
  if (h.schedule_kind === "weekly_target") return `${h.weekly_target ?? 1}× por semana`;
  return maiuscula(listarDiasFixos(h.weekdays));
}

/**
 * A unidade da sequência, no singular ou no plural.
 *
 * ⚠️ Para `weekly_target` a unidade é SEMANA, e isso não é detalhe de texto: um
 * "12" com a palavra "dias" ao lado, num hábito semanal, seria simplesmente uma
 * informação falsa — a conta em `sequenciaAtual` andou de semana em semana.
 */
export function unidadeDaSequencia(cadencia: CadenciaHabito, n: number): string {
  if (cadencia === "weekly_target") return n === 1 ? "semana seguida" : "semanas seguidas";
  return n === 1 ? "dia seguido" : "dias seguidos";
}

/**
 * Quantas vezes o hábito foi cumprido na semana CORRENTE (segunda a domingo).
 *
 * ⚠️ ESTA CONTA É UM ESPELHO de `contarNaSemana`, em `src/lib/habits.ts`, que é
 * privada do módulo e por isso não pode ser importada. As duas precisam
 * concordar em três coisas, e é por isso que elas estão escritas iguais:
 *
 *   1. a semana começa na SEGUNDA (`segundaDaSemana`);
 *   2. dia anterior a `started_on` NÃO conta, mesmo que exista marcação;
 *   3. os sete dias entram, inclusive os do futuro dentro desta semana — que
 *      simplesmente não têm marcação ainda.
 *
 * Duas implementações da mesma conta é exatamente o que o cabeçalho de
 * `habits.ts` proíbe, então isto está anotado no relatório como pedido de
 * `export` de `contarNaSemana`. Enquanto ele não vem, o espelho fica aqui, com
 * a lista acima servindo de contrato.
 */
export function feitosNaSemanaCorrente(
  feitos: Set<string>,
  hoje: string,
  startedOn: string,
): number {
  const segunda = segundaDaSemana(hoje);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dia = somarDias(segunda, i);
    if (dia >= startedOn && feitos.has(dia)) n++;
  }
  return n;
}

/* --------------------------------------------------------------- medidor -- */

/**
 * O progresso da semana de um hábito `weekly_target`: um traço por vez exigida.
 *
 * ⚠️ `aria-hidden` de propósito. Quem chama SEMPRE escreve "2 de 3 esta semana"
 * ao lado ou no rótulo do botão — o medidor é a leitura rápida para o olho, não
 * a informação. Anunciar "3 elementos gráficos" não ajudaria ninguém, e a regra
 * da casa é que nada seja dito só por forma.
 *
 * O traço vazio leva anel em `ink/30` além do preenchimento fraco: sozinho, um
 * `bg-ink/12` não alcança 3:1 contra a superfície em nenhum dos dois temas, e o
 * medidor viraria um borrão. O anel é quem desenha a borda do que falta.
 */
export function MedidorSemanal({
  feitos,
  alvo,
  className,
}: {
  feitos: number;
  alvo: number;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-0.5", className)}>
      {Array.from({ length: Math.max(1, alvo) }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-2.5 rounded-full",
            i < feitos ? "bg-ink" : "bg-ink/10 ring-1 ring-inset ring-ink/50",
          )}
        />
      ))}
    </span>
  );
}
