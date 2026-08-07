"use client";

import { Card } from "@/components/ui/Card";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icons";
import { MapaDeCalor } from "@/components/features/habits/MapaDeCalor";
import {
  MedidorSemanal,
  descreverCadencia,
  unidadeDaSequencia,
} from "@/components/features/habits/Leitura";
import type { Habit } from "@/lib/database.types";
import type { CelulaDoCalendario, ResumoDeHabito } from "@/lib/habits";

/**
 * O CARTÃO DE HISTÓRICO DE UM HÁBITO — onde o mapa de calor é o herói.
 *
 * ⚠️ ESTE CARTÃO NÃO MARCA NADA, e a separação é a decisão de projeto da tela.
 *
 * A marcação do dia mora toda no cartão "Hoje", no topo de `HabitsView`: cinco
 * hábitos são cinco toques em UM bloco, ao alcance do polegar. Espalhar o
 * checkbox por cinco cartões de histórico transformaria o gesto mais frequente
 * do módulo numa rolagem de três telas — e um hábito que exige rolagem é um
 * hábito que se esquece.
 *
 * O nome do hábito aparece nos dois lugares de propósito. Não é repetição
 * ociosa: em cima ele é o RÓTULO DE UM BOTÃO ("marcar isto agora"), aqui ele é
 * o TÍTULO DE UM REGISTRO ("o que aconteceu nos últimos 90 dias"). São duas
 * perguntas diferentes, feitas em momentos diferentes do dia.
 *
 * HIERARQUIA DENTRO DO CARTÃO, de cima para baixo:
 *
 *   1. a SEQUÊNCIA, no maior corpo tipográfico da tela. É o número que a pessoa
 *      procura antes de qualquer outro.
 *   2. o MAPA, que é o elemento com maior densidade de informação do módulo.
 *   3. a linha de taxa e falhas, que resume por escrito o que o mapa mostra.
 *
 * ⚠️ A sequência é `font-light`, e isso é escolha, não descuido. Num sistema
 * monocromático o tamanho já basta para dominar: os 36px do `text-4xl` ao lado
 * dos 12px da unidade não precisam de peso. Um número enorme em semibold GRITA,
 * e este módulo mede rotina, não desempenho — a decisão de "não celebrar demais"
 * começa aqui.
 */
export function HabitoCard({
  habito,
  resumo,
  celulas,
  hoje,
  feitosNaSemana,
  onEditar,
  onArquivar,
}: {
  habito: Habit;
  resumo: ResumoDeHabito;
  celulas: CelulaDoCalendario[];
  /** "AAAA-MM-DD" no fuso do aplicativo — calculado no servidor. */
  hoje: string;
  /** Marcações da semana corrente. Só usado em `weekly_target`. */
  feitosNaSemana: number;
  onEditar: () => void;
  onArquivar: () => void;
}) {
  const semanal = habito.schedule_kind === "weekly_target";
  const alvo = habito.weekly_target ?? 1;
  const sequencia = resumo.sequenciaAtual;

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-corpo-forte font-medium text-ink">{habito.name}</h3>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-legenda text-ink-subtle">
            <span>{descreverCadencia(habito)}</span>
            {semanal && (
              <>
                <span aria-hidden>·</span>
                <MedidorSemanal feitos={feitosNaSemana} alvo={alvo} />
                <span>
                  {feitosNaSemana} de {alvo} esta semana
                  {feitosNaSemana >= alvo && " · alvo batido"}
                </span>
              </>
            )}
          </p>
        </div>

        {/*
          `h-11 w-11` sobrescreve o `h-8 w-8` do gatilho padrão: 44px é o piso de
          alvo de toque, e um menu de 32px num telefone é acertado por sorte.
          Funciona porque `cn` só concatena e o Tailwind emite `h-11` depois de
          `h-8` na folha. As margens negativas devolvem o alinhamento óptico com
          o título, que o alvo maior tinha empurrado.
        */}
        <DropdownMenu
          className="-mr-2 -mt-2 h-11 w-11 shrink-0"
          label={`Ações de ${habito.name}`}
          items={[
            { label: "Editar", onClick: onEditar },
            { label: "Arquivar", onClick: onArquivar },
          ]}
        >
          <Icon.Dots width={16} height={16} />
        </DropdownMenu>
      </header>

      <p className="flex items-baseline gap-2">
        <span className="text-4xl font-light leading-none tracking-tight text-ink tabular-nums">
          {sequencia}
        </span>
        <span className="text-legenda text-ink-muted">
          {unidadeDaSequencia(habito.schedule_kind, sequencia)}
          {resumo.melhorSequencia > sequencia && (
            <span className="text-ink-subtle"> · melhor {resumo.melhorSequencia}</span>
          )}
        </span>
      </p>

      <MapaDeCalor habito={resumo.habito} celulas={celulas} hoje={hoje} />

      <p className="text-legenda text-ink-subtle">
        <Resumo resumo={resumo} semanal={semanal} />
      </p>
    </Card>
  );
}

/**
 * A frase que resume o período — e o cuidado com o `null` da taxa.
 *
 * `taxa === null` NÃO é 0%: significa que a regra ainda não cobrou nada (hábito
 * criado hoje, ou período inteiro em pausa). Mostrar "0%" ali afirmaria fracasso
 * onde não houve nem oportunidade, que é o defeito mais fácil de cometer num
 * painel de hábitos e o mais rápido de fazer a pessoa parar de olhar para ele.
 */
function Resumo({ resumo, semanal }: { resumo: ResumoDeHabito; semanal: boolean }) {
  if (resumo.taxa === null) {
    return <>A regra ainda não cobrou nenhum dia — marque hoje para começar.</>;
  }

  const unidade = semanal
    ? resumo.esperados === 1
      ? "semana"
      : "semanas"
    : resumo.esperados === 1
      ? "dia"
      : "dias";

  return (
    <>
      <span className="tabular-nums text-ink">{resumo.taxa}%</span> de {resumo.esperados} {unidade}
      {" · "}
      {resumo.falhas === 0
        ? semanal
          ? "nenhuma semana perdida"
          : "nenhuma falha"
        : semanal
          ? `${resumo.falhas} abaixo do alvo`
          : `${resumo.falhas} ${resumo.falhas === 1 ? "falha" : "falhas"}`}
    </>
  );
}
