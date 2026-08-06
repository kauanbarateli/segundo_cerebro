"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { HabitForm } from "@/components/features/habits/HabitForm";
import { HabitoCard } from "@/components/features/habits/HabitoCard";
import { LegendaDoMapa } from "@/components/features/habits/MapaDeCalor";
import {
  MedidorSemanal,
  descreverCadencia,
  feitosNaSemanaCorrente,
  formatarDiaLongo,
  formatarDiaMedio,
  maiuscula,
  unidadeDaSequencia,
} from "@/components/features/habits/Leitura";
import { archiveHabit, toggleHabitDay } from "@/app/(app)/habitos/actions";
import type { Habit, HabitEntry, HabitPause } from "@/lib/database.types";
import { celulasDoPeriodo, resumirHabitos, type Habito, type ResumoDeHabito } from "@/lib/habits";
import { cn } from "@/lib/utils";

/**
 * A TELA DE HÁBITOS — dois blocos, duas perguntas.
 *
 * ⚠️ NENHUM NÚMERO DESTA TELA VEM DO BANCO PRONTO. Sequência, taxa e falhas são
 * derivadas por `src/lib/habits.ts`, o mesmo módulo que a rota do e-mail
 * semanal consome. Duas implementações da mesma conta é como um dia a tela diz
 * 18, o e-mail diz 19, e ninguém sabe qual está certo.
 *
 * =============================================================================
 * A ESTRUTURA, E POR QUE ELA MUDOU
 * =============================================================================
 * Antes: quatro cartões de indicador no topo, uma lista onde cada linha tinha
 * checkbox, distintivos, três métricas e um mapa de calor espremido em 3px de
 * altura. Tudo com o mesmo peso — e nada é herói quando tudo é.
 *
 * Agora a tela responde uma pergunta de cada vez:
 *
 *   1. "O que falta marcar hoje?"  → o cartão HOJE, no topo. Linhas de 56px,
 *      resposta otimista, sem confirmação. É o gesto mais frequente do módulo e
 *      todos os toques cabem num bloco só.
 *   2. "Como foi o período?"       → um cartão por hábito, com a SEQUÊNCIA no
 *      maior corpo tipográfico e o MAPA DE CALOR em tamanho de gráfico, não de
 *      rodapé.
 *
 * =============================================================================
 * ⚠️ UM PERÍODO SÓ: 90 DIAS
 * =============================================================================
 * A versão anterior resumia 30 dias e desenhava 90. Duas janelas na mesma tela
 * significavam que "4 falhas" e o mapa logo abaixo falavam de recortes
 * diferentes do tempo, sem nada avisando — e a pessoa só descobria conferindo
 * quadradinho por quadradinho.
 *
 * Agora a taxa, as falhas e o mapa usam a MESMA janela carregada pela página
 * (`inicioDaJanela`). O texto do rodapé diz qual é, porque um painel que não
 * declara seu período está pedindo para ser interpretado errado.
 */
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
    ao servidor faria o gesto mais frequente do módulo parecer travado. O Map
    guarda as chaves `habitId|dia` que divergem do servidor até a revalidação
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
    () => resumirHabitos(regras, feitosPorHabito, inicioDaJanela, hoje, hoje, pausasPuras),
    [regras, feitosPorHabito, inicioDaJanela, hoje, pausasPuras],
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

  function abrirNovo() {
    setEditando(null);
    setFormAberto(true);
  }

  if (habitos.length === 0) {
    return (
      <>
        {/*
          O VAZIO É UM CONVITE, não um painel de zeros. Quatro indicadores em
          "0%" na primeira visita ensinam que este módulo mede fracasso — a
          leitura exatamente oposta à que ele existe para dar.
        */}
        <EmptyState
          icon="Repeat"
          title="Comece pelo primeiro hábito"
          description="Um hábito é uma regra: o que fazer e com que frequência. Você só marca o que cumpriu — a falha sai da regra, sem precisar anotar nada."
          action={
            <Button variant="primary" size="md" onClick={abrirNovo}>
              <Icon.Capture width={15} height={15} /> Criar hábito
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

  const progresso =
    resumo.hojeEsperados === 0
      ? 0
      : Math.round((resumo.hojeFeitos / resumo.hojeEsperados) * 100);

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------- o gesto do dia -- */}
      <Card elevacao="destaque" className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {/* `h2` e não `p`: os dois blocos da tela ("Hoje" e o histórico) são
                os pontos de salto de quem navega por cabeçalhos, e um deles
                estava invisível para essa navegação. A classe visual não muda. */}
            <h2 className="eyebrow">Hoje</h2>
            <p className="mt-1.5 text-corpo-forte font-medium text-ink">
              {maiuscula(formatarDiaLongo(hoje))}
            </p>
          </div>
          <Button variant="primary" size="md" onClick={abrirNovo}>
            <Icon.Capture width={15} height={15} /> Novo hábito
          </Button>
        </div>

        <div className="px-4 pt-4 sm:px-5">
          {resumo.hojeEsperados === 0 ? (
            <p className="text-legenda text-ink-subtle">
              Nenhum hábito é cobrado hoje. Isso não é falha de ninguém — é o que as regras
              dizem.
            </p>
          ) : (
            <>
              <p className="flex items-baseline justify-between gap-2 text-legenda text-ink-subtle">
                <span>
                  <span className="tabular-nums text-ink">{resumo.hojeFeitos}</span> de{" "}
                  <span className="tabular-nums">{resumo.hojeEsperados}</span> cumpridos
                </span>
                {/* Reconhecimento, não festa: uma frase de três palavras envelhece
                    melhor que confete num aplicativo que se abre todo dia. */}
                {resumo.hojeFeitos === resumo.hojeEsperados && <span>dia fechado</span>}
              </p>
              <div
                aria-hidden
                className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink/10"
              >
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-200"
                  style={{ width: `${progresso}%` }}
                />
              </div>
            </>
          )}
        </div>

        <ul className="mt-4 divide-y divide-line border-t border-line">
          {resumo.porHabito.map((r) => (
            <LinhaDeHoje
              key={r.habito.id}
              resumo={r}
              hoje={hoje}
              feitosNaSemana={feitosNaSemanaCorrente(
                feitosPorHabito.get(r.habito.id) ?? new Set(),
                hoje,
                r.habito.started_on,
              )}
              onMarcar={() => marcar(r.habito.id, hoje, !r.hojeFeito)}
            />
          ))}
        </ul>
      </Card>

      {/* --------------------------------------------------- o histórico -- */}
      <section className="space-y-4">
        <h2 className="eyebrow flex items-center gap-3">
          <span className="shrink-0">Últimos {diasDaJanela} dias</span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </h2>

        {/*
          Duas colunas a partir de `lg`. O mapa de 90 dias ocupa ~250px de
          largura, então meia largura de tela grande sobra — e uma coluna só
          transformaria cinco hábitos em cinco telas de rolagem, o que faz a
          comparação entre eles (o motivo de estarem na mesma página) sumir.
        */}
        <div className="grid gap-4 lg:grid-cols-2">
          {resumo.porHabito.map((r) => {
            const habito = porId.get(r.habito.id);
            if (!habito) return null;
            return (
              <HabitoCard
                key={r.habito.id}
                habito={habito}
                resumo={r}
                hoje={hoje}
                celulas={celulasDoPeriodo(
                  r.habito,
                  feitosPorHabito.get(r.habito.id) ?? new Set(),
                  hoje,
                  diasDaJanela,
                  pausasPuras,
                )}
                feitosNaSemana={feitosNaSemanaCorrente(
                  feitosPorHabito.get(r.habito.id) ?? new Set(),
                  hoje,
                  r.habito.started_on,
                )}
                onEditar={() => {
                  setEditando(habito);
                  setFormAberto(true);
                }}
                onArquivar={() => setArquivando(habito)}
              />
            );
          })}
        </div>
      </section>

      {/* `div` e não `footer`: um `<footer>` que não está dentro de `article` ou
          `section` vira landmark `contentinfo`, e o layout do aplicativo já tem
          o dele. Dois `contentinfo` na mesma página fazem o leitor de tela
          anunciar "rodapé" duas vezes para coisas diferentes. */}
      <div className="space-y-3 border-t border-line pt-5">
        <LegendaDoMapa />
        <p className="text-legenda text-ink-subtle">
          A janela carregada é de {diasDaJanela} dias, desde {formatarDiaMedio(inicioDaJanela)}.
          Taxa, falhas e sequência saem da regra de cada hábito — não existe registro de
          “falhou”, e por isso nenhum número aqui depende de algum processo ter rodado à noite.
        </p>
      </div>

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

/**
 * UMA LINHA DO CARTÃO "HOJE" — e ela é o alvo de toque, inteira.
 *
 * =============================================================================
 * ⚠️ A LINHA TODA É O BOTÃO, não o círculo de 24px que havia antes
 * =============================================================================
 * O gesto mais repetido do módulo não pode exigir mira. `min-h-[56px]` passa
 * folgado dos 44px de piso, e como a área clicável vai de ponta a ponta, marcar
 * é "toque em qualquer lugar da linha" — o polegar não precisa acertar nada.
 *
 * É também por isso que o menu de ações (editar, arquivar) NÃO está aqui: dois
 * alvos na mesma linha significam um errar o outro, e arquivar por engano custa
 * muito mais caro que abrir o menu no cartão de histórico, um bloco abaixo.
 *
 * =============================================================================
 * ⚠️ `hojeFeito === null` VIRA LINHA SEM BOTÃO, e não botão desabilitado
 * =============================================================================
 * Significa "não era para fazer hoje" — diferente de "não fiz". Botão
 * desabilitado não recebe foco e é anunciado como controle indisponível, o que
 * convida a tentar de novo; aqui não há nada a tentar. Então a linha continua
 * na lista (sumir faria a lista mudar de tamanho todo dia, e a pessoa
 * procuraria o hábito que "desapareceu") mas deixa de ser interativa e diz por
 * escrito qual é a regra.
 */
function LinhaDeHoje({
  resumo,
  hoje,
  feitosNaSemana,
  onMarcar,
}: {
  resumo: ResumoDeHabito;
  hoje: string;
  feitosNaSemana: number;
  onMarcar: () => void;
}) {
  const { habito } = resumo;
  const semanal = habito.schedule_kind === "weekly_target";
  const alvo = habito.weekly_target ?? 1;
  const feito = resumo.hojeFeito === true;

  const cadencia = descreverCadencia(habito);
  const legenda =
    resumo.sequenciaAtual > 0
      ? `${cadencia} · ${resumo.sequenciaAtual} ${unidadeDaSequencia(habito.schedule_kind, resumo.sequenciaAtual)}`
      : cadencia;

  if (resumo.hojeFeito === null) {
    return (
      <li className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 sm:px-5">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong"
        >
          <span className="h-px w-2.5 bg-ink-subtle" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-corpo-forte text-ink-muted">{habito.name}</span>
          <span className="block truncate text-legenda text-ink-subtle">{cadencia}</span>
        </span>
        <span className="shrink-0 text-legenda text-ink-subtle">não é hoje</span>
      </li>
    );
  }

  /*
    O RÓTULO ACESSÍVEL DIZ O HÁBITO **E** O DIA. "Marcar Ler 20 páginas", sozinho,
    não informa qual dia está sendo marcado — e esta tela também aceita marcação
    de outro dia por outros caminhos. O contexto no fim (sequência ou progresso
    da semana) é o que o olho lê à direita; sem ele, quem usa leitor de tela
    decide sem a informação que o outro usuário tem na frente.
  */
  const contexto = semanal
    ? ` ${feitosNaSemana} de ${alvo} cumpridos nesta semana.`
    : resumo.sequenciaAtual > 0
      ? ` Sequência de ${resumo.sequenciaAtual} ${unidadeDaSequencia(habito.schedule_kind, resumo.sequenciaAtual)}.`
      : "";

  /*
    ⚠️ `focus-visible:-outline-offset-2`, e não `-outline-offset-2` solto: a regra
    global de `:focus-visible` em globals.css vem DEPOIS de `@tailwind utilities`
    e tem a mesma especificidade que um utilitário simples, então venceria e
    devolveria o contorno para 2px PARA FORA. Como o cartão é `overflow-hidden`,
    um contorno para fora seria cortado e a linha ficaria sem indicador de foco
    nenhum. Com a variante, a especificidade sobe para (0,2,0) e o contorno
    desenha por dentro.
  */
  return (
    <li>
      <button
        type="button"
        aria-pressed={feito}
        aria-label={`${feito ? "Desmarcar" : "Marcar"} ${habito.name} em ${formatarDiaLongo(hoje)}.${contexto}`}
        onClick={onMarcar}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:-outline-offset-2 active:bg-surface-muted sm:px-5"
      >
        <span
          aria-hidden
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
            feito
              ? "border-transparent bg-accent text-accent-ink"
              : "border-line-strong text-transparent",
          )}
        >
          <Icon.Check width={16} height={16} />
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-corpo-forte",
              // Riscado E esmaecido: a informação "já foi" não pode depender só
              // do risco, que some em telas pequenas e em fonte fina.
              feito ? "text-ink-subtle line-through" : "font-medium text-ink",
            )}
          >
            {habito.name}
          </span>
          <span className="block truncate text-legenda text-ink-subtle">{legenda}</span>
        </span>

        {/* Só a cadência semanal ganha medidor: é a única em que "quanto falta"
            é uma pergunta em aberto no meio da semana. */}
        {semanal && (
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-legenda tabular-nums text-ink-muted">
              {feitosNaSemana}/{alvo}
            </span>
            <MedidorSemanal feitos={feitosNaSemana} alvo={alvo} />
          </span>
        )}
      </button>
    </li>
  );
}
