import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { faturaDoCartao, faturaDe, patrimonioEDivida, somaMeses, vencimentoDaFatura } from "@/lib/credit";
import type { FinanceSnapshot } from "@/lib/data";
import type { FinanceTransaction } from "@/lib/database.types";
import { monthTotals } from "@/lib/finance";
import { cn, formatBRL, monthLabel } from "@/lib/utils";

/**
 * O DINHEIRO NO INÍCIO — resumo, não um segundo módulo Financeiro.
 *
 * ============================================================================
 * ⚠️ SEM BIBLIOTECA DE GRÁFICO. NENHUMA.
 * ============================================================================
 * A decisão já estava escrita em `FinanceView.tsx` ("Barra em SVG/CSS puro —
 * evita ~100 KB de biblioteca de gráfico") e aqui ela pesa ainda mais: esta é a
 * PRIMEIRA tela que carrega. Trazer um pacote de gráfico para desenhar oito
 * retângulos custaria, no caminho crítico da abertura do aplicativo, mais bytes
 * do que todo o resto desta página junta. As barras abaixo são `<div>` com
 * altura ou largura em porcentagem — o navegador já sabe desenhar retângulo.
 *
 * ============================================================================
 * ESTE COMPONENTE É DE SERVIDOR, E ISSO É DE PROPÓSITO
 * ============================================================================
 * Não há nada para clicar aqui: nenhum estado, nenhum efeito, nenhum JavaScript
 * enviado ao navegador. O botão de olho que o módulo Financeiro tem NÃO é
 * repetido — ele existiria só para desfazer, em dois cliques, a preferência que
 * a pessoa já gravou em Configurações.
 *
 * ============================================================================
 * A PREFERÊNCIA `finance_hide_values` MANDA
 * ============================================================================
 * Com ela ligada, os NÚMEROS somem e as BARRAS ficam. É o contrato de "ocultar
 * valores": esconder o quanto, não esconder que existe. Uma tela inicial que
 * ignorasse a preferência tornaria a própria preferência decorativa — de que
 * adianta esconder o saldo no Financeiro se ele aparece por inteiro na tela que
 * abre primeiro, na frente de quem estiver do lado?
 */

/** Quantos meses o mini-histórico mostra, contando o mês corrente. */
const MESES_DO_HISTORICO = 6;

const MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short" });

/** "2026-08-01" -> "ago". Componentes numéricos, nunca `new Date(iso)` — o
 *  parser de "YYYY-MM-DD" é UTC e devolveria o mês anterior em São Paulo. */
function mesCurto(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  return MES_CURTO.format(new Date(ano!, (mes ?? 1) - 1, 1)).replace(".", "");
}

interface MesDoHistorico {
  mes: string;
  entradasCents: number;
  saidasCents: number;
}

export function ResumoFinanceiro({
  mes,
  hojeIso,
  snapshot,
  transacoesAnteriores,
  ocultarValores,
}: {
  /** Mês corrente em "YYYY-MM-01". */
  mes: string;
  /** Dia civil de hoje em "YYYY-MM-DD" — decide qual fatura está aberta. */
  hojeIso: string;
  snapshot: FinanceSnapshot;
  /**
   * Lançamentos dos meses ANTERIORES aos que o snapshot já traz, só para o
   * mini-histórico. Chegam separados porque `getFinanceSnapshot` cobre o mês
   * pedido e o anterior — ver a nota no `page.tsx` sobre o custo disto.
   */
  transacoesAnteriores: FinanceTransaction[];
  ocultarValores: boolean;
}) {
  const dinheiro = (cents: number) => formatBRL(cents, { hidden: ocultarValores });

  /*
    SEM CONTA NENHUMA, o resumo inteiro seria seis zeros e barras vazias — uma
    tela que parece quebrada e não diz o que fazer. O módulo está ligado (senão
    a página nem renderizaria isto), então a resposta certa é o convite, não o
    gráfico de nada.
  */
  if (snapshot.accounts.length === 0) {
    return (
      <section aria-labelledby="resumo-financeiro">
        <h2 id="resumo-financeiro" className="mb-3 text-lg font-semibold text-ink">
          Como o mês está
        </h2>
        <Card>
          <EmptyState
            icon="Wallet"
            title="Nenhuma conta cadastrada"
            description="Cadastre uma conta no Financeiro para ver saldo, entradas e saídas aqui."
            action={
              <Link
                href="/financeiro"
                className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-corpo font-medium text-ink hover:bg-surface-muted"
              >
                Abrir Financeiro
              </Link>
            }
          />
        </Card>
      </section>
    );
  }

  const { patrimonioCents, dividaCents } = patrimonioEDivida(snapshot.balances, snapshot.accounts);
  const liquidoCents = patrimonioCents - dividaCents;
  /*
    ⚠️ `snapshot.accounts` é obrigatório em `monthTotals` desde a correção de
    competência: para cartão, o mês de um lançamento é o da FATURA
    (`statement_month`), não o da compra. Sem a lista de contas não há como saber
    quais lançamentos são de cartão, e o resumo voltaria a contar a compra no mês
    em que ela aconteceu em vez do mês em que ela é paga.
  */
  const doMes = monthTotals(snapshot.transactions, mes, snapshot.accounts);

  /*
    A união das janelas, SEM REPETIÇÃO — e isto deixou de ser precaução.

    Cada `getFinanceSnapshot` cobre TRÊS meses (a janela cresceu para que o "a
    pagar este mês" do Painel não subestimasse faturas que fecham no mês
    anterior), e as três chamadas desta página estão a dois meses uma da outra:
    as janelas agora SE SOBREPÕEM. Sem este Map, os meses de interseção teriam
    cada lançamento contado duas vezes — despesa dobrada no gráfico, em silêncio.
  */
  const porId = new Map<string, FinanceTransaction>();
  for (const tx of [...transacoesAnteriores, ...snapshot.transactions]) porId.set(tx.id, tx);
  const todas = [...porId.values()];

  const historico: MesDoHistorico[] = Array.from({ length: MESES_DO_HISTORICO }, (_, i) => {
    const alvo = somaMeses(mes, i - (MESES_DO_HISTORICO - 1));
    const t = monthTotals(todas, alvo, snapshot.accounts);
    return { mes: alvo, entradasCents: t.incomeCents, saidasCents: t.expenseCents };
  });

  /*
    A FATURA ABERTA é a que ainda vai fechar, e quem decide isso é o dia do
    fechamento — não o calendário. `faturaDe(hoje, fechamento)` devolve a fatura
    em que uma compra feita HOJE cairia, que é exatamente a que está aberta.
    Usar o mês corrente aqui mostraria, entre o dia 1 e o fechamento, uma fatura
    que já foi cobrada.

    Cartão sem os dias configurados fica de fora: `faturaDe` levanta RangeError
    para dia inválido, e não há resposta honesta a dar sobre um cartão que não
    disse quando fecha.
  */
  const lancamentosDoCartao = [...snapshot.transactions, ...snapshot.futureCardTransactions];
  const faturas = snapshot.accounts
    .filter(
      (c) =>
        c.kind === "credit_card" &&
        c.statement_closing_day !== null &&
        c.payment_due_day !== null,
    )
    .map((c) => {
      const mesFatura = faturaDe(hojeIso, c.statement_closing_day!);
      const { openCents } = faturaDoCartao(
        lancamentosDoCartao,
        { id: c.id, statement_closing_day: c.statement_closing_day! },
        mesFatura,
      );
      return {
        id: c.id,
        nome: c.name,
        openCents,
        vence: vencimentoDaFatura(mesFatura, c.payment_due_day!, c.statement_closing_day!),
      };
    })
    // Fatura zerada não é notícia. Negativa é (crédito a favor), e por isso o
    // corte é por diferente de zero, não por maior que zero.
    .filter((f) => f.openCents !== 0);

  return (
    <section aria-labelledby="resumo-financeiro">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Dinheiro</p>
          <h2 id="resumo-financeiro" className="text-lg font-semibold text-ink">
            Como o mês está
          </h2>
        </div>
        <Link href="/financeiro" className="text-corpo text-ink-muted hover:text-ink">
          Ver tudo
        </Link>
      </div>

      <Card className="space-y-5 p-6">
        {/* Saldo consolidado. Os MESMOS três números do módulo Financeiro, com
            os mesmos nomes: dois nomes para o mesmo valor é como duas telas
            passam a discordar sobre quanto se tem. */}
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Numero rotulo="Patrimônio" valor={dinheiro(patrimonioCents)} />
          <Numero rotulo="Dívidas" valor={dinheiro(dividaCents)} alerta={dividaCents > 0} />
          <Numero rotulo="Líquido" valor={dinheiro(liquidoCents)} alerta={liquidoCents < 0} destaque />
        </dl>

        <BarrasDoMes
          entradasCents={doMes.incomeCents}
          saidasCents={doMes.expenseCents}
          dinheiro={dinheiro}
          mes={mes}
        />

        {faturas.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Fatura aberta</p>
            <ul className="space-y-1.5">
              {faturas.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                >
                  <span className="min-w-0 truncate text-corpo text-ink">{f.nome}</span>
                  <span className="text-corpo text-ink-muted">
                    {dinheiro(f.openCents)}
                    <span className="ml-2 text-legenda text-ink-subtle">
                      vence {f.vence.split("-").reverse().join("/")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Historico meses={historico} dinheiro={dinheiro} />
      </Card>
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  alerta = false,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  /**
   * Dívida existindo, ou líquido negativo. Vermelho é a cor de ERRO no projeto,
   * e é a leitura certa aqui — mas ele nunca vem sozinho: o rótulo continua
   * dizendo "Dívidas", e o sinal está no próprio número.
   */
  alerta?: boolean;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-surface-muted px-3 py-2.5",
        destaque ? "border-line-strong" : "border-line",
      )}
    >
      <dd className={cn("text-lg font-semibold", alerta ? "text-danger-ink" : "text-ink")}>
        {valor}
      </dd>
      <dt className="text-legenda text-ink-subtle">{rotulo}</dt>
    </div>
  );
}

/**
 * Entradas × saídas do mês, em duas barras proporcionais ENTRE SI.
 *
 * A referência é o MAIOR dos dois, não a soma nem um teto fixo: assim a barra
 * cheia é sempre o lado que pesou mais, e a diferença entre elas é lida na
 * hora — que é a única pergunta que este bloco responde ("gastei mais do que
 * entrou?").
 *
 * As duas barras se distinguem por PREENCHIMENTO, não por cor: entradas são
 * sólidas, saídas são contornadas. Num sistema monocromático, dois tons de
 * cinza a 40% de largura são a mesma barra para muita gente.
 */
function BarrasDoMes({
  entradasCents,
  saidasCents,
  dinheiro,
  mes,
}: {
  entradasCents: number;
  saidasCents: number;
  dinheiro: (c: number) => string;
  mes: string;
}) {
  const teto = Math.max(entradasCents, saidasCents);
  const largura = (v: number) => (teto === 0 ? 0 : (v / teto) * 100);
  const resultado = entradasCents - saidasCents;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="eyebrow">Entradas e saídas · {monthLabel(mes)}</p>
        <p className="text-legenda text-ink-subtle">
          resultado{" "}
          <span
            className={cn(
              "font-medium tabular-nums",
              resultado < 0 ? "text-danger-ink" : "text-success-ink",
            )}
          >
            {dinheiro(resultado)}
          </span>
        </p>
      </div>

      <div className="space-y-2">
        <LinhaDeBarra rotulo="Entradas" valor={dinheiro(entradasCents)} largura={largura(entradasCents)} />
        <LinhaDeBarra
          rotulo="Saídas"
          valor={dinheiro(saidasCents)}
          largura={largura(saidasCents)}
          contornada
        />
      </div>
    </div>
  );
}

function LinhaDeBarra({
  rotulo,
  valor,
  largura,
  contornada = false,
}: {
  rotulo: string;
  valor: string;
  largura: number;
  contornada?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-legenda text-ink-subtle">{rotulo}</span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn(
            "h-full rounded-full",
            contornada ? "border border-line-strong bg-surface" : "bg-accent",
          )}
          // Largura mínima visível quando há valor: uma barra de 0,4% é
          // indistinguível de "não há barra", e as duas coisas significam
          // exatamente o contrário uma da outra.
          style={{ width: largura > 0 ? `${Math.max(2, largura)}%` : 0 }}
        />
      </div>
      <span className="shrink-0 text-legenda tabular-nums text-ink-muted">{valor}</span>
    </div>
  );
}

/**
 * Seis meses em colunas. Cada mês tem duas barras (entradas, saídas) com a
 * mesma gramática do bloco de cima — sólida entra, contornada sai.
 *
 * A ALTURA É COMPARÁVEL ENTRE OS MESES porque o teto é global: normalizar cada
 * coluna pelo próprio máximo faria todos os meses parecerem iguais, que é
 * justamente o contrário do que um histórico serve para mostrar.
 *
 * ACESSIBILIDADE: as barras são `aria-hidden` e cada coluna é um item de lista
 * com um `title`/`sr-only` escrito por extenso. Um gráfico sem texto é um
 * gráfico que não existe para quem usa leitor de tela — e aqui o texto sai da
 * MESMA função `dinheiro`, então "ocultar valores" também vale para ele.
 */
function Historico({
  meses,
  dinheiro,
}: {
  meses: MesDoHistorico[];
  dinheiro: (c: number) => string;
}) {
  const teto = Math.max(1, ...meses.flatMap((m) => [m.entradasCents, m.saidasCents]));
  const altura = (v: number) => (v === 0 ? 0 : Math.max(4, (v / teto) * 100));

  return (
    <div>
      <p className="eyebrow mb-2">Últimos {meses.length} meses</p>
      <ul className="flex items-end justify-between gap-1.5 sm:gap-3">
        {meses.map((m) => {
          const descricao = `${monthLabel(m.mes)}: entradas ${dinheiro(m.entradasCents)}, saídas ${dinheiro(m.saidasCents)}`;
          return (
            <li key={m.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={descricao}>
              <div aria-hidden className="flex h-16 w-full items-end justify-center gap-0.5 sm:gap-1">
                <span
                  className="w-2 rounded-t-sm bg-accent sm:w-2.5"
                  style={{ height: `${altura(m.entradasCents)}%` }}
                />
                <span
                  className="w-2 rounded-t-sm border border-line-strong bg-surface sm:w-2.5"
                  style={{ height: `${altura(m.saidasCents)}%` }}
                />
              </div>
              <span className="text-meta capitalize text-ink-subtle">{mesCurto(m.mes)}</span>
              <span className="sr-only">{descricao}</span>
            </li>
          );
        })}
      </ul>

      {/* A legenda é obrigatória: sem ela, "sólida" e "contornada" são duas
          formas sem significado declarado em lugar nenhum da tela. */}
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-accent" /> entradas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-sm border border-line-strong bg-surface" /> saídas
        </span>
      </p>
    </div>
  );
}
