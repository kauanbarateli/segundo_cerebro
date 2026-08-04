"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { PillButton } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { createHabit, updateHabit } from "@/app/(app)/habitos/actions";
import type { Habit, HabitScheduleKind } from "@/lib/database.types";
import { cn } from "@/lib/utils";

/** 0=domingo..6=sábado — a mesma numeração do banco e de `extract(dow)`. */
const DIAS = [
  { valor: 0, curto: "D" },
  { valor: 1, curto: "S" },
  { valor: 2, curto: "T" },
  { valor: 3, curto: "Q" },
  { valor: 4, curto: "Q" },
  { valor: 5, curto: "S" },
  { valor: 6, curto: "S" },
];

const DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const CADENCIAS: { valor: HabitScheduleKind; rotulo: string; ajuda: string }[] = [
  { valor: "daily", rotulo: "Todo dia", ajuda: "Esperado todos os dias." },
  { valor: "weekdays", rotulo: "Dias fixos", ajuda: "Esperado só nos dias escolhidos." },
  {
    valor: "weekly_target",
    rotulo: "N× por semana",
    // A frase explica por que esta cadência não é redundante com "dias fixos".
    ajuda: "Sem escolher os dias. Falha só no domingo à noite, se não somar o alvo.",
  },
];

export function HabitForm({
  habito,
  hoje,
  onDone,
  onCancel,
}: {
  habito?: Habit;
  /** "AAAA-MM-DD" calculado no servidor, no fuso do aplicativo. */
  hoje: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const [enviando, iniciar] = useTransition();

  const [name, setName] = useState(habito?.name ?? "");
  const [scheduleKind, setScheduleKind] = useState<HabitScheduleKind>(
    habito?.schedule_kind ?? "daily",
  );
  const [weekdays, setWeekdays] = useState<number[]>(habito?.weekdays ?? []);
  const [weeklyTarget, setWeeklyTarget] = useState<number>(habito?.weekly_target ?? 3);
  /*
    A data de início é EDITÁVEL, e importa: ela é o que impede "quantas vezes
    falhei" de contar desde o começo dos tempos. Um hábito criado hoje que a
    pessoa já cumpre há um mês pode começar retroativamente.
  */
  const [startedOn, setStartedOn] = useState(habito?.started_on ?? hoje);

  function enviar() {
    iniciar(async () => {
      const payload = {
        name,
        colorKey: habito?.color_key ?? "stone",
        scheduleKind,
        weekdays,
        weeklyTarget,
        startedOn,
      };
      const r = habito ? await updateHabit(habito.id, payload) : await createHabit(payload);
      if (r.ok) {
        toast(habito ? "Hábito salvo" : "Hábito criado", "success");
        onDone();
      } else {
        toast(r.error ?? "Erro", "error");
      }
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <div>
        <label htmlFor="habito-nome" className="mb-1.5 block text-corpo font-medium text-ink">
          Nome
        </label>
        <input
          id="habito-nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          autoFocus
          placeholder="Ler 20 páginas"
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-corpo font-medium text-ink">Frequência</legend>
        <div className="flex flex-wrap gap-2">
          {CADENCIAS.map((c) => (
            <PillButton
              key={c.valor}
              active={scheduleKind === c.valor}
              onClick={() => setScheduleKind(c.valor)}
            >
              {c.rotulo}
            </PillButton>
          ))}
        </div>
        <p className="mt-1.5 text-legenda text-ink-subtle">
          {CADENCIAS.find((c) => c.valor === scheduleKind)?.ajuda}
        </p>
      </fieldset>

      {scheduleKind === "weekdays" && (
        <fieldset>
          <legend className="mb-1.5 text-corpo font-medium text-ink">Dias</legend>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((d) => {
              const ativo = weekdays.includes(d.valor);
              return (
                <button
                  key={d.valor}
                  type="button"
                  aria-pressed={ativo}
                  aria-label={DIAS_LONGOS[d.valor]}
                  onClick={() =>
                    setWeekdays((atual) =>
                      ativo ? atual.filter((x) => x !== d.valor) : [...atual, d.valor].sort(),
                    )
                  }
                  className={cn(
                    "h-9 w-9 rounded-full border text-corpo font-medium transition-colors",
                    ativo
                      ? "border-transparent bg-accent text-accent-ink"
                      : "border-line-strong text-ink-muted hover:bg-surface-muted",
                  )}
                >
                  {d.curto}
                </button>
              );
            })}
          </div>
          {weekdays.length === 0 && (
            <p className="mt-1.5 text-legenda text-red-600 dark:text-red-400">
              Escolha pelo menos um dia.
            </p>
          )}
        </fieldset>
      )}

      {scheduleKind === "weekly_target" && (
        <div>
          <label htmlFor="habito-alvo" className="mb-1.5 block text-corpo font-medium text-ink">
            Quantas vezes por semana
          </label>
          <select
            id="habito-alvo"
            value={weeklyTarget}
            onChange={(e) => setWeeklyTarget(Number(e.target.value))}
            className="h-10 w-24 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="habito-inicio" className="mb-1.5 block text-corpo font-medium text-ink">
          Vale desde
        </label>
        <input
          id="habito-inicio"
          type="date"
          value={startedOn}
          max={hoje}
          onChange={(e) => setStartedOn(e.target.value)}
          required
          className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
        />
        <p className="mt-1.5 text-legenda text-ink-subtle">
          Antes desta data nada é cobrado. É o que impede o painel de contar falha desde sempre.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={
            enviando ||
            name.trim().length === 0 ||
            (scheduleKind === "weekdays" && weekdays.length === 0)
          }
        >
          {enviando ? "Salvando…" : habito ? "Salvar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
