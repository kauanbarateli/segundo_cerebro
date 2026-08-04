import { dayRangeInTimeZone } from "@/lib/utils";

/**
 * O RESUMO SEMANAL — aritmética PURA, sem banco e sem rede.
 *
 * ⚠️ Este arquivo não importa `server-only` de propósito, e o motivo é a razão
 * de ele existir separado da rota: um módulo puro é importável tanto de uma
 * rota de cron quanto de um Server Component. Duas implementações do mesmo
 * número são a garantia de que um dia a tela diz 18, o e-mail diz 19, e ninguém
 * sabe qual está certo.
 *
 * É o mesmo padrão de `finance.ts` e `credit.ts`: o Postgres só ganhou view
 * onde o cálculo era um `SUM` trivial; o resto mora aqui, onde dá para testar.
 */

/** O fuso do aplicativo. Igual ao de `utils.ts`, e pelo mesmo motivo. */
export const FUSO = "America/Sao_Paulo";

export interface JanelaSemanal {
  /** Segunda-feira, "AAAA-MM-DD" no fuso do aplicativo. */
  inicio: string;
  /** Domingo, "AAAA-MM-DD". Inclusivo — é o último dia resumido. */
  fim: string;
  /** Instante do começo da segunda (UTC, inclusivo). Compara com `timestamptz`. */
  inicioIso: string;
  /**
   * Instante do começo da segunda SEGUINTE (UTC, exclusivo).
   *
   * Exclusivo pelo mesmo motivo que `dayRangeInTimeZone.endIso`: um
   * `23:59:59.999` inclusivo deixa escapar o que acontece no último
   * milissegundo, e "deixa escapar às vezes" é o pior tipo de defeito de
   * relatório — o número fica quase certo.
   */
  fimIso: string;
  /** "28/07 a 03/08" — para o assunto do e-mail. */
  rotulo: string;
}

/**
 * A semana ANTERIOR à data de referência: de segunda a domingo.
 *
 * ⚠️ POR QUE A ANTERIOR, E NÃO A CORRENTE. O e-mail sai segunda de manhã. A
 * semana corrente, nesse instante, tem algumas horas de vida — um resumo dela
 * diria "0 tarefas concluídas" toda segunda. O que interessa é a semana que
 * acabou de fechar.
 *
 * ⚠️ E POR QUE O CÁLCULO PASSA POR `dayRangeInTimeZone`. `getDay()` e
 * `setHours()` trabalham no fuso LOCAL DO PROCESSO, e o servidor da Vercel roda
 * em UTC. Uma segunda-feira 00:00 UTC é domingo 21h em São Paulo: o resumo
 * incluiria o domingo da semana seguinte e perderia as últimas três horas do
 * domingo resumido. É a mesma classe de defeito que `dayRangeInTimeZone` foi
 * escrita para resolver, e ela não deixa de valer aqui.
 */
export function semanaAnterior(referencia: Date, fuso: string = FUSO): JanelaSemanal {
  const hoje = dayRangeInTimeZone(referencia, fuso);

  // O dia da semana do "hoje civil" no fuso pedido. `dayKey` é "AAAA-MM-DD", e
  // interpretá-lo com `Date.UTC` dá o mesmo dia da semana sem envolver fuso
  // nenhum na conta — que é o ponto.
  const [ano, mes, dia] = hoje.dayKey.split("-").map(Number);
  const meioDiaUtc = new Date(Date.UTC(ano!, mes! - 1, dia!));
  const diaDaSemana = meioDiaUtc.getUTCDay(); // 0=domingo

  // Recuo até a segunda desta semana e mais 7 dias para chegar à anterior.
  // Domingo (0) pertence à semana que começou na segunda 6 dias antes.
  const recuoAteSegunda = (diaDaSemana + 6) % 7;
  const segundaAnterior = new Date(meioDiaUtc);
  segundaAnterior.setUTCDate(segundaAnterior.getUTCDate() - recuoAteSegunda - 7);

  const domingo = new Date(segundaAnterior);
  domingo.setUTCDate(domingo.getUTCDate() + 6);

  const chave = (d: Date) => d.toISOString().slice(0, 10);

  /*
    Os INSTANTES saem de `dayRangeInTimeZone` sobre cada extremo, e não de
    aritmética sobre estas datas UTC: só ela sabe onde fica a meia-noite civil
    de São Paulo. `meioDia` porque um instante no meio do dia cai no dia certo
    em qualquer fuso, enquanto 00:00 UTC já é o dia anterior aqui.
  */
  const meioDia = (d: Date) => new Date(d.getTime() + 12 * 3_600_000);
  const faixaInicio = dayRangeInTimeZone(meioDia(segundaAnterior), fuso);
  const faixaFim = dayRangeInTimeZone(meioDia(domingo), fuso);

  const ddmm = (chaveDoDia: string) => {
    const [, m, d] = chaveDoDia.split("-");
    return `${d}/${m}`;
  };

  return {
    inicio: chave(segundaAnterior),
    fim: chave(domingo),
    inicioIso: faixaInicio.startIso,
    // O fim da janela é o começo do dia SEGUINTE ao domingo — exclusivo.
    fimIso: faixaFim.endIso,
    rotulo: `${ddmm(chave(segundaAnterior))} a ${ddmm(chave(domingo))}`,
  };
}

/* --------------------------------------------------------- o resumo ------ */

/** Uma linha do resumo: o que aconteceu num módulo. */
export interface LinhaDoResumo {
  rotulo: string;
  valor: string;
  /** Contexto curto. `null` quando o número fala sozinho. */
  detalhe?: string | null;
}

export interface ResumoSemanal {
  janela: JanelaSemanal;
  linhas: LinhaDoResumo[];
  /** Nenhum número diferente de zero — a semana não teve movimento registrado. */
  vazio: boolean;
}

/** Os números crus que a rota colhe do banco. */
export interface ContagensDaSemana {
  tarefasConcluidas: number;
  tarefasCriadas: number;
  /** Abertas com prazo vencido AGORA — é foto do presente, não da semana. */
  tarefasAtrasadas: number;
  capturasCriadas: number;
  capturasProcessadas: number;
  paginasEditadas: number;
  eventos: number;
  /** Centavos. Positivo é entrada. */
  financeiroEntradas: number;
  financeiroSaidas: number;
}

export const CONTAGENS_ZERADAS: ContagensDaSemana = {
  tarefasConcluidas: 0,
  tarefasCriadas: 0,
  tarefasAtrasadas: 0,
  capturasCriadas: 0,
  capturasProcessadas: 0,
  paginasEditadas: 0,
  eventos: 0,
  financeiroEntradas: 0,
  financeiroSaidas: 0,
};

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Monta as linhas do resumo.
 *
 * ⚠️ LINHA COM ZERO É OMITIDA, com UMA exceção. Um e-mail com oito linhas
 * dizendo "0" ensina a não abrir o e-mail. Mas "tarefas atrasadas: 0" é uma boa
 * notícia que merece ser dita, e "tarefas concluídas: 0" é justamente o número
 * que se quer ver quando a semana não andou — omitir os dois esconderia o que o
 * resumo existe para mostrar.
 */
export function montarResumo(
  janela: JanelaSemanal,
  c: ContagensDaSemana,
  extras: LinhaDoResumo[] = [],
): ResumoSemanal {
  const linhas: LinhaDoResumo[] = [
    {
      rotulo: "Tarefas concluídas",
      valor: String(c.tarefasConcluidas),
      detalhe: c.tarefasCriadas > 0 ? `${c.tarefasCriadas} criadas na semana` : null,
    },
  ];

  if (c.tarefasAtrasadas > 0) {
    linhas.push({
      rotulo: "Tarefas atrasadas",
      valor: String(c.tarefasAtrasadas),
      // Deixa explícito que este número não é da semana: é o estado de agora.
      detalhe: "agora, com prazo vencido",
    });
  }

  if (c.capturasCriadas > 0 || c.capturasProcessadas > 0) {
    linhas.push({
      rotulo: "Capturas",
      valor: String(c.capturasCriadas),
      detalhe:
        c.capturasProcessadas > 0 ? `${c.capturasProcessadas} viraram tarefa` : "nenhuma processada",
    });
  }

  if (c.paginasEditadas > 0) {
    linhas.push({ rotulo: "Páginas editadas", valor: String(c.paginasEditadas) });
  }

  if (c.eventos > 0) {
    linhas.push({ rotulo: "Compromissos", valor: String(c.eventos) });
  }

  if (c.financeiroEntradas > 0 || c.financeiroSaidas > 0) {
    linhas.push({
      rotulo: "Financeiro",
      valor: reais(c.financeiroEntradas - c.financeiroSaidas),
      detalhe: `${reais(c.financeiroEntradas)} entrou · ${reais(c.financeiroSaidas)} saiu`,
    });
  }

  linhas.push(...extras);

  // "Vazio" ignora as linhas que aparecem mesmo zeradas — senão uma semana sem
  // nada teria "Tarefas concluídas: 0" e não contaria como vazia.
  const vazio =
    c.tarefasConcluidas === 0 &&
    c.tarefasCriadas === 0 &&
    c.capturasCriadas === 0 &&
    c.paginasEditadas === 0 &&
    c.eventos === 0 &&
    c.financeiroEntradas === 0 &&
    c.financeiroSaidas === 0 &&
    extras.length === 0;

  return { janela, linhas, vazio };
}

/* ------------------------------------------------------- o e-mail -------- */

export function assuntoDoEmail(resumo: ResumoSemanal): string {
  return `Segundo Cérebro · semana de ${resumo.janela.rotulo}`;
}

/** Escapa para HTML. O conteúdo é gerado aqui, mas rótulo é texto. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * As DUAS versões do corpo, e as duas de verdade.
 *
 * O `text` não é formalidade: cliente de e-mail com imagens bloqueadas, leitor
 * de tela e a pré-visualização da caixa de entrada usam essa parte. Mandar só
 * HTML também piora a classificação anti-spam de um remetente novo — e um
 * resumo semanal que cai no lixo eletrônico é um resumo que não existe.
 *
 * ⚠️ CSS INLINE, e nada de folha de estilo. Gmail e Outlook removem `<style>`
 * do `<head>` com frequência; o que sobrevive é `style=""` no elemento. Não é
 * preferência — é a única coisa que funciona nos dois.
 */
export function corpoDoEmail(resumo: ResumoSemanal): { html: string; texto: string } {
  const titulo = `Semana de ${resumo.janela.rotulo}`;

  if (resumo.vazio) {
    const frase =
      "Nenhum movimento registrado nesta semana. Se você usou o aplicativo, vale conferir a conexão.";
    return {
      texto: `${titulo}\n\n${frase}\n`,
      html: `<p style="margin:0 0 12px;font:600 18px/1.4 system-ui,sans-serif">${escapar(titulo)}</p><p style="margin:0;font:14px/1.6 system-ui,sans-serif;color:#555">${escapar(frase)}</p>`,
    };
  }

  const texto = [
    titulo,
    "",
    ...resumo.linhas.map((l) => `${l.rotulo}: ${l.valor}${l.detalhe ? ` (${l.detalhe})` : ""}`),
    "",
  ].join("\n");

  const itens = resumo.linhas
    .map(
      (l) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #eee;font:14px/1.5 system-ui,sans-serif;color:#555">
    ${escapar(l.rotulo)}${l.detalhe ? `<br><span style="font-size:12px;color:#999">${escapar(l.detalhe)}</span>` : ""}
  </td>
  <td style="padding:8px 0;border-bottom:1px solid #eee;font:600 16px/1.5 system-ui,sans-serif;color:#111;text-align:right;white-space:nowrap">
    ${escapar(l.valor)}
  </td>
</tr>`,
    )
    .join("");

  const html = `<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="margin:0 0 16px;font:600 18px/1.4 system-ui,sans-serif;color:#111">${escapar(titulo)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse">${itens}</table>
</div>`;

  return { html, texto };
}
