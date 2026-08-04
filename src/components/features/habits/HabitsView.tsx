"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MapaDeCalor } from "@/components/features/habits/MapaDeCalor";
import { HabitForm } from "@/components/features/habits/HabitForm";
import { archiveHabit, toggleHabitDay } from "@/app/(app)/habitos/actions";
import type { Habit, HabitEntry, HabitPause } from "@/lib/database.types";
import { celulasDoPeriodo, resumirHabitos, somarDias, type Habito } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * A tela de Hábitos: checklist de hoje, painel e mapa de calor.
 *
 * ⚠️ NENHUM NÚMERO DESTA TELA VEM DO BANCO PRONTO. Sequência, taxa e falhas são
 * derivadas por `src/lib/habits.ts`, o mesmo módulo que a rota do e-mail
 * semanal consome. Duas implementações da mesma conta é como um dia a tela diz
 * 18, o e-mail diz 19, e ninguém sabe qual está certo.
 */

/** O que o painel resume. Trinta dias é o recorte que a pessoa lembra. */
const DIAS_DO_PAINEL = 30;

const CADENCIA_POR_EXTENSO: Record<string, string> = {
  daily: "Todo dia",
  weekdays: "Dias fixos",
  weekly_target: "Por semana",
};

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function descreverCadencia(h: Habit): string {
  if (h.schedule_kind === "daily") return "Todo dia";
  if (h.schedule_kind === "weekly_target") return `${h.weekly_target}× por semana`;
  return h.weekdays.map((d) => DIAS_CURTOS[d]).join(", ");
}

export function HabitsView({
  habitos,
  marcacoes,
  pausas,
  hoje,
  inicioDaJanela,
  diasDaJanela,
}: {
  habitos: Habit[];
  marcacoes: HabitEntry[];
  pausas: HabitPause[];
  /** "AAAA-MM-DD" no fuso do aplicativo — calculado no servidor. */
  hoje: string;
  inicioDaJanela: string;
  diasDaJanela: number;
}) {
  const { toast } = useToast();
  const [, iniciar] = useTransition();
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Habit | null>(null);
  const [arquivando, setArquivando] = useState<Habit | null>(null);

  /*
    OTIMISMO LOCAL. Marcar um hábito precisa responder no toque: esperar a ida
    ao servidor faria o gesto mais frequente do módulo parecer travado. O Set
    guarda as chaves `habitId:dia` que divergem do servidor até a revalidação
    chegar.
  */
  const [otimista, setOtimista] = useState<Map<string, boolean>>(new Map());

  const feitosPorHabito = useMemo(() => {
    const mapa = new Map<string, Set<string>>();
    for (const m of marcacoes) {
      const conjunto = mapa.get(m.habit_id) ?? new Set<string>();
      conjunto.add(m.done_on);
      mapa.set(m.habit_id, conjunto);
    }
    // Aplica o otimismo POR CIMA do que veio do servidor.
    for (const [chave, feito] of otimista) {
      const [habitId, dia] = chave.split("|");
      if (!habitId || !dia) continue;
      const conjunto = mapa.get(habitId) ?? new Set<string>();
      if (feito) conjunto.add(dia);
      else conjunto.delete(dia);
      mapa.set(habitId, conjunto);
    }
    return mapa;
  }, [marcacoes, otimista]);

  const regras: Habito[] = useMemo(
    () =>
      habitos.map((h) => ({
        id: h.id,
        name: h.name,
        schedule_kind: h.schedule_kind,
        weekdays: h.weekdays,
        weekly_target: h.weekly_target,
        started_on: h.started_on,
        archived_at: h.archived_at,
      })),
    [habitos],
  );

  const pausasPuras = useMemo(
    () =>
      pausas.map((p) => ({
        habit_id: p.habit_id,
        starts_on: p.starts_on,
        ends_on: p.ends_on,
      })),
    [pausas],
  );

  const resumo = useMemo(
    () =>
      resumirHabitos(
        regras,
        feitosPorHabito,
        somarDias(hoje, -(DIAS_DO_PAINEL - 1)),
        hoje,
        hoje,
        pausasPuras,
      ),
    [regras, feitosPorHabito, hoje, pausasPuras],
  );

  const porId = useMemo(() => new Map(habitos.map((h) => [h.id, h])), [habitos]);

  function marcar(habitId: string, dia: string, novoValor: boolean) {
    const chave = `${habitId}|${dia}`;
    setOtimista((m) => new Map(m).set(chave, novoValor));

    iniciar(async () => {
      const r = await toggleHabitDay({ habitId, dia });
      if (!r.ok) {
        // Reverte. Sem isto, a tela mostraria marcado o que o servidor recusou.
        setOtimista((m) => {
          const copia = new Map(m);
          copia.delete(chave);
          return copia;
        });
        toast(r.error ?? "Não foi possível marcar", "error");
      }
    });
  }

  if (habitos.length === 0) {
    return (
      <>
        <EmptyState
          icon="Repeat"
          title="Nenhum hábito ainda"
          description="Um hábito é uma regra: o que fazer e com que frequência. A falha é calculada a partir dela — você só marca o que cumpriu."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditando(null);
                setFormAberto(true);
              }}
            >
              Criar o primeiro
            </Button>
          }
        />
        {formAberto && (
          <Modal title="Novo hábito" onClose={() => setFormAberto(false)}>
            <HabitForm hoje={hoje} onDone={() => setFormAberto(false)} />
          </Modal>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ painel do período */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Hoje"
          valor={`${resumo.hojeFeitos} de ${resumo.hojeEsperados}`}
          detalhe={resumo.hojeEsperados === 0 ? "nada esperado hoje" : "cumpridos"}
        />
        <Indicador
          rotulo={`Taxa (${DIAS_DO_PAINEL} dias)`}
          // `null` não é 0%: 0% afirmaria fracasso onde não houve oportunidade.
          valor={resumo.taxa === null ? "—" : `${resumo.taxa}%`}
          detalhe={`${resumo.cumpridos} de ${resumo.esperados}`}
        />
        <Indicador
          rotulo="Falhas"
          valor={String(resumo.falhas)}
          detalhe={`nos últimos ${DIAS_DO_PAINEL} dias`}
        />
        <Indicador
          rotulo="Melhor sequência"
          valor={String(Math.max(0, ...resumo.porHabito.map((r) => r.melhorSequencia)))}
          detalhe="entre todos os hábitos"
        />
      </div>

      {/* ------------------------------------------------ checklist de hoje */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-corpo-forte font-medium text-ink">Hoje</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditando(null);
              setFormAberto(true);
            }}
          >
            <Icon.Capture width={15} height={15} /> Novo hábito
          </Button>
        </div>

        <ul className="divide-y divide-line">
          {resumo.porHabito.map((r) => {
            const habito = porId.get(r.habito.id);
            if (!habito) return null;
            const celulas = celulasDoPeriodo(
              r.habito,
              feitosPorHabito.get(r.habito.id) ?? new Set(),
              hoje,
              diasDaJanela,
              pausasPuras,
            );

            return (
              <li key={r.habito.id} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  {/*
                    `hojeFeito === null` significa "não era para fazer hoje" —
                    diferente de "não fiz". O botão fica desabilitado e explica,
                    em vez de sumir: sumir faria a lista mudar de tamanho todo
                    dia e a pessoa procuraria o hábito que "desapareceu".
                  */}
                  <button
                    type="button"
                    disabled={r.hojeFeito === null}
                    aria-label={
                      r.hojeFeito === null
                        ? `${habito.name}: não é esperado hoje`
                        : r.hojeFeito
                          ? `Desmarcar ${habito.name}`
                          : `Marcar ${habito.name}`
                    }
                    aria-pressed={r.hojeFeito ?? false}
                    title={r.hojeFeito === null ? "Não é esperado hoje" : undefined}
                    onClick={() => marcar(r.habito.id, hoje, !r.hojeFeito)}
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                      r.hojeFeito === null
                        ? "cursor-not-allowed border-dashed border-line text-transparent"
                        : r.hojeFeito
                          ? "border-transparent bg-accent text-accent-ink"
                          : "border-line-strong text-transparent hover:border-ink",
                    )}
                  >
                    <Icon.Check width={14} height={14} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          r.hojeFeito ? "text-ink-subtle line-through" : "text-ink",
                        )}
                      >
                        {habito.name}
                      </p>
                      <Badge tone="outline">{descreverCadencia(habito)}</Badge>
                      {r.sequenciaAtual > 0 && (
                        <Badge tone="solid">
                          {r.sequenciaAtual}
                          {habito.schedule_kind === "weekly_target" ? " sem." : " dias"}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-ink-subtle">
                      <span>{r.taxa === null ? "sem histórico" : `${r.taxa}% no período`}</span>
                      {r.falhas > 0 && <span>{r.falhas} falhas</span>}
                      {r.melhorSequencia > r.sequenciaAtual && (
                        <span>melhor: {r.melhorSequencia}</span>
                      )}
                    </div>

                    <div className="mt-2.5">
                      <MapaDeCalor celulas={celulas} />
                    </div>
                  </div>

                  <DropdownMenu
                    label={`Ações de ${habito.name}`}
                    items={[
                      {
                        label: "Editar",
                        onClick: () => {
                          setEditando(habito);
                          setFormAberto(true);
                        },
                      },
                      { label: "Arquivar", onClick: () => setArquivando(habito) },
                    ]}
                  >
                    <Icon.Dots width={16} height={16} />
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="text-legenda text-ink-subtle">
        A janela carregada é de {diasDaJanela} dias (desde {inicioDaJanela}). Sequência, taxa e
        falhas são calculadas a partir da regra de cada hábito — não existe registro de “falhou”.
      </p>

      {formAberto && (
        <Modal
          title={editando ? "Editar hábito" : "Novo hábito"}
          onClose={() => setFormAberto(false)}
        >
          <HabitForm
            hoje={hoje}
            habito={editando ?? undefined}
            onDone={() => setFormAberto(false)}
            onCancel={() => setFormAberto(false)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={arquivando !== null}
        title="Arquivar hábito"
        description={`"${arquivando?.name ?? ""}" sai da tela e para de contar. O histórico continua guardado.`}
        confirmLabel="Arquivar"
        onCancel={() => setArquivando(null)}
        onConfirm={() => {
          const alvo = arquivando;
          setArquivando(null);
          if (!alvo) return;
          iniciar(async () => {
            const r = await archiveHabit(alvo.id);
            toast(r.ok ? "Arquivado" : (r.error ?? "Erro"), r.ok ? "success" : "error");
          });
        }}
      />
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <Card className="p-4">
      <p className="eyebrow">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{valor}</p>
      <p className="mt-0.5 text-legenda text-ink-subtle">{detalhe}</p>
    </Card>
  );
}

export { CADENCIA_POR_EXTENSO };
