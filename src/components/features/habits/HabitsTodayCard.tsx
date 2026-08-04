"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { toggleHabitDay } from "@/app/(app)/habitos/actions";
import type { Habit, HabitEntry, HabitPause } from "@/lib/database.types";
import { resumirHabitos, somarDias, type Habito } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * MARCAÇÃO RÁPIDA NO INÍCIO.
 *
 * ⚠️ É este cartão que faz o módulo virar rotina. Um hábito diário que exige
 * navegar para outra página é um hábito que se esquece — e o Início é a tela
 * que abre primeiro.
 *
 * Mostra só o CHECKLIST de hoje: sem mapa de calor, sem taxa, sem melhor
 * sequência. O painel completo mora em `/habitos`. Um resumo que repete a tela
 * inteira não é resumo, é uma segunda tela para manter em dia.
 *
 * Os números saem de `resumirHabitos` — o mesmo módulo puro que a tela de
 * Hábitos e o e-mail semanal usam.
 */
export function HabitsTodayCard({
  habitos,
  marcacoes,
  pausas,
  hoje,
}: {
  habitos: Habit[];
  marcacoes: HabitEntry[];
  pausas: HabitPause[];
  hoje: string;
}) {
  const { toast } = useToast();
  const [, iniciar] = useTransition();
  const [otimista, setOtimista] = useState<Map<string, boolean>>(new Map());

  const feitosPorHabito = useMemo(() => {
    const mapa = new Map<string, Set<string>>();
    for (const m of marcacoes) {
      const conjunto = mapa.get(m.habit_id) ?? new Set<string>();
      conjunto.add(m.done_on);
      mapa.set(m.habit_id, conjunto);
    }
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

  const resumo = useMemo(() => {
    const regras: Habito[] = habitos.map((h) => ({
      id: h.id,
      name: h.name,
      schedule_kind: h.schedule_kind,
      weekdays: h.weekdays,
      weekly_target: h.weekly_target,
      started_on: h.started_on,
      archived_at: h.archived_at,
    }));
    const pausasPuras = pausas.map((p) => ({
      habit_id: p.habit_id,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
    }));
    return resumirHabitos(regras, feitosPorHabito, somarDias(hoje, -29), hoje, hoje, pausasPuras);
  }, [habitos, feitosPorHabito, pausas, hoje]);

  // Só os que são esperados HOJE. Listar os outros encheria o cartão com o que
  // não cabe fazer agora, que é o oposto do que uma tela de "hoje" serve.
  const deHoje = resumo.porHabito.filter((r) => r.hojeFeito !== null);

  function marcar(habitId: string, feito: boolean) {
    const chave = `${habitId}|${hoje}`;
    setOtimista((m) => new Map(m).set(chave, feito));
    iniciar(async () => {
      const r = await toggleHabitDay({ habitId, dia: hoje });
      if (!r.ok) {
        setOtimista((m) => {
          const copia = new Map(m);
          copia.delete(chave);
          return copia;
        });
        toast(r.error ?? "Não foi possível marcar", "error");
      }
    });
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">Hábitos de hoje</p>
        <Link href="/habitos" className="text-corpo text-ink-muted hover:text-ink">
          Ver tudo
        </Link>
      </div>

      {habitos.length === 0 ? (
        <p className="py-2 text-corpo text-ink-subtle">
          Nenhum hábito ainda.{" "}
          <Link href="/habitos" className="text-ink hover:underline">
            Criar o primeiro
          </Link>
          .
        </p>
      ) : deHoje.length === 0 ? (
        // Distingue "não tem hábito" de "hoje não era dia" — um hábito de
        // segunda/quarta/sexta não falhou no domingo.
        <p className="py-2 text-corpo text-ink-subtle">Nenhum hábito esperado hoje.</p>
      ) : (
        <>
          <p className="mb-2 text-legenda text-ink-subtle">
            {resumo.hojeFeitos} de {resumo.hojeEsperados} cumpridos
          </p>
          <ul className="space-y-1">
            {deHoje.map((r) => (
              <li key={r.habito.id}>
                <button
                  type="button"
                  aria-pressed={r.hojeFeito ?? false}
                  onClick={() => marcar(r.habito.id, !r.hojeFeito)}
                  className="flex w-full items-center gap-2.5 rounded-sm py-1 text-left focus-visible:outline-2"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      r.hojeFeito
                        ? "border-transparent bg-accent text-accent-ink"
                        : "border-line-strong text-transparent",
                    )}
                  >
                    <Icon.Check width={13} height={13} />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      r.hojeFeito ? "text-ink-subtle line-through" : "text-ink",
                    )}
                  >
                    {r.habito.name}
                  </span>
                  {r.sequenciaAtual > 0 && (
                    <span className="shrink-0 text-legenda text-ink-subtle">
                      {r.sequenciaAtual}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
