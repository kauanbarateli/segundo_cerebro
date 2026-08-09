"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { PillButton } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { formatBRL, monthLabel, plural, concorda, cn } from "@/lib/utils";
import {
  variation,
  horizontesDoDinheiro,
  pendentesDoPeriodo,
  rotuloDoPeriodo,
  RECORTES,
  ROTULO_DO_RECORTE,
  type Recorte,
} from "@/lib/finance";
import { faturasQueVencemEm, totalAPagarEm } from "@/lib/credit";
import { diaCivilDe } from "@/lib/tempo";
import { corDaPosicao } from "@/lib/finance-colors";
import { Rosca, limitarFatias, type FatiaDaRosca } from "./Rosca";
import { StatCard, CompareRow, dataBR, type Dinheiro, type FinanceViewProps } from "./comum";

/* --------------------------------------------------------------- dashboard */

/** "2026-08-01" -> "ago". Componentes numéricos, nunca `new Date(iso)`. */
const MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short" });
function mesCurto(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  return MES_CURTO.format(new Date(ano!, (mes ?? 1) - 1, 1)).replace(".", "");
}

export function Painel({
  month,
  recorte,
  analise,
  transactions,
  futureCardTransactions,
  pendentes,
  balances,
  accounts,
  money,
  hidden,
  onRecorte,
}: FinanceViewProps & {
  money: Dinheiro;
  hidden: boolean;
  onRecorte: (r: Recorte) => void;
}) {
  const { atual, anterior, meses, porCategoria, porEtiqueta, beneficiarios, historico, orfaos } =
    analise;

  const todasTx = useMemo(
    () => [...transactions, ...futureCardTransactions],
    [transactions, futureCardTransactions],
  );

  /*
    ⚠️ TRÊS NÚMEROS SOBRE O FUTURO, E O NOME DE CADA UM É A DECISÃO.

    "Dívida" carrega significado de balanço: passivo é o que existe mesmo se você
    parar tudo hoje. Doze aluguéis futuros não são isso — saindo do imóvel no
    terceiro mês, os outros nove não acontecem. Doze parcelas de um sofá são,
    porque o sofá já está na sala.

    Juntar os dois num número só seria mais simples e diria a coisa errada; é o
    tipo de "simplificação" que alguém vai querer fazer depois. Ver
    `horizontesDoDinheiro`, onde a classificação e o porquê estão por escrito.

    `accounts` vem sem as arquivadas (getFinanceSnapshot filtra archived_at), e é
    ela que define o universo: saldo de conta fora da lista é ignorado.
  */
  const horizontes = useMemo(
    () =>
      horizontesDoDinheiro({
        balances,
        accounts,
        pendentes,
        lancamentosDeCartao: todasTx,
        hoje: diaCivilDe(new Date().toISOString()),
      }),
    [balances, accounts, pendentes, todasTx],
  );
  const { patrimonioCents, dividaCents, compromissosCents, totalPrevistoCents, liquidoCents } =
    horizontes;

  /*
    ⚠️ "A PAGAR" É SEMPRE SOBRE O MÊS, mesmo quando o recorte é trimestre ou ano.

    Não é descuido: a pergunta que este cartão responde é de FLUXO DE CAIXA —
    "quanto sai do meu bolso agora" —, e ela só faz sentido num horizonte curto.
    Somar o "a pagar" de um ano inteiro produziria um número grande que ninguém
    usa para decidir nada, ao lado de um total previsto que já responde isso
    melhor. O rótulo diz o mês, para a diferença ficar visível.

    Ele soma DUAS coisas: as faturas de cartão que vencem no mês e as despesas
    não pagas cuja competência é o mês. Antes só havia a primeira, e uma conta de
    luz lançada e não paga não aparecia em lugar nenhum além de "Despesas do mês".
  */
  const aVencer = useMemo(
    () => faturasQueVencemEm(todasTx, accounts.filter((a) => a.kind === "credit_card"), month),
    [todasTx, accounts, month],
  );
  const pendentesDoMes = useMemo(
    () => pendentesDoPeriodo(pendentes, [month], accounts),
    [pendentes, month, accounts],
  );
  const aPagarCents = totalAPagarEm(aVencer) + pendentesDoMes.totalCents;

  const incomeVar = variation(atual.incomeCents, anterior.incomeCents);
  const expenseVar = variation(atual.expenseCents, anterior.expenseCents);

  // Com valores ocultos o sinal também some: saber que o líquido está negativo
  // já é informação sobre o dinheiro, e é justamente o que "ocultar" promete não
  // mostrar por cima do ombro de ninguém.
  const liquidoLabel = hidden
    ? money(liquidoCents)
    : `${liquidoCents >= 0 ? "+" : "−"}${formatBRL(Math.abs(liquidoCents))}`;

  const periodo = rotuloDoPeriodo(meses, recorte);
  const rotuloDoPeriodoNaTela = recorte === "mes" ? monthLabel(month) : periodo;

  const fatias: FatiaDaRosca[] = limitarFatias(
    porCategoria.map((c) => ({
      id: c.categoryId ?? "sem-categoria",
      rotulo: c.name,
      valorCents: c.totalCents,
      share: c.share,
      colorKey: c.colorKey,
    })),
    7,
  );

  return (
    <div className="space-y-5">
      {/*
        O alternador de recorte. `PillButton` é o mesmo controle das abas, e não
        um seletor novo: a barra já ensina que pílula preta é "o que está ativo".
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-legenda capitalize text-ink-subtle">{rotuloDoPeriodoNaTela}</p>
        <div className="flex gap-1.5" role="group" aria-label="Recorte de tempo">
          {RECORTES.map((r) => (
            <PillButton key={r} active={recorte === r} onClick={() => onRecorte(r)}>
              {ROTULO_DO_RECORTE[r]}
            </PillButton>
          ))}
        </div>
      </div>

      {/*
        =====================================================================
        CAMADA 1 — A RESPOSTA
        =====================================================================
        ⚠️ ESTE É O ÚNICO DESTAQUE DA TELA, e `Card.tsx` documenta a regra:
        "o nível 3 é caro por natureza: se tudo é destaque, nada é. A regra
        prática é NO MÁXIMO UM por tela."

        Antes havia sete `StatCard` do mesmo tamanho e da mesma tipografia
        respondendo sete perguntas diferentes — o olho varria da esquerda para a
        direita sem saber onde parar. O Líquido deixa de ser um card entre sete e
        vira a resposta; Patrimônio e Dívida ficam ao lado como as duas parcelas
        da conta que o produz.

        Eles nunca somem: a regra do Painel continua sendo que o Líquido não
        aparece sozinho, porque sozinho ele esconde o endividamento.
      */}
      <Card className="p-6" elevacao="destaque">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-legenda text-ink-subtle">Líquido</p>
            <p
              className={cn(
                "mt-1 text-4xl font-semibold tabular-nums",
                liquidoCents >= 0 ? "text-success-ink" : "text-danger-ink",
              )}
            >
              {liquidoLabel}
            </p>
            <p className="mt-1 text-legenda text-ink-subtle">
              Patrimônio menos dívida. Compromissos futuros não entram aqui.
            </p>
          </div>

          {/*
            As duas parcelas da conta, em `sm:` a coluna da direita. Elas são
            SECUNDÁRIAS na hierarquia (corpo menor, sem card próprio) e
            OBRIGATÓRIAS na leitura — é o que impede o número grande de ser lido
            como "tenho isso aqui".
          */}
          <dl className="flex gap-6 sm:gap-8">
            <div>
              <dt className="text-legenda text-ink-subtle">Patrimônio</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {money(patrimonioCents)}
              </dd>
            </div>
            <div>
              <dt className="text-legenda text-ink-subtle">Dívida</dt>
              <dd
                className={cn(
                  "mt-0.5 text-sm font-semibold tabular-nums",
                  dividaCents > 0 ? "text-danger-ink" : "text-ink",
                )}
              >
                {money(dividaCents)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {/*
        =====================================================================
        CAMADA 2 — O QUE AINDA VAI SAIR
        =====================================================================
        Os três horizontes da MESMA pergunta, em ordem crescente de alcance:
        este mês, o futuro cancelável, e o total.

        ⚠️ "A PAGAR" NUNCA APARECE SEM O TOTAL AO LADO. Sozinho, o número curto é
        otimista: "R$ 1.200 este mês" soa administrável mesmo quando existem
        R$ 14.000 atrás dele.

        ⚠️ E "COMPROMISSOS" NÃO É DÍVIDA. Doze aluguéis futuros somam no total
        previsto e NÃO no passivo — saindo do imóvel, eles deixam de existir.
        Juntar os dois num número só é a "simplificação" que este bloco existe
        para não permitir.
      */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={`A pagar em ${monthLabel(month).replace(/ de \d{4}$/, "")}`}
          value={money(aPagarCents)}
          tone={aPagarCents > 0 ? "negative" : undefined}
          hint={
            aVencer.length === 0 && pendentesDoMes.quantidade === 0
              ? "Nada vence neste mês."
              : [
                  aVencer.length > 0 &&
                    `${plural(aVencer.length, "fatura", "faturas")} (vence ${aVencer
                      .map((f) => dataBR(f.vence))
                      .join(", ")})`,
                  pendentesDoMes.quantidade > 0 &&
                    plural(pendentesDoMes.quantidade, "despesa em aberto", "despesas em aberto"),
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
        <StatCard
          label="Compromissos futuros"
          value={money(compromissosCents)}
          hint="Recorrências e despesas ainda não vencidas. Deixam de existir se forem canceladas."
        />
        <StatCard
          label="Total previsto"
          value={money(totalPrevistoCents)}
          tone={totalPrevistoCents > 0 ? "negative" : undefined}
          hint={
            horizontes.ate
              ? `Dívida mais compromissos, até ${monthLabel(horizontes.ate)}.`
              : "Dívida mais compromissos."
          }
        />
      </div>

      {/*
        =====================================================================
        CAMADA 3 — O MÊS (o que JÁ aconteceu)
        =====================================================================
        Separada da camada 2 de propósito: aquela é sobre o futuro, esta é sobre
        o período fechado. Misturá-las era parte do que fazia sete números
        parecerem a mesma coisa.
      */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Receitas"
          value={money(atual.incomeCents)}
          delta={incomeVar}
          positiveIsGood
        />
        <StatCard
          label="Despesas"
          value={money(atual.expenseCents)}
          delta={expenseVar}
          positiveIsGood={false}
        />
        <StatCard
          label="Resultado"
          value={money(atual.balanceCents)}
          tone={atual.balanceCents >= 0 ? "positive" : "negative"}
        />
      </div>

      {/*
        ⚠️ O AVISO QUE IMPEDE OS NÚMEROS DE DISCORDAREM EM SILÊNCIO.

        Lançamento de cartão sem `statement_month` pesa em `debt_cents` (a view
        só olha `is_paid`) e não pertence a fatura nenhuma — logo, não entra em
        mês nenhum das somas acima. Sem esta linha, "Despesas" viria menor que a
        realidade e a única pista seria a dívida não bater. Contá-los é a
        explicação.
      */}
      {orfaos.quantidade > 0 && (
        <Card className="border-warning/40 p-4">
          <p className="flex items-start gap-2 text-corpo text-warning-ink">
            <Icon.Alert width={15} height={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {plural(orfaos.quantidade, "lançamento", "lançamentos")} de cartão sem fatura
              atribuída ({money(orfaos.totalCents)}).{" "}
              {concorda(orfaos.quantidade, "Ele conta", "Eles contam")} na dívida e{" "}
              {concorda(orfaos.quantidade, "não entra", "não entram")} em nenhum mês acima —
              cadastre o dia de fechamento do cartão em Contas para resolver.
            </span>
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <h3 className="text-corpo-forte font-semibold text-ink">Despesas por categoria</h3>
          <p className="mt-0.5 mb-4 text-legenda capitalize text-ink-subtle">
            {rotuloDoPeriodoNaTela} · {plural(atual.transactionCount, "lançamento", "lançamentos")}
          </p>

          {fatias.length === 0 ? (
            <EmptyState icon="Wallet" title="Sem despesas neste período" />
          ) : (
            <Rosca
              fatias={fatias}
              valorCentral={money(atual.expenseCents)}
              rotuloCentral="Despesas"
              descricao={`Despesas por categoria: ${fatias
                .map((f) => `${f.rotulo} ${(f.share * 100).toFixed(0)}%`)
                .join(", ")}`}
              money={money}
            />
          )}
        </Card>

        <HistoricoCard historico={historico} money={money} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/*
          ⚠️ "SEMANA A SEMANA" FOI REMOVIDO, e não substituído.

          O bloco quebrava as despesas do mês em faixas de sete dias ancoradas na
          primeira compra do período (e não no dia 1, por causa da competência de
          cartão). Ele funcionava — e não respondia a nenhuma pergunta que os
          outros cards já não respondessem melhor: o "Últimos 12 meses" cobre a
          variação no tempo, e a rosca cobre o "onde foi parar".

          A `porSemana` saiu junto de `finance.ts`, com o teste dela. Deixar a
          função órfã seria criar código morto no mesmo commit que limpa a tela.
        */}
        <Card className="p-6">
          <h3 className="text-corpo-forte font-semibold text-ink">Comparação</h3>
          <p className="mt-0.5 mb-4 text-legenda capitalize text-ink-subtle">
            {rotuloDoPeriodoNaTela} vs. período anterior
          </p>
          <CompareRow
            label="Receitas"
            current={atual.incomeCents}
            previous={anterior.incomeCents}
            money={money}
          />
          <CompareRow
            label="Despesas"
            current={atual.expenseCents}
            previous={anterior.expenseCents}
            money={money}
          />
          <CompareRow
            label="Resultado"
            current={atual.balanceCents}
            previous={anterior.balanceCents}
            money={money}
          />
        </Card>

        <Card className="p-6">
          <h3 className="text-corpo-forte font-semibold text-ink">Etiquetas e estabelecimentos</h3>
          <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
            Os cortes que a categoria não dá.
          </p>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-corpo font-medium text-ink">Etiquetas</p>
              {porEtiqueta.length === 0 ? (
                <p className="text-legenda text-ink-subtle">
                  Nenhum lançamento etiquetado neste período.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {porEtiqueta.slice(0, 5).map((t, i) => (
                    <li key={t.tagId} className="flex items-center gap-2 text-corpo">
                      <span
                        aria-hidden
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full",
                          corDaPosicao(t.colorKey, i).fundo,
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">#{t.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {money(t.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {porEtiqueta.length > 0 && (
                /*
                  A ressalva que evita a pergunta "por que isto não fecha com as
                  despesas?": um lançamento pode ter várias etiquetas ou nenhuma.
                */
                <p className="mt-1.5 text-legenda text-ink-subtle">
                  Um lançamento pode ter mais de uma etiqueta — a soma daqui não fecha com o total
                  de despesas.
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-corpo font-medium text-ink">Estabelecimentos</p>
              {beneficiarios.length === 0 ? (
                <p className="text-legenda text-ink-subtle">
                  Nenhum lançamento com beneficiário preenchido.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {beneficiarios.map((b) => (
                    <li key={b.nome} className="flex items-center gap-2 text-corpo">
                      <span className="min-w-0 flex-1 truncate text-ink">{b.nome}</span>
                      <span className="shrink-0 text-legenda text-ink-subtle">
                        {plural(b.quantidade, "vez", "vezes")}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {money(b.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Doze meses de receita × despesa, com a linha do líquido por cima.
 *
 * ============================================================================
 * A LINHA É SVG SOBRE BARRAS DE `div` — e por que os dois sistemas coexistem
 * ============================================================================
 * Barra é retângulo: `div` com altura percentual resolve, e é o que o resto do
 * projeto já faz. Linha não é: ela precisa ligar pontos, e ligar pontos com
 * `div` exigiria calcular ângulo e comprimento de cada segmento em JavaScript.
 *
 * O `viewBox="0 0 100 100"` com `preserveAspectRatio="none"` faz o SVG esticar
 * exatamente sobre a área das barras, então os dois sistemas de coordenadas
 * coincidem sem nenhuma medição no cliente — nada de `getBoundingClientRect`,
 * nada de `useEffect` para reposicionar no redimensionamento.
 *
 * ============================================================================
 * O GRÁFICO É `aria-hidden`; O DADO ESTÁ NA LISTA
 * ============================================================================
 * Cada mês tem um `sr-only` com entrada, saída e resultado em texto. Um `<svg>`
 * com `aria-label` resumido diria "doze meses de receita e despesa" e esconderia
 * os doze valores — que é justamente o conteúdo.
 */
function HistoricoCard({
  historico,
  money,
}: {
  historico: { mes: string; incomeCents: number; expenseCents: number; balanceCents: number }[];
  money: Dinheiro;
}) {
  const teto = Math.max(
    1,
    ...historico.map((m) => Math.max(m.incomeCents, m.expenseCents)),
  );
  const saldos = historico.map((m) => m.balanceCents);
  const maiorSaldo = Math.max(1, ...saldos);
  const menorSaldo = Math.min(0, ...saldos);
  const amplitude = Math.max(1, maiorSaldo - menorSaldo);

  const pontos = historico
    .map((m, i) => {
      const x = ((i + 0.5) / historico.length) * 100;
      const y = 100 - ((m.balanceCents - menorSaldo) / amplitude) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const vazio = historico.every((m) => m.incomeCents === 0 && m.expenseCents === 0);

  return (
    <Card className="p-6">
      <h3 className="text-corpo-forte font-semibold text-ink">Últimos 12 meses</h3>
      <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
        Entradas × saídas, com a linha do resultado.
      </p>

      {vazio ? (
        <EmptyState icon="Wallet" title="Sem histórico ainda" />
      ) : (
        <>
          <div className="relative h-40">
            <ul className="flex h-full items-end gap-1" aria-hidden>
              {historico.map((m) => (
                <li key={m.mes} className="flex h-full flex-1 items-end justify-center gap-0.5">
                  <span
                    className="w-1/2 rounded-t-xs bg-success"
                    style={{ height: `${(m.incomeCents / teto) * 100}%` }}
                  />
                  <span
                    className="w-1/2 rounded-t-xs bg-danger"
                    style={{ height: `${(m.expenseCents / teto) * 100}%` }}
                  />
                </li>
              ))}
            </ul>
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polyline
                points={pontos}
                fill="none"
                className="stroke-ink"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <ul className="mt-1.5 flex gap-1">
            {historico.map((m) => (
              <li key={m.mes} className="flex-1 text-center text-micro text-ink-subtle">
                {mesCurto(m.mes)}
                <span className="sr-only">
                  {" "}
                  de {m.mes.slice(0, 4)}: entrou {money(m.incomeCents)}, saiu{" "}
                  {money(m.expenseCents)}, resultado {money(m.balanceCents)}.
                </span>
              </li>
            ))}
          </ul>

          {/* Legenda das duas cores. Elas são `success`/`danger`, que já
              significam "sobrou"/"faltou" no sistema inteiro — mas cor não anda
              sozinha, então os nomes vêm junto. */}
          <div className="mt-3 flex flex-wrap gap-4 text-legenda text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success" /> Entradas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-danger" /> Saídas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-ink" /> Resultado
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

