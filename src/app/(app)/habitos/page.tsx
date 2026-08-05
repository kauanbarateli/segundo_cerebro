import { PageHeader } from "@/components/layout/PageHeader";
import { HabitsView } from "@/components/features/habits/HabitsView";
import { getHabitEntries, getHabitPauses, getHabits } from "@/lib/data";
import { requireModule } from "@/lib/guards";
import { dayRangeInTimeZone } from "@/lib/utils";
import { somarDias } from "@/lib/habits";

/**
 * Módulo Hábitos.
 *
 * ⚠️ `requireModule` na PRIMEIRA linha. Esconder o link da barra lateral não é
 * controle de acesso — esta rota responde a quem digitar o endereço com o
 * módulo desligado, se o guard sair daqui.
 */

/**
 * A janela carregada — e a ÚNICA janela da tela.
 *
 * Noventa dias é o que o mapa de calor mostra, é o teto do que a melhor
 * sequência enxerga e, desde a reforma da apresentação, é também o período da
 * taxa e das falhas. Antes o painel resumia 30 dias e desenhava 90: dois
 * recortes de tempo lado a lado, sem nada avisando, e "4 falhas" não era o que
 * o quadriculado logo abaixo mostrava.
 *
 * Carregar o histórico inteiro cresceria sem limite para um número que quase
 * nunca vem do começo; noventa dias de cinco hábitos são no máximo 450 linhas,
 * porque o registro é esparso.
 *
 * ⚠️ Mudar este número muda o que a tela AFIRMA, não só o que ela desenha. O
 * rodapé de `HabitsView` declara a janela por escrito justamente para que o
 * leitor não precise adivinhar qual é.
 */
const DIAS_DA_JANELA = 90;

export default async function HabitosPage() {
  const ctx = await requireModule("habitos");

  /*
    ⚠️ O DIA VEM DE `dayRangeInTimeZone`, E NÃO DE `new Date()`.

    O servidor da Vercel roda em UTC. `new Date().toISOString().slice(0,10)`
    daria o dia SEGUINTE das 21h à meia-noite em São Paulo — e o checklist de
    hoje mostraria o de amanhã, com tudo desmarcado. É a mesma classe de defeito
    que aquela função foi escrita para resolver.
  */
  const { dayKey: hoje } = dayRangeInTimeZone(new Date(), "America/Sao_Paulo");
  const inicioDaJanela = somarDias(hoje, -(DIAS_DA_JANELA - 1));

  const [habitos, marcacoes, pausas] = await Promise.all([
    getHabits(),
    getHabitEntries(inicioDaJanela),
    getHabitPauses(inicioDaJanela),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Rotina"
        title="O que você faz todo dia."
        subtitle="Marque o que cumpriu — é o único registro que existe. A falha sai da regra."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <HabitsView
        habitos={habitos}
        marcacoes={marcacoes}
        pausas={pausas}
        hoje={hoje}
        inicioDaJanela={inicioDaJanela}
        diasDaJanela={DIAS_DA_JANELA}
      />
    </>
  );
}
