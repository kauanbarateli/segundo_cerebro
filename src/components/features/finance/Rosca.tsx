import { corDaPosicao, tomDaCor } from "@/lib/finance-colors";
import { cn } from "@/lib/utils";

/**
 * ROSCA (donut) EM SVG PURO — nenhuma biblioteca de gráfico.
 *
 * ============================================================================
 * POR QUE À MÃO
 * ============================================================================
 * A rota `/financeiro` pesa ~14 kB de JavaScript próprio. Recharts custa ~90 kB
 * comprimidos — seis vezes o peso da rota inteira para desenhar oito arcos. O
 * projeto já não tinha dependência de gráfico por escolha (as barras de
 * `FinanceView` e da Início são `<div>` com largura percentual), e uma rosca é
 * geometria de uma linha só.
 *
 * ============================================================================
 * A GEOMETRIA, EM UMA FRASE
 * ============================================================================
 * Um `<circle>` de raio 15.9155 tem circunferência 2πr = 100. Com isso,
 * `stroke-dasharray="X 100-X"` desenha exatamente X POR CENTO do círculo, e
 * `stroke-dashoffset` gira o começo do traço. Nenhuma trigonometria, nenhum
 * `path` com arcos, nada que precise ser recalculado quando o tamanho muda — o
 * `viewBox` cuida da escala.
 *
 * O `rotate(-90)` põe o zero no topo. Sem ele a primeira fatia começaria às três
 * horas, que é onde ninguém procura o começo de um gráfico.
 *
 * ============================================================================
 * ⚠️ O VÃO ENTRE AS FATIAS É ACESSIBILIDADE, NÃO ENFEITE
 * ============================================================================
 * As oito cores categóricas passam com folga contra o fundo (ver globals.css),
 * mas ENTRE SI o pior par tem 1.01 de contraste de luminância: elas se separam
 * por MATIZ. Duas fatias vizinhas encostadas virariam um borrão único para quem
 * não distingue aquele par de matizes — e em escala de cinza, para todo mundo.
 *
 * O vão resolve isso geometricamente: a separação passa a ser a AUSÊNCIA de
 * traço, que não depende de enxergar cor nenhuma.
 *
 * Ele sai quando há uma fatia só (não há o que separar) e encolhe quando a fatia
 * é menor que ele — sem isso, uma categoria de 0,3% viraria comprimento negativo
 * e o navegador desenharia a fatia INTEIRA, ou seja, a menor categoria do mês
 * apareceria como a maior.
 *
 * ============================================================================
 * SEM MOVIMENTO
 * ============================================================================
 * Nada aqui anima. É a mesma decisão do resto do projeto (`tailwind.config.ts`,
 * bloco de movimento): animação de gráfico por JavaScript não é alcançada por
 * `prefers-reduced-motion` e teria que consultar `matchMedia` à mão.
 */

export interface FatiaDaRosca {
  id: string;
  rotulo: string;
  valorCents: number;
  /** 0..1 */
  share: number;
  /** `color_key` da categoria/etiqueta, ou null para o balde sem cor. */
  colorKey: string | null;
}

/** Circunferência 100 -> `stroke-dasharray` em por cento direto. */
const RAIO = 15.9154943;
const VAO = 1.2;

export function Rosca({
  fatias,
  valorCentral,
  rotuloCentral,
  descricao,
  money,
}: {
  fatias: FatiaDaRosca[];
  /** O número grande no miolo — já formatado (e já mascarado, se for o caso). */
  valorCentral: string;
  rotuloCentral: string;
  /** O que o gráfico mostra, para quem usa leitor de tela. */
  descricao: string;
  /**
   * A formatação de dinheiro vem de FORA porque ela carrega o `hideValues` —
   * formatar aqui dentro criaria uma segunda implementação que não conhece a
   * preferência, e o gráfico seria o único lugar da tela em que "ocultar
   * valores" não vale.
   */
  money: (cents: number) => string;
}) {
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg
          viewBox="0 0 42 42"
          className="h-40 w-40"
          role="img"
          aria-label={descricao}
        >
          {/* Trilho: sem ele, um mês com uma categoria só mostraria um arco
              solto no vazio, sem a forma de rosca que dá a escala. */}
          <circle
            cx="21"
            cy="21"
            r={RAIO}
            fill="none"
            className="stroke-surface-muted"
            strokeWidth="5"
          />
          {fatias.map((fatia, i) => {
            const porcento = fatia.share * 100;
            const vao = fatias.length > 1 ? Math.min(VAO, porcento) : 0;
            const traco = Math.max(0, porcento - vao);
            const offset = -acumulado;
            acumulado += porcento;
            const tom = fatia.colorKey ? tomDaCor(fatia.colorKey) : corDaPosicao(null, i);
            return (
              <circle
                key={fatia.id}
                cx="21"
                cy="21"
                r={RAIO}
                fill="none"
                // A ESPESSURA vai como ATRIBUTO, não como classe. `stroke-[5]`
                // é ambíguo para o Tailwind (o utilitário `stroke-*` serve a
                // cor E a espessura), e o modo de falha é o pior possível:
                // nenhum erro, e o arco sai com 1px na build de produção. A cor
                // continua vindo por classe, que é o que precisa trocar com o tema.
                strokeWidth="5"
                className={tom.traco}
                strokeDasharray={`${traco} ${100 - traco}`}
                strokeDashoffset={offset}
                transform="rotate(-90 21 21)"
              />
            );
          })}
        </svg>
        {/*
          O miolo é HTML sobreposto, e não `<text>` no SVG. Texto dentro de SVG
          não herda a escala tipográfica do projeto, não quebra linha e não
          acompanha o `hideValues` sem uma segunda implementação de formatação.
          `aria-hidden` porque o mesmo número já está no `aria-label` do gráfico.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        >
          <span className="text-legenda text-ink-subtle">{rotuloCentral}</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{valorCentral}</span>
        </div>
      </div>

      {/*
        ⚠️ A LEGENDA É O DADO; a rosca é o atalho visual.

        Nome, valor e percentual em TEXTO, sempre. É a regra que
        `calendar-colors.ts` chama de "a que não se negocia" — e aqui ela é ainda
        mais necessária, porque oito matizes num disco de 160px é justamente o
        caso em que a cor sozinha não responde.
      */}
      <ul className="w-full min-w-0 space-y-1.5">
        {fatias.map((fatia, i) => {
          const tom = fatia.colorKey ? tomDaCor(fatia.colorKey) : corDaPosicao(null, i);
          return (
            <li key={fatia.id} className="flex items-center gap-2 text-corpo">
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tom.fundo)} />
              <span className="min-w-0 flex-1 truncate text-ink">{fatia.rotulo}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {money(fatia.valorCents)}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums text-ink-subtle">
                {(fatia.share * 100).toFixed(0)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Junta a cauda longa num balde "Outras".
 *
 * Sem isto, um mês com dezoito categorias produz treze fatias de menos de 2% —
 * indistinguíveis no disco, e uma legenda mais alta que o próprio gráfico. O
 * balde é `stone` de propósito: ele é a AUSÊNCIA de uma categoria, e gastar uma
 * cor da paleta nele tiraria essa cor de uma categoria de verdade.
 *
 * O total continua fechando: `Outras` soma exatamente o que foi tirado.
 */
export function limitarFatias(fatias: FatiaDaRosca[], maximo: number): FatiaDaRosca[] {
  if (fatias.length <= maximo) return fatias;
  const principais = fatias.slice(0, maximo - 1);
  const resto = fatias.slice(maximo - 1);
  return [
    ...principais,
    {
      id: "__outras__",
      rotulo: `Outras (${resto.length})`,
      valorCents: resto.reduce((s, f) => s + f.valorCents, 0),
      share: resto.reduce((s, f) => s + f.share, 0),
      colorKey: "stone",
    },
  ];
}
