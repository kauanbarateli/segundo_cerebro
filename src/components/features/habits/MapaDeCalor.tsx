import type { CelulaDoCalendario } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * O mapa de calor — CSS GRID PURO, sem biblioteca de gráfico.
 *
 * O projeto já tomou essa decisão uma vez, e está escrita no Financeiro: "Barra
 * em SVG/CSS puro — evita ~100 KB de biblioteca de gráfico". Um quadriculado de
 * 90 quadradinhos não justifica trazer um pacote, uma superfície de auditoria e
 * uma dependência a mais no `npm audit` do CI.
 *
 * ⚠️ COLUNAS SÃO SEMANAS, LINHAS SÃO DIAS DA SEMANA. É a leitura que o formato
 * entrega de graça: colunas vizinhas comparam semanas, e uma linha inteira
 * apagada mostra o dia da semana em que o hábito sempre falha — a informação
 * mais útil de um mapa desses, e a que uma lista linear esconde.
 *
 * `grid-flow-col` com 7 linhas é o que produz isso sem calcular nada: as
 * células entram de cima para baixo e pulam para a coluna seguinte a cada sete.
 * Para o alinhamento sair certo, a primeira célula precisa cair na linha do dia
 * da semana dela — daí o `gridRowStart` da primeira.
 */

/** Quatro estados, e cada um diz uma coisa diferente. */
function tomDaCelula(c: CelulaDoCalendario): string {
  if (c.futuro) return "bg-transparent";
  if (c.feito) return "bg-accent";
  if (c.pausado) return "bg-surface-muted border border-dashed border-line-strong";
  // Não esperado ≠ falhou. Um hábito de dias úteis não falha no domingo, e
  // pintar o domingo de "vermelho claro" contaria uma história falsa.
  if (!c.esperado) return "bg-surface-muted/50";
  return "border border-line-strong bg-transparent";
}

function rotuloDaCelula(c: CelulaDoCalendario): string {
  const [, mes, dia] = c.dia.split("-");
  const data = `${dia}/${mes}`;
  if (c.futuro) return data;
  if (c.feito) return `${data} · feito`;
  if (c.pausado) return `${data} · pausado`;
  if (!c.esperado) return `${data} · não era esperado`;
  return `${data} · não feito`;
}

const LINHAS = ["", "S", "", "Q", "", "S", ""];

export function MapaDeCalor({ celulas }: { celulas: CelulaDoCalendario[] }) {
  if (celulas.length === 0) return null;

  // 0=domingo. A grade tem 7 linhas começando no domingo, então a primeira
  // célula entra na linha do dia da semana dela. Sem isto, um período que começa
  // numa quarta desenharia toda a coluna deslocada.
  const [a, m, d] = celulas[0]!.dia.split("-").map(Number);
  const primeiraLinha = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay() + 1;

  return (
    <div className="flex gap-1.5">
      <div className="grid grid-rows-7 gap-0.5 pt-0.5 text-micro leading-none text-ink-subtle">
        {LINHAS.map((l, i) => (
          <span key={i} className="flex h-3 items-center">
            {l}
          </span>
        ))}
      </div>
      <div
        className="grid grid-flow-col grid-rows-7 gap-0.5 overflow-x-auto pb-1"
        role="img"
        aria-label={`Últimos ${celulas.length} dias`}
      >
        {celulas.map((c, i) => (
          <span
            key={c.dia}
            title={rotuloDaCelula(c)}
            style={i === 0 ? { gridRowStart: primeiraLinha } : undefined}
            className={cn("h-3 w-3 shrink-0 rounded-[2px]", tomDaCelula(c))}
          />
        ))}
      </div>
    </div>
  );
}
