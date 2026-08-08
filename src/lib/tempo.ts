/**
 * Conversão entre HORÁRIO DE PAREDE e INSTANTE — pura, sem I/O, testável.
 *
 * =============================================================================
 * O DEFEITO QUE ESTE MÓDULO CORRIGE
 * =============================================================================
 * Um `<input type="datetime-local">` devolve uma string INGÊNUA: "2026-08-07T14:00",
 * sem fuso nenhum. Ela não é um instante — é um horário de parede, e só vira
 * instante depois que alguém diz "em qual fuso". A versão anterior deixava essa
 * decisão para o `new Date()`, e o ECMAScript responde de dois jeitos diferentes
 * dependendo do formato:
 *
 *     new Date("2026-08-07T14:00")  // horário LOCAL de quem está executando
 *     new Date("2026-08-07")        // meia-noite UTC — a forma só-data é OUTRA regra
 *
 * Isso produzia dois defeitos somados:
 *
 *   1. SÓ-DATA VOLTA UM DIA. "2026-08-07" vira 2026-08-07T00:00:00Z, que em
 *      São Paulo é 06/08 às 21h. A tarefa marcada como "Dia inteiro" no dia 7
 *      aparecia no dia 6. Reproduzido em execução.
 *
 *   2. TODO HORÁRIO DESLOCA EM PRODUÇÃO. "quem está executando" é o SERVIDOR —
 *      a validação roda na server action. Em desenvolvimento o servidor é a
 *      máquina do usuário (São Paulo) e o ida-e-volta fecha, escondendo o
 *      defeito. Na Vercel o servidor é UTC: 14:00 digitado vira 14:00Z, e a
 *      tela — que formata fixado em `America/Sao_Paulo` (ver `utils.ts`) — o
 *      mostra de volta como 11:00. Três horas de diferença em toda tarefa com
 *      hora, e nenhum teste unitário pegaria, porque em máquina local os dois
 *      fusos coincidem.
 *
 * =============================================================================
 * A REGRA, DECIDIDA AQUI E VÁLIDA PARA O RESTO DO APP
 * =============================================================================
 * O fuso do produto é `FUSO_DO_APP`, e ele é a ÚNICA autoridade. Não é o fuso do
 * servidor (que é UTC e não pertence a ninguém) nem o do navegador (que muda ao
 * viajar, e faria a mesma tarefa mudar de dia dentro do avião). É o mesmo fuso
 * em que `utils.ts` já formatava toda data para a tela desde sempre — este
 * módulo só passa a usá-lo também na ENTRADA, fechando o ciclo.
 *
 * Consequência prática: "Dia inteiro" grava a meia-noite de São Paulo, e o que
 * o usuário digita é o que ele lê de volta, rodando onde for.
 *
 * ⚠️ `profiles.timezone` existe no banco (0001:109) com o mesmo valor por
 * padrão. Ele NÃO é lido aqui de propósito: passar a respeitá-lo exige decidir o
 * que fazer com o dado já gravado sob a regra fixa, e é mudança de produto, não
 * correção de defeito. Quando essa hora chegar, o ponto de troca é uma constante
 * só — este arquivo.
 *
 * NENHUMA conta abaixo usa aritmética de `Date` sobre componentes locais. É o
 * mesmo cuidado que `src/lib/credit.ts` já documenta e pratica: só componentes
 * numéricos explícitos, e `Intl` para perguntar o deslocamento ao invés de
 * adivinhá-lo.
 */

/** O fuso do produto. Ver o cabeçalho: é a autoridade, não um padrão. */
export const FUSO_DO_APP = "America/Sao_Paulo";

/** "2026-08-07" — o que um `<input type="date">` emite e aceita. */
export const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-08-07T14:00", com segundos e fração opcionais e SEM fuso.
 *
 * A ausência de `Z` ou de `±hh:mm` no fim é o que caracteriza a string ingênua —
 * e é justamente o caso que precisa da conversão deste módulo. Uma string que já
 * traz o deslocamento é um instante e passa direto.
 */
export const HORARIO_INGENUO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Regra gregoriana completa: 2000 é bissexto (%400), 1900 e 2100 não são (%100). */
function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function ultimoDiaDoMes(ano: number, mes: number): number {
  if (mes === 2 && ehBissexto(ano)) return 29;
  return DIAS_POR_MES[mes - 1]!;
}

interface Parede {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

/**
 * Lê a string ingênua e confere que o horário EXISTE no calendário.
 *
 * A conferência não é preciosismo: "2026-02-31" casa com a expressão regular e
 * não existe. Sem ela, o valor chegaria ao Postgres e voltaria como "date/time
 * field value out of range" — erro cru em inglês num toast em português. É a
 * mesma dupla verificação que `diaCivilSchema` já faz em `validation.ts`.
 */
function lerParede(valor: string): Parede | null {
  const soData = SO_DATA.exec(valor);
  const comHora = soData ? null : HORARIO_INGENUO.exec(valor);
  const m = soData ?? comHora;
  if (!m) return null;

  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const hora = comHora ? Number(m[4]) : 0;
  const minuto = comHora ? Number(m[5]) : 0;
  const segundo = comHora && m[6] != null ? Number(m[6]) : 0;

  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > ultimoDiaDoMes(ano, mes)) return null;
  if (hora > 23 || minuto > 59 || segundo > 59) return null;

  return { ano, mes, dia, hora, minuto, segundo };
}

/**
 * Deslocamento do fuso, em minutos, NO INSTANTE dado.
 *
 * Precisa ser "no instante dado" e não um número fixo porque o deslocamento
 * muda com o horário de verão. O Brasil o aboliu em 2019, mas o app guarda datas
 * anteriores (um hábito iniciado em 2018, uma transação importada) e tem usuário
 * potencial em fuso que ainda o pratica — travar em -3 acertaria hoje e erraria
 * no histórico, que é o pior tipo de acerto.
 *
 * A conta: formata o instante NAQUELE fuso, remonta os componentes como se
 * fossem UTC, e a diferença entre os dois é o deslocamento. É o caminho que o
 * `Intl` permite sem tabela de fusos própria nem dependência externa.
 */
function deslocamentoEmMinutos(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instante));

  const campo = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);

  // `hour12: false` produz 24 para a meia-noite em algumas implementações; o
  // `% 24` normaliza sem mudar mais nada.
  const comoUtc = Date.UTC(
    campo("year"),
    campo("month") - 1,
    campo("day"),
    campo("hour") % 24,
    campo("minute"),
    campo("second"),
  );

  return (comoUtc - instante) / 60_000;
}

/**
 * Horário de parede + fuso → INSTANTE ISO ("...Z"). Devolve `null` se a string
 * não for um horário de parede válido.
 *
 * "2026-08-07"        → meia-noite em São Paulo → "2026-08-07T03:00:00.000Z"
 * "2026-08-07T14:00"  → 14h em São Paulo        → "2026-08-07T17:00:00.000Z"
 *
 * DUAS PASSAGENS, e a segunda não é redundante. Para achar o deslocamento é
 * preciso um instante, e para achar o instante é preciso o deslocamento — a
 * primeira passagem quebra o círculo chutando "a parede é UTC", e a segunda
 * corrige o chute perguntando o deslocamento no instante já aproximado. Sem ela,
 * um horário perto da virada do horário de verão erraria em uma hora.
 */
export function instanteDe(valor: string, fuso: string = FUSO_DO_APP): string | null {
  const p = lerParede(valor);
  if (!p) return null;

  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);

  let instante = comoSeFosseUtc - deslocamentoEmMinutos(comoSeFosseUtc, fuso) * 60_000;
  instante = comoSeFosseUtc - deslocamentoEmMinutos(instante, fuso) * 60_000;

  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * INSTANTE ISO → horário de parede, no formato que cada `<input>` aceita.
 *
 * =============================================================================
 * POR QUE O FORMATO É PARÂMETRO
 * =============================================================================
 * A versão anterior devolvia sempre 16 caracteres ("2026-08-07T14:00") e
 * alimentava com isso os DOIS tipos de campo. Um `<input type="date">` só aceita
 * "YYYY-MM-DD": recebendo a string de 16 caracteres o navegador DESCARTA o valor
 * e o campo aparece vazio — mesmo havendo data salva. Era o defeito visível ao
 * marcar "Dia inteiro" numa tarefa que já tinha data.
 *
 * Pedir o formato na chamada torna impossível errar em silêncio: quem renderiza
 * `type="date"` precisa dizer "date" aqui, e a incompatibilidade que antes era
 * um campo misteriosamente vazio agora é um argumento no código.
 *
 * ⚠️ Formata no FUSO DO APP, não no do navegador — é a outra metade do ciclo que
 * `instanteDe()` abre. Um usuário viajando veria, com o fuso do navegador, a
 * tarefa mudar de horário no meio do voo.
 */
export function paraCampoLocal(
  iso: string | null | undefined,
  formato: "date" | "datetime",
  fuso: string = FUSO_DO_APP,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);

  const campo = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const data = `${campo("year")}-${campo("month")}-${campo("day")}`;
  if (formato === "date") return data;

  // `% 24` pela mesma razão de `deslocamentoEmMinutos`: meia-noite pode vir "24".
  const hora = String(Number(campo("hour")) % 24).padStart(2, "0");
  return `${data}T${hora}:${campo("minute")}`;
}

/** O dia civil ("YYYY-MM-DD") de um instante, no fuso do app. */
export function diaCivilDe(iso: string | null | undefined, fuso: string = FUSO_DO_APP): string {
  return paraCampoLocal(iso, "date", fuso);
}
