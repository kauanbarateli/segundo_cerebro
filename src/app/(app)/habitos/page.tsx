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
 * A janela carregada.
 *
 * Noventa dias é o que o mapa de calor mostra, e é também o teto do que a
 * melhor sequência enxerga. Carregar o histórico inteiro cresceria sem limite
 * para um número que quase nunca vem do começo; noventa dias de cinco hábitos
 * são no máximo 450 linhas, porque o registro é esparso.
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
        subtitle="Marque o que cumpriu. A falha é calculada, não anotada."
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
