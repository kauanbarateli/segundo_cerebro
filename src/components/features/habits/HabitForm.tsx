"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { PillButton } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import {
  DIAS_INICIAL,
  DIAS_LONGOS,
  listarDiasFixos,
} from "@/components/features/habits/Leitura";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import { createHabit, updateHabit } from "@/app/(app)/habitos/actions";
import type { Habit, HabitScheduleKind } from "@/lib/database.types";
import { cn } from "@/lib/utils";

/**
 * O formulário da REGRA — porque é isso que um hábito é neste módulo.
 *
 * ⚠️ OS DIAS APARECEM COM SEGUNDA NA FRENTE, e não com domingo, ainda que o
 * VALOR guardado continue sendo 0=domingo..6=sábado (a numeração do banco e de
 * `extract(dow)`). A ordem visual acompanha `segundaDaSemana`, que é a semana
 * que toda a aritmética do módulo usa e a que o mapa de calor desenha. Um
 * seletor que começa no domingo e um gráfico que começa na segunda obrigariam a
 * pessoa a traduzir de cabeça toda vez que comparasse os dois.
 */

/** Ordem de exibição: segunda … domingo. O `valor` é a numeração do banco. */
const DIAS_EM_ORDEM = [1, 2, 3, 4, 5, 6, 0];

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

  const semDia = scheduleKind === "weekdays" && weekdays.length === 0;

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
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-corpo font-medium text-ink">Frequência</legend>
        <div className="flex flex-wrap gap-2">
          {CADENCIAS.map((c) => (
            <PillButton
              key={c.valor}
              className="h-11"
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
            {DIAS_EM_ORDEM.map((valor) => {
              const ativo = weekdays.includes(valor);
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  aria-label={DIAS_LONGOS[valor]}
                  onClick={() =>
                    setWeekdays((atual) =>
                      ativo ? atual.filter((x) => x !== valor) : [...atual, valor].sort(),
                    )
                  }
                  className={cn(
                    // 44px: um seletor de dia é tocado com o polegar, e errar o
                    // dia aqui distorce todo o histórico do hábito.
                    "h-11 w-11 rounded-full border text-corpo font-medium transition-colors",
                    ativo
                      ? "border-transparent bg-accent text-accent-ink"
                      : "border-line-strong text-ink-muted hover:bg-surface-muted",
                  )}
                >
                  {DIAS_INICIAL[valor]}
                </button>
              );
            })}
          </div>
          {semDia && (
            <p className="mt-1.5 text-legenda text-danger-ink">
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
            aria-describedby="habito-alvo-ajuda"
            onChange={(e) => setWeeklyTarget(Number(e.target.value))}
            className={cn(CLASSE_DO_CAMPO, "w-24")}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          {/* A semana fecha no domingo, e isso é invisível na tela sem esta
              frase — é a diferença entre "ainda dá tempo" e "perdi a semana". */}
          <p id="habito-alvo-ajuda" className="mt-1.5 text-legenda text-ink-subtle">
            A semana vai de segunda a domingo. A conta fecha no domingo à noite.
          </p>
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
          aria-describedby="habito-inicio-ajuda"
          onChange={(e) => setStartedOn(e.target.value)}
          required
          className={CLASSE_DO_CAMPO}
        />
        <p id="habito-inicio-ajuda" className="mt-1.5 text-legenda text-ink-subtle">
          Antes desta data nada é cobrado. É o que impede o painel de contar falha desde sempre.
        </p>
      </div>

      {/*
        A REGRA EM UMA FRASE, montada com o que já foi escolhido.
        Três controles separados (frequência, dias, data) não somam sozinhos na
        cabeça de ninguém — e o erro típico é criar "dias fixos" achando que
        escolheu "3× por semana", descobrir semanas depois pelo painel, e não
        entender de onde vieram as falhas.
      */}
      <p
        aria-live="polite"
        className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-legenda text-ink-muted"
      >
        {scheduleKind === "daily" && "Esperado todo dia."}
        {scheduleKind === "weekdays" &&
          (semDia ? "Escolha os dias acima." : `Esperado ${listarDiasFixos(weekdays)}.`)}
        {scheduleKind === "weekly_target" &&
          `Esperado ${weeklyTarget}× por semana, em qualquer dia. A semana fecha no domingo.`}
      </p>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="md" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={enviando || name.trim().length === 0 || semDia}
        >
          {enviando ? "Salvando…" : habito ? "Salvar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
