/**
 * A ARITMÉTICA DOS HÁBITOS — pura, sem banco e sem `server-only`.
 *
 * ⚠️ A ausência de `server-only` é a razão de este arquivo existir separado.
 * Ele é importado pela TELA (Server Component e cliente) e pela ROTA DE CRON do
 * e-mail semanal. Duas implementações do mesmo número são a garantia de que um
 * dia a tela diz 18, o e-mail diz 19, e ninguém sabe qual está certo.
 *
 * É o mesmo padrão de `finance.ts` e `credit.ts`.
 *
 * ============================================================================
 * TUDO AQUI TRABALHA COM "AAAA-MM-DD", NUNCA COM `Date`
 * ============================================================================
 * O dia de um hábito é um dia CIVIL. `Date` carrega instante e fuso, e toda
 * conta que envolve os dois num servidor que roda em UTC erra em algum momento
 * do dia — este projeto já sofreu essa classe de defeito e a documentou em
 * `dayRangeInTimeZone`.
 *
 * Chaves de dia são strings comparáveis por `<`, somáveis por `somarDias`, e
 * não têm hora para dar errado. Quem precisa saber "que dia é hoje" pergunta a
 * `dayRangeInTimeZone().dayKey` UMA vez, na borda, e passa a chave para cá.
 */

export type CadenciaHabito = "daily" | "weekdays" | "weekly_target";

export interface Habito {
  id: string;
  name: string;
  schedule_kind: CadenciaHabito;
  /** 0=domingo..6=sábado. Só em `weekdays`. */
  weekdays: number[];
  /** Só em `weekly_target`. */
  weekly_target: number | null;
  started_on: string;
  archived_at: string | null;
}

export interface PausaHabito {
  /** `null` = pausa geral, vale para todos os hábitos. */
  habit_id: string | null;
  starts_on: string;
  /** `null` = ainda em curso. */
  ends_on: string | null;
}

/* ------------------------------------------------------- dias civis ------ */

/** Dia da semana de uma chave "AAAA-MM-DD". 0=domingo, igual a `extract(dow)`. */
export function diaDaSemana(chave: string): number {
  const [a, m, d] = chave.split("-").map(Number);
  // `Date.UTC` porque a conta não pode passar pelo fuso do processo. O dia da
  // semana de uma data civil é o mesmo em qualquer lugar do mundo.
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay();
}

/** Soma dias a uma chave, devolvendo outra chave. Aceita `n` negativo. */
export function somarDias(chave: string, n: number): string {
  const [a, m, d] = chave.split("-").map(Number);
  const data = new Date(Date.UTC(a!, m! - 1, d!));
  data.setUTCDate(data.getUTCDate() + n);
  return data.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas chaves (`ate - de`). */
export function diferencaEmDias(de: string, ate: string): number {
  const parse = (c: string) => {
    const [a, m, d] = c.split("-").map(Number);
    return Date.UTC(a!, m! - 1, d!);
  };
  return Math.round((parse(ate) - parse(de)) / 86_400_000);
}

/**
 * A segunda-feira da semana de uma chave.
 *
 * A semana do hábito começa na SEGUNDA, e isso é uma escolha: `weekly_target`
 * fecha no domingo à noite ("correr 3× por semana" falha domingo, não terça), e
 * uma semana que começa no domingo faria a contagem virar no meio do fim de
 * semana — exatamente quando as tentativas de recuperar a meta acontecem.
 */
export function segundaDaSemana(chave: string): string {
  const dow = diaDaSemana(chave);
  // domingo (0) pertence à semana que começou 6 dias antes.
  return somarDias(chave, -((dow + 6) % 7));
}

/* --------------------------------------------------- elegibilidade ------ */

/**
 * O dia estava PAUSADO para este hábito?
 *
 * Pausa geral (`habit_id` nulo) vale para todos. `ends_on` nulo é pausa em
 * curso e vale para sempre, dali para a frente.
 */
export function estaPausado(habitId: string, dia: string, pausas: PausaHabito[]): boolean {
  return pausas.some(
    (p) =>
      (p.habit_id === null || p.habit_id === habitId) &&
      dia >= p.starts_on &&
      (p.ends_on === null || dia <= p.ends_on),
  );
}

/**
 * O hábito era ESPERADO neste dia?
 *
 * ⚠️ `weekly_target` devolve SEMPRE `false` aqui, e não é esquecimento: um
 * hábito de "3× por semana" não é esperado em nenhum dia específico. Perguntar
 * "era esperado na terça?" não tem resposta — a unidade dele é a semana, e quem
 * o avalia é `resumoSemanal`, não esta função.
 *
 * Antes de `started_on` nada é esperado: a regra não valia ainda.
 */
export function eraEsperado(
  habito: Habito,
  dia: string,
  pausas: PausaHabito[] = [],
): boolean {
  if (dia < habito.started_on) return false;
  if (estaPausado(habito.id, dia, pausas)) return false;

  switch (habito.schedule_kind) {
    case "daily":
      return true;
    case "weekdays":
      return habito.weekdays.includes(diaDaSemana(dia));
    case "weekly_target":
      return false;
  }
}

/* ------------------------------------------------------- sequência ------ */

/**
 * ⚠️ A UNIDADE DA SEQUÊNCIA DEPENDE DA CADÊNCIA.
 *
 * Para `daily` e `weekdays` a unidade é o DIA ELEGÍVEL: a caminhada para trás
 * PULA os dias que não eram esperados. Sem isso, um hábito de segunda/quarta/
 * sexta zeraria toda terça-feira — a sequência mediria o calendário em vez do
 * hábito.
 *
 * Para `weekly_target` a unidade é a SEMANA. Contar dias ali diria "sequência
 * de 1" para quem correu três vezes na semana, o que é pior que não mostrar.
 *
 * ============================================================================
 * ⚠️ E O DIA DE HOJE NÃO ZERA A SEQUÊNCIA DE MANHÃ
 * ============================================================================
 * Se hoje é elegível e ainda não foi marcado, a caminhada COMEÇA ONTEM. Sem
 * isso, a sequência de 40 dias apareceria como zero toda manhã até a pessoa
 * marcar — e um número que despenca sozinho todo dia não é usado por ninguém.
 */
export function sequenciaAtual(
  habito: Habito,
  feitos: Set<string>,
  hoje: string,
  pausas: PausaHabito[] = [],
): number {
  if (habito.schedule_kind === "weekly_target") {
    return sequenciaSemanal(habito, feitos, hoje, pausas);
  }

  let sequencia = 0;
  let dia = hoje;

  // Hoje ainda está em aberto: só conta se já foi feito.
  if (eraEsperado(habito, dia, pausas) && !feitos.has(dia)) {
    dia = somarDias(dia, -1);
  }

  // Teto de segurança: dez anos de caminhada. Um laço sem teto sobre dados
  // corrompidos (uma `started_on` no ano 1900) pendura a renderização.
  for (let passo = 0; passo < 3_660; passo++) {
    if (dia < habito.started_on) break;
    if (eraEsperado(habito, dia, pausas)) {
      if (!feitos.has(dia)) break;
      sequencia++;
    }
    // Dia não elegível (fim de semana de um hábito de dias úteis, ou pausa) é
    // PULADO sem quebrar e sem contar.
    dia = somarDias(dia, -1);
  }

  return sequencia;
}

/** Quantas semanas seguidas o alvo foi batido. Ver `sequenciaAtual`. */
function sequenciaSemanal(
  habito: Habito,
  feitos: Set<string>,
  hoje: string,
  pausas: PausaHabito[],
): number {
  const alvo = habito.weekly_target ?? 1;
  let sequencia = 0;
  let segunda = segundaDaSemana(hoje);

  // A semana CORRENTE não quebra a sequência quando ainda dá tempo — ela só
  // soma quando o alvo já foi batido. Quebrar no meio da semana puniria alguém
  // por ainda não ter terminado o que ainda pode terminar.
  if (contarNaSemana(habito, feitos, segunda) >= alvo) sequencia++;
  segunda = somarDias(segunda, -7);

  for (let passo = 0; passo < 520; passo++) {
    if (somarDias(segunda, 6) < habito.started_on) break;
    // Semana inteiramente pausada é pulada, não conta nem quebra.
    if (semanaInteiramentePausada(habito, segunda, pausas)) {
      segunda = somarDias(segunda, -7);
      continue;
    }
    if (contarNaSemana(habito, feitos, segunda) < alvo) break;
    sequencia++;
    segunda = somarDias(segunda, -7);
  }

  return sequencia;
}

function contarNaSemana(habito: Habito, feitos: Set<string>, segunda: string): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dia = somarDias(segunda, i);
    if (dia >= habito.started_on && feitos.has(dia)) n++;
  }
  return n;
}

function semanaInteiramentePausada(
  habito: Habito,
  segunda: string,
  pausas: PausaHabito[],
): boolean {
  for (let i = 0; i < 7; i++) {
    if (!estaPausado(habito.id, somarDias(segunda, i), pausas)) return false;
  }
  return true;
}

/* --------------------------------------------------------- resumo ------- */

export interface ResumoDeHabito {
  habito: Habito;
  /** Dias elegíveis no período (semanas, para `weekly_target`). */
  esperados: number;
  cumpridos: number;
  /**
   * ⚠️ EXATO, e é o número que justifica o registro esparso: sai da regra e do
   * que foi marcado, sem depender de nenhum processo ter rodado.
   *
   * Não conta HOJE como falha: o dia ainda não acabou.
   */
  falhas: number;
  /** 0..100, arredondado. `null` quando nada era esperado no período. */
  taxa: number | null;
  sequenciaAtual: number;
  melhorSequencia: number;
  /** Já cumprido hoje? `null` quando hoje não era esperado. */
  hojeFeito: boolean | null;
}

/**
 * O resumo de um hábito num intervalo fechado [de, ate].
 *
 * `ate` costuma ser hoje. O intervalo é fechado dos dois lados porque quem lê
 * "de 01/07 a 31/07" espera os dois dias dentro.
 */
export function resumirHabito(
  habito: Habito,
  feitos: Set<string>,
  de: string,
  ate: string,
  hoje: string,
  pausas: PausaHabito[] = [],
): ResumoDeHabito {
  const inicio = de < habito.started_on ? habito.started_on : de;

  let esperados = 0;
  let cumpridos = 0;
  let falhas = 0;

  if (habito.schedule_kind === "weekly_target") {
    const alvo = habito.weekly_target ?? 1;
    let segunda = segundaDaSemana(inicio);
    const ultimaSegunda = segundaDaSemana(ate);
    let guarda = 0;
    while (segunda <= ultimaSegunda && guarda++ < 520) {
      if (!semanaInteiramentePausada(habito, segunda, pausas)) {
        esperados++;
        const n = contarNaSemana(habito, feitos, segunda);
        if (n >= alvo) cumpridos++;
        // A semana CORRENTE ainda pode ser cumprida — não conta como falha.
        else if (somarDias(segunda, 6) < hoje) falhas++;
      }
      segunda = somarDias(segunda, 7);
    }
  } else {
    let guarda = 0;
    for (let dia = inicio; dia <= ate && guarda++ < 3_660; dia = somarDias(dia, 1)) {
      if (!eraEsperado(habito, dia, pausas)) continue;
      esperados++;
      if (feitos.has(dia)) cumpridos++;
      // HOJE não é falha: o dia ainda não acabou.
      else if (dia < hoje) falhas++;
    }
  }

  const hojeEsperado =
    habito.schedule_kind === "weekly_target"
      ? hoje >= habito.started_on && !estaPausado(habito.id, hoje, pausas)
      : eraEsperado(habito, hoje, pausas);

  return {
    habito,
    esperados,
    cumpridos,
    falhas,
    taxa: esperados === 0 ? null : Math.round((cumpridos / esperados) * 100),
    sequenciaAtual: sequenciaAtual(habito, feitos, hoje, pausas),
    melhorSequencia: melhorSequencia(habito, feitos, hoje, pausas),
    hojeFeito: hojeEsperado ? feitos.has(hoje) : null,
  };
}

/**
 * A maior sequência já alcançada.
 *
 * Percorre de `started_on` até hoje aplicando a mesma regra de elegibilidade —
 * é caro em teoria (um hábito de cinco anos são ~1.800 iterações) e barato na
 * prática, porque roda uma vez por render sobre um array já em memória. Guardar
 * o valor no banco custaria invalidação em todos os gestos desta tela.
 */
export function melhorSequencia(
  habito: Habito,
  feitos: Set<string>,
  hoje: string,
  pausas: PausaHabito[] = [],
): number {
  if (habito.schedule_kind === "weekly_target") {
    const alvo = habito.weekly_target ?? 1;
    let melhor = 0;
    let corrente = 0;
    let segunda = segundaDaSemana(habito.started_on);
    const ultima = segundaDaSemana(hoje);
    let guarda = 0;
    while (segunda <= ultima && guarda++ < 520) {
      if (!semanaInteiramentePausada(habito, segunda, pausas)) {
        if (contarNaSemana(habito, feitos, segunda) >= alvo) {
          corrente++;
          if (corrente > melhor) melhor = corrente;
        } else if (somarDias(segunda, 6) < hoje) {
          // Só uma semana ENCERRADA quebra. A corrente ainda pode ser cumprida.
          corrente = 0;
        }
      }
      segunda = somarDias(segunda, 7);
    }
    return melhor;
  }

  let melhor = 0;
  let corrente = 0;
  let guarda = 0;
  for (let dia = habito.started_on; dia <= hoje && guarda++ < 3_660; dia = somarDias(dia, 1)) {
    if (!eraEsperado(habito, dia, pausas)) continue;
    if (feitos.has(dia)) {
      corrente++;
      if (corrente > melhor) melhor = corrente;
    } else if (dia < hoje) {
      // HOJE em aberto não quebra a melhor sequência.
      corrente = 0;
    }
  }
  return melhor;
}

/* ---------------------------------------------------- mapa de calor ----- */

export interface CelulaDoCalendario {
  dia: string;
  esperado: boolean;
  feito: boolean;
  pausado: boolean;
  futuro: boolean;
}

/**
 * As células dos últimos N dias, para o mapa de calor.
 *
 * Devolve TODOS os dias, inclusive os não esperados — o mapa precisa dos
 * buracos para as colunas ficarem alinhadas por dia da semana. Quem desenha
 * decide o que fazer com `esperado: false`.
 */
export function celulasDoPeriodo(
  habito: Habito,
  feitos: Set<string>,
  hoje: string,
  dias: number,
  pausas: PausaHabito[] = [],
): CelulaDoCalendario[] {
  const celulas: CelulaDoCalendario[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = somarDias(hoje, -i);
    celulas.push({
      dia,
      esperado: eraEsperado(habito, dia, pausas),
      feito: feitos.has(dia),
      pausado: estaPausado(habito.id, dia, pausas),
      futuro: dia > hoje,
    });
  }
  return celulas;
}

/* ------------------------------------------------- resumo do conjunto --- */

export interface ResumoDosHabitos {
  /** Quantos hábitos eram esperados hoje e já foram cumpridos. */
  hojeFeitos: number;
  hojeEsperados: number;
  /** Soma no período. */
  cumpridos: number;
  esperados: number;
  falhas: number;
  taxa: number | null;
  porHabito: ResumoDeHabito[];
}

/**
 * O resumo do conjunto — é o que a tela e o E-MAIL consomem.
 *
 * `feitosPorHabito` chega como Map de Sets para a busca ser O(1): a alternativa
 * (`array.some()` por dia) faria um hábito de cinco anos custar milhões de
 * comparações no render.
 */
export function resumirHabitos(
  habitos: Habito[],
  feitosPorHabito: Map<string, Set<string>>,
  de: string,
  ate: string,
  hoje: string,
  pausas: PausaHabito[] = [],
): ResumoDosHabitos {
  const porHabito = habitos
    .filter((h) => h.archived_at === null)
    .map((h) => resumirHabito(h, feitosPorHabito.get(h.id) ?? new Set(), de, ate, hoje, pausas));

  let hojeFeitos = 0;
  let hojeEsperados = 0;
  let cumpridos = 0;
  let esperados = 0;
  let falhas = 0;

  for (const r of porHabito) {
    if (r.hojeFeito !== null) {
      hojeEsperados++;
      if (r.hojeFeito) hojeFeitos++;
    }
    cumpridos += r.cumpridos;
    esperados += r.esperados;
    falhas += r.falhas;
  }

  return {
    hojeFeitos,
    hojeEsperados,
    cumpridos,
    esperados,
    falhas,
    taxa: esperados === 0 ? null : Math.round((cumpridos / esperados) * 100),
    porHabito,
  };
}
