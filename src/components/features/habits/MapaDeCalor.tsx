import {
  diaDaSemana,
  type CelulaDoCalendario,
  type Habito,
} from "@/lib/habits";
import {
  DIAS_INICIAL,
  MESES_CURTOS,
  formatarDiaCurto,
  formatarDiaMedio,
} from "@/components/features/habits/Leitura";
import { cn } from "@/lib/utils";

/**
 * O MAPA DE CALOR — CSS GRID PURO, sem biblioteca de gráfico.
 *
 * O projeto já tomou essa decisão uma vez, e está escrita no Financeiro: "Barra
 * em SVG/CSS puro — evita ~100 KB de biblioteca de gráfico". Um quadriculado de
 * 90 quadradinhos não justifica trazer um pacote, uma superfície de auditoria e
 * uma dependência a mais no `npm audit` do CI.
 *
 * =============================================================================
 * ⚠️ A COLUNA É A SEMANA DO HÁBITO — SEGUNDA EM CIMA, DOMINGO EMBAIXO
 * =============================================================================
 * A versão anterior desenhava a semana começando no DOMINGO, e isso brigava com
 * o resto do módulo: `segundaDaSemana` define, para toda a aritmética, que a
 * semana do hábito vai de segunda a domingo — é o que faz "correr 3× por
 * semana" falhar no domingo à noite e não na terça.
 *
 * Com o domingo no topo, uma coluna do mapa NÃO era uma semana do hábito: era
 * um retângulo deslocado um dia, e a barra de alvo semanal (mais abaixo) diria
 * um número diferente do painel para o mesmo período. Alinhar as duas coisas é
 * o que permite ler a coluna como "esta semana bateu o alvo".
 *
 * De quebra, a leitura que o formato entrega de graça continua valendo: colunas
 * vizinhas comparam semanas, e uma LINHA inteira apagada mostra o dia da semana
 * em que o hábito sempre falha — a informação mais útil de um mapa desses, e a
 * que uma lista linear esconde.
 *
 * =============================================================================
 * ⚠️ POR QUE CADA CÉLULA É POSICIONADA À MÃO (`gridRow` / `gridColumn`)
 * =============================================================================
 * A versão anterior usava `grid-flow-col grid-rows-7` + `gridRowStart` só na
 * primeira célula. Aquilo FUNCIONAVA — é a técnica clássica do quadro de
 * contribuições — e não foi trocado por estar errado. Foi trocado porque o mapa
 * ganhou mais duas faixas, e a colocação automática não convive com elas:
 *
 *   1. `grid-rows-7` vale `repeat(7, minmax(0, 1fr))`. Linha em `1fr` se estica
 *      para preencher a altura do contêiner; enquanto a altura vinha só do
 *      conteúdo isso dava no mesmo, mas com o eixo de meses em cima e a barra
 *      de alvo semanal embaixo as sete linhas precisam medir exatamente
 *      `var(--cel)` — senão a célula deixa de ser quadrada e o eixo de dias da
 *      semana, que é uma grade separada, sai do alinhamento.
 *   2. Com uma linha de meses no topo, `grid-auto-flow: column` jogaria as
 *      células de dia DENTRO dessa linha nas colunas onde não há rótulo de mês.
 *      Reservar o espaço com placeholders custaria mais código do que declarar
 *      a posição.
 *
 * Posicionar explicitamente também acaba com qualquer dúvida nas colunas
 * PARCIAIS do começo e do fim do período, que é onde esse tipo de grade costuma
 * escorregar em silêncio.
 *
 * =============================================================================
 * ⚠️ INTENSIDADE VEM DE OPACIDADE DO `ink`, NUNCA DE MATIZ
 * =============================================================================
 * O aplicativo é monocromático por decisão, e vermelho/âmbar já significam ERRO
 * nele. Pintar "falhou" de vermelho aqui contaria a história errada duas vezes:
 * quebraria o sistema e diria "algo deu errado no aplicativo" onde o que houve
 * foi um dia não cumprido.
 *
 * A rampa tem quatro degraus e usa DOIS eixos, não um:
 *
 *   feito           `bg-ink`                    massa sólida
 *   falhou          anel de 1px + preenchimento fraco   contorno vazado
 *   pausado         ponto central                shape diferente
 *   não esperado    `bg-ink/[0.05]`              quase fundo
 *
 * Sólido vs. vazado é diferença de FORMA, não só de tom: um trecho ruim vira
 * uma faixa de quadrados ocos e um bom vira uma mancha cheia, legível de longe
 * e em qualquer tema.
 *
 * =============================================================================
 * ⚠️ CONTRASTE: O ANEL É `ink/50`, E O NÚMERO FOI MEDIDO, NÃO ESTIMADO
 * =============================================================================
 * O anel de "não feito" começou em `ink/40` por estimativa de cabeça. Medido no
 * navegador, com os tokens reais compostos sobre `surface`, aquilo dava 2,58:1
 * no tema claro — ABAIXO do piso de 3:1 da WCAG 1.4.11 para objeto gráfico. A
 * conta de guardanapo errou porque o `ink` do tema claro é rgb(20,20,20) e não
 * preto, e porque a curva de luminância não é linear.
 *
 * Em `ink/50` a medição dá 3,48:1 no claro e 4,74:1 no escuro. O tema escuro é
 * sempre o mais folgado dos dois: ali o `ink` é quase branco sobre uma
 * superfície quase preta, então a mesma opacidade rende mais separação. QUEM
 * MEXER NESTA RAMPA MEDE DE NOVO NO CLARO — é o tema que aperta.
 *
 * Os degraus mais fracos (`ink/[0.05]`) ficam DE PROPÓSITO abaixo do piso: "não
 * esperado" significa que nada foi pedido naquele dia, e um dia sem obrigação
 * não precisa ser percebido como objeto — ele é fundo. A informação inteira,
 * sem exceção, está no `<figcaption>` — ver o bloco de acessibilidade abaixo.
 */

/** 0 = segunda … 6 = domingo. Ver o bloco sobre a semana, no topo. */
function linhaDaSemana(chave: string): number {
  return (diaDaSemana(chave) + 6) % 7;
}

/** O inverso: linha do mapa → numeração 0=domingo do banco. */
function dowDaLinha(linha: number): number {
  return (linha + 1) % 7;
}

function tomDaCelula(c: CelulaDoCalendario, hoje: string): string {
  if (c.futuro) return "bg-transparent";
  if (c.feito) return "bg-ink";
  /*
    HOJE EM ABERTO NÃO É FALHA, e o anel forte é a âncora do mapa: sem ele, a
    pessoa conta colunas para descobrir onde o gráfico termina. Vem antes de
    `pausado` e de `!esperado` porque vale em qualquer cadência — num hábito
    semanal nenhum dia é "esperado", e hoje continua sendo hoje.
  */
  if (c.dia === hoje) return "bg-ink/[0.05] ring-2 ring-inset ring-ink";
  if (c.pausado) return "bg-ink/[0.05]";
  // Não esperado ≠ falhou. Um hábito de dias úteis não falha no domingo, e
  // marcá-lo como falha contaria uma história falsa.
  if (!c.esperado) return "bg-ink/[0.05]";
  return "bg-ink/[0.12] ring-1 ring-inset ring-ink/50";
}

function rotuloDaCelula(c: CelulaDoCalendario, hoje: string, semanal: boolean): string {
  const data = formatarDiaCurto(c.dia);
  if (c.futuro) return data;
  if (c.feito) return `${data} · feito`;
  if (c.dia === hoje) return `${data} · hoje, em aberto`;
  if (c.pausado) return `${data} · pausado`;
  // Num hábito semanal a cobrança é da SEMANA: dizer "não era esperado" em cada
  // dia sugeriria que a regra estava suspensa, o que é outra coisa.
  if (semanal) return `${data} · sem marcação`;
  if (!c.esperado) return `${data} · fora da regra`;
  return `${data} · não feito`;
}

/**
 * Onde cada mês começa, para o eixo horizontal.
 *
 * O eixo é o que transforma "uma mancha no meio do quadriculado" em "eu caí em
 * julho". Sem ele, um mapa de 90 dias não tem onde ancorar a memória.
 *
 * O filtro do fim descarta o rótulo que ficaria colado no seguinte: quando a
 * janela começa nos últimos dias de um mês, "jul" e "ago" cairiam a uma coluna
 * de distância e se sobreporiam. Some o mais curto — que é o menos informativo.
 */
function eixoDeMeses(
  celulas: CelulaDoCalendario[],
  colunaDe: (i: number) => number,
): { coluna: number; rotulo: string }[] {
  const candidatos: { coluna: number; rotulo: string }[] = [];
  let mesAnterior = "";

  celulas.forEach((c, i) => {
    const mes = c.dia.slice(0, 7);
    if (mes === mesAnterior) return;
    mesAnterior = mes;
    const indiceDoMes = Number(c.dia.slice(5, 7)) - 1;
    candidatos.push({ coluna: colunaDe(i), rotulo: MESES_CURTOS[indiceDoMes] ?? "" });
  });

  return candidatos.filter((c, i) => {
    const proximo = candidatos[i + 1];
    return !proximo || proximo.coluna - c.coluna >= 3;
  });
}

export function MapaDeCalor({
  habito,
  celulas,
  hoje,
}: {
  habito: Habito;
  celulas: CelulaDoCalendario[];
  /** "AAAA-MM-DD" no fuso do aplicativo. */
  hoje: string;
}) {
  if (celulas.length === 0) return null;

  const primeira = celulas[0]!;
  const ultima = celulas[celulas.length - 1]!;
  const deslocamento = linhaDaSemana(primeira.dia);
  const colunaDe = (i: number) => Math.floor((deslocamento + i) / 7);
  const totalDeColunas = colunaDe(celulas.length - 1) + 1;

  const semanal = habito.schedule_kind === "weekly_target";
  const alvo = habito.weekly_target ?? 1;

  /*
    A BARRA DE ALVO SEMANAL — só existe em `weekly_target`, e é a leitura que
    diferencia essa cadência das outras duas dentro do próprio mapa.

    Um hábito de "3× por semana" tem `eraEsperado` FALSO em todo dia (a unidade
    dele é a semana, não o dia), então o quadriculado dele é quase todo cinza de
    "não esperado" e não diz se a semana fechou. A barra diz: cheia = alvo
    batido, vazada = semana perdida, ausente = semana ainda em curso ou pausada.

    A primeira coluna fica de fora quando é PARCIAL: a semana dela começou antes
    da janela carregada, então a contagem estaria incompleta e a barra mentiria
    para menos.
  */
  const barrasDaSemana = semanal
    ? Array.from({ length: totalDeColunas }, (_, coluna) => {
        const daColuna = celulas.filter((_c, i) => colunaDe(i) === coluna);
        if (coluna === 0 && deslocamento > 0) return null;
        if (daColuna.every((c) => c.pausado)) return null;
        const feitos = daColuna.filter((c) => c.feito && c.dia >= habito.started_on).length;
        const encerrada = daColuna[daColuna.length - 1]!.dia < hoje;
        if (feitos >= alvo) return { coluna, batida: true };
        return encerrada ? { coluna, batida: false } : null;
      }).filter((b): b is { coluna: number; batida: boolean } => b !== null)
    : [];

  const meses = eixoDeMeses(celulas, colunaDe);

  /*
    As letras do eixo vertical mudam com a cadência, e não por capricho: num
    hábito de dias fixos, as linhas que importam são exatamente as da regra —
    marcá-las responde "quais dias?" no próprio gráfico. Nas outras cadências
    todos os dias valem igual, e aí três âncoras (seg/qua/sex) bastam; sete
    letras de 10px viram ruído.
  */
  const linhasRotuladas =
    habito.schedule_kind === "weekdays"
      ? [0, 1, 2, 3, 4, 5, 6].filter((l) => habito.weekdays.includes(dowDaLinha(l)))
      : [0, 2, 4];

  // As duas variantes precisam existir como STRING LITERAL no arquivo: o
  // Tailwind varre o código-fonte e não avalia expressão.
  const gradeDeLinhas = semanal
    ? "grid-rows-[var(--mes)_repeat(7,var(--cel))_var(--barra)]"
    : "grid-rows-[var(--mes)_repeat(7,var(--cel))]";

  const cumpridos = celulas.filter((c) => c.feito).length;
  const naoCumpridos = celulas.filter((c) => c.esperado && !c.feito && c.dia < hoje);
  const pausados = celulas.filter((c) => c.pausado).length;

  return (
    <figure
      className={cn(
        // O TAMANHO DA CÉLULA É RESPONSIVO POR VARIÁVEL, e é isso que faz o mapa
        // caber em 375px SEM PERDER DIAS: a coluna é a SEMANA, então 90 dias
        // ocupam 13 ou 14 colunas (14 quase sempre, porque a janela raramente
        // começa numa segunda), não noventa.
        //
        // Medido no navegador a 375px de viewport: célula de 14px, mapa de 222px
        // de largura, sem rolagem nem no mapa nem na página. Encolher a janela no
        // celular custaria informação para resolver um problema que não existe.
        "[--barra:6px] [--cel:14px] [--gap:2px] [--mes:14px]",
        "sm:[--cel:18px] sm:[--gap:3px]",
      )}
    >
      <div className="flex gap-2">
        {/* Eixo vertical: dia da semana. */}
        <div
          aria-hidden
          className={cn(
            "grid w-3 shrink-0 gap-[var(--gap)] text-micro leading-none text-ink-subtle",
            gradeDeLinhas,
          )}
        >
          <span />
          {[0, 1, 2, 3, 4, 5, 6].map((linha) => (
            <span key={linha} className="flex items-center">
              {linhasRotuladas.includes(linha) ? DIAS_INICIAL[dowDaLinha(linha)] : ""}
            </span>
          ))}
        </div>

        {/* `overflow-x-auto` é rede de segurança, não o plano: ver a nota sobre
            treze colunas acima. Ela existe para a fonte gigante do sistema e
            para uma janela maior que 90 dias, se um dia houver. */}
        <div className="min-w-0 flex-1 overflow-x-auto pb-0.5">
          <div
            aria-hidden
            className={cn("grid w-max gap-[var(--gap)] auto-cols-[var(--cel)]", gradeDeLinhas)}
          >
            {meses.map((m) => (
              <span
                key={`${m.coluna}-${m.rotulo}`}
                style={{ gridRow: 1, gridColumn: m.coluna + 1 }}
                className="whitespace-nowrap text-micro leading-none text-ink-subtle"
              >
                {m.rotulo}
              </span>
            ))}

            {celulas.map((c, i) => (
              <span
                key={c.dia}
                title={rotuloDaCelula(c, hoje, semanal)}
                style={{
                  gridRow: ((deslocamento + i) % 7) + 2,
                  gridColumn: colunaDe(i) + 1,
                }}
                /* `rounded-[2px]` é EXCEÇÃO CONSCIENTE à escala de raios do DS.
                   O menor degrau de lá é 4px (`rounded-xs`), e numa célula de
                   14px isso arredonda quase um terço do lado: as colunas param
                   de se ler como colunas e a grade vira um borrão de pontos.
                   Aqui o quadrado não é superfície, é marca de gráfico — a mesma
                   razão pela qual o `text-micro` de 10px sobrevive neste arquivo.
                   Ver o bloco de forma em tailwind.config.ts. */
                className={cn(
                  "flex h-[var(--cel)] w-[var(--cel)] items-center justify-center rounded-[2px]",
                  tomDaCelula(c, hoje),
                )}
              >
                {/* O ponto é o que separa "pausado" de "não esperado" por FORMA.
                    Uma semana de férias vira uma coluna de pontinhos, que se lê
                    de longe como "aqui a regra não valia". */}
                {c.pausado && !c.feito && (
                  <span className="h-1 w-1 rounded-full bg-ink/50" />
                )}
              </span>
            ))}

            {barrasDaSemana.map((b) => (
              <span
                key={`sem-${b.coluna}`}
                style={{ gridRow: 9, gridColumn: b.coluna + 1 }}
                className={cn(
                  "h-1.5 w-[var(--cel)] rounded-full",
                  b.batida ? "bg-ink" : "bg-ink/10 ring-1 ring-inset ring-ink/50",
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/*
        =====================================================================
        A ALTERNATIVA TEXTUAL — e por que ela NÃO é uma tabela de 90 células
        =====================================================================
        Uma grade de `div` sem texto não significa nada para leitor de tela, e
        `title` por célula (que continua ali, para o ponteiro parado) não é lido
        de forma confiável. Então a grade inteira é `aria-hidden` e o conteúdo
        acessível é ESTE parágrafo.

        A opção óbvia — um `<table class="sr-only">` com as 90 células — é pior
        na prática: ninguém navega noventa células de uma linha para descobrir
        onde falhou, e o cabeçalho seria "quarta-feira × semana 7", que não
        localiza nada. O que a pessoa quer saber é o RESUMO e QUAIS dias
        falharam; é exatamente isso que está escrito aqui, com as datas por
        extenso. A lista é limitada a doze dias porque além disso ela deixa de
        ser resumo — o número total continua na frase.
      */}
      <figcaption className="sr-only">
        {`Mapa de ${celulas.length} dias de ${habito.name}, de ${formatarDiaMedio(primeira.dia)} a ${formatarDiaMedio(ultima.dia)}. `}
        {`${cumpridos} ${cumpridos === 1 ? "dia marcado" : "dias marcados"}. `}
        {pausados > 0 && `${pausados} ${pausados === 1 ? "dia pausado" : "dias pausados"}. `}
        {semanal
          ? `A regra é semanal (${alvo}× por semana): nenhum dia isolado conta como falha, e cada coluna do mapa é uma semana de segunda a domingo. ${
              barrasDaSemana.filter((b) => !b.batida).length
            } semanas encerradas ficaram abaixo do alvo.`
          : naoCumpridos.length === 0
            ? "Nenhum dia esperado ficou sem marcação."
            : `Não cumprido em ${naoCumpridos.length} ${naoCumpridos.length === 1 ? "dia" : "dias"}: ${naoCumpridos
                .slice(-12)
                .map((c) => formatarDiaMedio(c.dia))
                .join(", ")}${naoCumpridos.length > 12 ? ", entre outros" : ""}.`}
      </figcaption>
    </figure>
  );
}

/**
 * A legenda do mapa, UMA VEZ POR TELA — não uma por hábito.
 *
 * Repetida em cada cartão ela viraria mobília: cinco cópias da mesma frase
 * competindo com os dados que a tela existe para mostrar. A regra "nunca
 * informação só por cor" é atendida com uma legenda visível, e uma basta.
 */
export function LegendaDoMapa({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-legenda text-ink-subtle",
        className,
      )}
    >
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-[2px] bg-ink" />
        feito
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-3 rounded-[2px] bg-ink/[0.12] ring-1 ring-inset ring-ink/50"
        />
        não feito
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="flex h-3 w-3 items-center justify-center rounded-[2px] bg-ink/[0.05]"
        >
          <span className="h-1 w-1 rounded-full bg-ink/50" />
        </span>
        pausado
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-[2px] bg-ink/[0.05]" />
        fora da regra
      </li>
    </ul>
  );
}
