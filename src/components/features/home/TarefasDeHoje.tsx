"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import { EmptyState } from "@/components/ui/states";
import { TaskCheckbox } from "@/components/features/tasks/TasksView";
import { listarTarefasClickUp } from "@/app/(app)/tarefas/clickup-actions";
import type { MotivoClickUp } from "@/lib/clickup/erros";
import type { TarefaClickUp } from "@/lib/clickup/types";
import type { Category, Task } from "@/lib/database.types";
import { cn, formatDayLabel, formatTime, plural } from "@/lib/utils";

/**
 * TAREFAS DE HOJE — as pessoais e as do trabalho, na mesma lista.
 *
 * ============================================================================
 * ⚠️ POR QUE A BUSCA DO CLICKUP ESTÁ AQUI, E NÃO NO `page.tsx`
 * ============================================================================
 * O Início é Componente de Servidor e roda um `Promise.all` antes de desenhar
 * qualquer pixel. Uma chamada à API do ClickUp dentro daquele bloco faria A TELA
 * INICIAL INTEIRA esperar por um serviço externo: num dia em que o ClickUp
 * estiver lento, abrir o aplicativo fica lento — inclusive para quem só queria
 * ver a agenda. É a mesma decisão já escrita em `getClickUpConnection` (data.ts)
 * e em `ClickUpPanel`, e aqui ela pesa mais, porque esta é a tela que abre
 * primeiro.
 *
 * As duas camadas:
 *
 *   (a) O SERVIDOR manda as tarefas locais já filtradas e a lista aparece
 *       completa no primeiro quadro, sem rede nenhuma pendurada nela.
 *   (b) O NAVEGADOR, depois de montar, chama `listarTarefasClickUp` e FUNDE o
 *       que vier na mesma lista.
 *
 * O pior caso vira "as do ClickUp não vieram" — uma linha discreta no rodapé do
 * cartão —, nunca "a tela inicial travou".
 *
 * ============================================================================
 * A ORIGEM DE CADA LINHA É VISÍVEL, SEMPRE
 * ============================================================================
 * Duas tarefas com o mesmo nome vindas de sistemas diferentes se comportam de
 * formas diferentes: a local tem caixa de marcar e conclui aqui; a do ClickUp
 * abre no ClickUp, porque mudar status exige a folha de detalhe da aba de
 * Tarefas. Sem dizer de onde cada uma vem, clicar numa tarefa de trabalho e
 * cair no aplicativo pessoal (ou o contrário) é confusão garantida.
 */

/** Cache de 60 s — mesma validade do `ClickUpPanel`. */
const VALIDADE_MS = 60_000;

/**
 * O cache é de MÓDULO, não de `useRef` como no `ClickUpPanel` — e a diferença
 * importa.
 *
 * Lá o componente permanece montado enquanto se alterna entre as abas, então um
 * ref sobrevive ao que precisa sobreviver. Aqui não: sair do Início e voltar
 * DESMONTA este componente, e um ref morreria junto. Como o Início é a tela para
 * onde se volta o tempo todo, o ref gastaria a cota da API do ClickUp — que é a
 * da conta pessoal de quem conectou — a cada ida e volta.
 *
 * Uma variável de módulo num componente de cliente vive enquanto a aba do
 * navegador viver, e é reiniciada por qualquer recarregamento completo (entrar,
 * sair, F5). Para um aplicativo de UM usuário, esse é exatamente o escopo certo.
 */
let cacheDoClickUp: { tarefas: TarefaClickUp[]; buscadoEm: number } | null = null;

/** Uma linha da lista, já normalizada — não interessa mais de onde ela veio. */
interface Linha {
  chave: string;
  titulo: string;
  /** Instante do prazo em ms, ou `null` (só acontece em tarefa local sem data). */
  quando: number | null;
  rotuloQuando: string;
  vencida: boolean;
  concluida: boolean;
  origem: "local" | "clickup";
  /** A tarefa original — só nas locais, é o que a caixa de marcar precisa. */
  tarefa?: Task;
  /** Categoria (local) ou lista de origem (ClickUp). */
  contexto: string | null;
  /** Endereço no ClickUp. `null` nas locais. */
  url: string | null;
}

/**
 * Vencidas primeiro, depois por horário.
 *
 * O critério de ordenação é o mesmo dos dois lados de propósito. Ordenar as
 * locais por um campo e as do ClickUp por outro produziria uma lista em que a
 * segunda linha vence antes da primeira, e não haveria como perceber o motivo
 * olhando a tela.
 */
function porUrgencia(a: Linha, b: Linha): number {
  if (a.vencida !== b.vencida) return a.vencida ? -1 : 1;
  if (a.quando === b.quando) return 0;
  // Sem prazo vai para o fim — nunca para o começo, que é onde `null` cairia
  // numa subtração ingênua.
  if (a.quando === null) return 1;
  if (b.quando === null) return -1;
  return a.quando - b.quando;
}

export function TarefasDeHoje({
  tarefas,
  categorias,
  clickupAtivo,
  agora,
  inicioDeHoje,
  fimDeHoje,
}: {
  /** Locais com prazo até o fim de hoje (inclui as atrasadas). Já vêm do servidor. */
  tarefas: Task[];
  categorias: Category[];
  /**
   * A conexão com o ClickUp está ligada? Vem de `getClickUpConnection`, que é
   * consulta local barata e cabe no `Promise.all` da página. Falso aqui
   * significa NENHUMA chamada de rede — nem para descobrir que não há conexão.
   */
  clickupAtivo: boolean;
  /** O "agora" do servidor. Ver o mesmo argumento em `CartaoClickUp`. */
  agora: number;
  inicioDeHoje: number;
  fimDeHoje: number;
}) {
  const [tarefasClickUp, setTarefasClickUp] = useState<TarefaClickUp[]>([]);
  const [carregando, setCarregando] = useState(clickupAtivo);
  const [erro, setErro] = useState<{ texto: string; motivo?: MotivoClickUp } | null>(null);

  const buscar = useCallback(async (forcar = false) => {
    const guardado = cacheDoClickUp;
    if (!forcar && guardado && Date.now() - guardado.buscadoEm < VALIDADE_MS) {
      setTarefasClickUp(guardado.tarefas);
      setCarregando(false);
      return;
    }

    setCarregando(true);
    setErro(null);
    const r = await listarTarefasClickUp();
    setCarregando(false);

    if (!r.ok) {
      setErro({ texto: r.erro ?? "Não foi possível falar com o ClickUp.", motivo: r.motivo });
      return;
    }

    const lista = r.tarefas ?? [];
    cacheDoClickUp = { tarefas: lista, buscadoEm: Date.now() };
    setTarefasClickUp(lista);
  }, []);

  useEffect(() => {
    if (!clickupAtivo) return;
    void buscar();
  }, [buscar, clickupAtivo]);

  const nomeDaCategoria = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.name])),
    [categorias],
  );

  const linhas = useMemo(() => {
    // A anotação de retorno é o que fixa `origem: "local"` como o literal do
    // tipo, e não como `string`: sem ela o objeto deixa de casar com `Linha`.
    const locais = tarefas.map((t): Linha => {
      const quandoIso = t.due_at ?? t.scheduled_start_at;
      const quando = quandoIso ? new Date(quandoIso).getTime() : null;
      const concluida = t.status === "done";
      return {
        chave: `local:${t.id}`,
        titulo: t.title,
        quando,
        rotuloQuando: quandoIso
          ? `${formatDayLabel(quandoIso)}${t.all_day ? "" : ` · ${formatTime(quandoIso)}`}`
          : "sem prazo",
        /*
          ⚠️ TAREFA DE DIA INTEIRO NÃO VENCE AO MEIO-DIA.

          O prazo dela é gravado à meia-noite, então comparar com `agora` a
          marcaria como atrasada a partir das 00h01 — todo santo dia, para todo
          compromisso do próprio dia. Para essas, atrasada é "o dia já passou".
        */
        vencida: !concluida && quando !== null && quando < (t.all_day ? inicioDeHoje : agora),
        concluida,
        origem: "local",
        tarefa: t,
        contexto: t.category_id ? (nomeDaCategoria.get(t.category_id) ?? null) : null,
        url: null,
      };
    });

    /*
      Do ClickUp vem TUDO em que você é responsável; aqui interessa só o que
      vence até o fim de hoje — mais o que já venceu, que é a parte que não pode
      sumir. Uma tarefa vencida escondida porque "não é de hoje" é o defeito que
      transforma um painel de hoje num painel de nada.

      Não é preciso filtrar concluídas: a listagem já vai com
      `include_closed: "false"` (ver lib/clickup/client.ts).
    */
    const doClickUp = tarefasClickUp
      .filter((t) => t.prazo !== null && new Date(t.prazo).getTime() < fimDeHoje)
      .map((t): Linha => {
        // `filter` não estreita o tipo do que sobrou; o prazo está garantido
        // pela linha acima.
        const quando = new Date(t.prazo!).getTime();
        return {
          chave: `clickup:${t.id}`,
          titulo: t.nome,
          quando,
          rotuloQuando: `${formatDayLabel(t.prazo)} · ${formatTime(t.prazo)}`,
          // O mesmo `agora` das locais, e não um `Date.now()` novo: estas chegam
          // alguns segundos depois, e dois relógios na mesma lista fariam duas
          // tarefas com o mesmo horário discordarem sobre estar vencidas.
          vencida: quando < agora,
          concluida: false,
          origem: "clickup",
          contexto: t.listaNome,
          url: t.url,
        };
      });

    return [...locais, ...doClickUp].sort(porUrgencia);
  }, [tarefas, tarefasClickUp, nomeDaCategoria, agora, inicioDeHoje, fimDeHoje]);

  const vencidas = linhas.filter((l) => l.vencida).length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-titulo font-semibold text-ink">Tarefas de hoje</h2>
        {/*
          O indicador de carregamento é uma FRASE, e não um giro: ele diz o que
          está acontecendo (falta o ClickUp) para que a lista já visível não
          pareça a lista final. `aria-live="polite"` anuncia a chegada sem
          interromper quem está lendo outra coisa.
        */}
        <p className="text-legenda text-ink-subtle" aria-live="polite">
          {carregando ? (
            <span className="animate-pulse">Buscando no ClickUp…</span>
          ) : vencidas > 0 ? (
            plural(vencidas, "atrasada", "atrasadas")
          ) : null}
        </p>
      </div>

      <Card className="divide-y divide-line">
        {linhas.length === 0 ? (
          carregando ? (
            /* Enquanto o ClickUp não responde, "Sem tarefas para hoje" seria uma
               afirmação que pode ser desmentida um segundo depois. O esqueleto
               não afirma nada. */
            <div className="space-y-2 p-4" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="h-4 w-2/3 animate-pulse rounded-sm bg-surface-muted" />
              ))}
            </div>
          ) : (
            <EmptyState icon="Tasks" title="Sem tarefas para hoje" />
          )
        ) : (
          linhas.map((linha) => <LinhaDeTarefa key={linha.chave} linha={linha} />)
        )}

        {erro && <FalhaDoClickUp erro={erro} aoTentarDeNovo={() => void buscar(true)} />}
      </Card>
    </section>
  );
}

function LinhaDeTarefa({ linha }: { linha: Linha }) {
  const classeTitulo = cn(
    "text-corpo font-medium",
    linha.concluida ? "text-ink-subtle line-through" : "text-ink",
  );

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {linha.origem === "local" && linha.tarefa ? (
        <TaskCheckbox task={linha.tarefa} />
      ) : (
        /*
          O lugar da caixa de marcar fica OCUPADO nas linhas do ClickUp, com um
          ícone. Deixá-lo vazio desalinharia os títulos e, pior, sugeriria que a
          caixa está faltando por engano. Aqui a ausência é a informação: esta
          tarefa não se conclui daqui.

          O ícone é `aria-hidden` porque a origem já está escrita em texto na
          linha de baixo — quem usa leitor de tela ouve "ClickUp", não "imagem".
        */
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-ink-subtle"
        >
          <Icon.Link width={11} height={11} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        {linha.url ? (
          <a
            href={linha.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(classeTitulo, "rounded-sm hover:underline")}
          >
            {linha.titulo}
            <span className="sr-only"> (abre no ClickUp, em nova aba)</span>
          </a>
        ) : (
          <p className={classeTitulo}>{linha.titulo}</p>
        )}
        <p className="text-legenda text-ink-subtle">
          {/* A ORIGEM VEM PRIMEIRO na linha de apoio, antes do horário: é o que
              decide o que acontece ao clicar. */}
          <span className="font-medium text-ink-muted">
            {linha.origem === "local" ? "Pessoal" : "ClickUp"}
          </span>
          {" · "}
          {linha.rotuloQuando}
          {/* A palavra "atrasada" carrega o sentido; o vermelho só reforça. Quem
              não distingue a cor continua lendo o aviso. */}
          {linha.vencida && <span className="ml-1 text-danger-ink">atrasada</span>}
        </p>
      </div>

      {linha.contexto && (
        /* Categoria ou lista de origem, com teto de largura: nome de lista do
           ClickUp ("Sprint Backlog 2026 — Squad B") empurraria o título para
           três linhas no celular. O `title` devolve o nome inteiro ao ponteiro,
           e o `min-w-0` no filho é o que faz o corte com reticências funcionar
           dentro de um contêiner flex. */
        <Badge tone="outline" className="max-w-[7rem] shrink-0 sm:max-w-[10rem]" title={linha.contexto}>
          <span className="min-w-0 truncate">{linha.contexto}</span>
        </Badge>
      )}
    </div>
  );
}

/**
 * A falha do ClickUp é um RODAPÉ, nunca o estado da lista.
 *
 * Diferente do `ClickUpPanel`, aqui não cabe um `EmptyState` ocupando o cartão:
 * as tarefas locais já estão na tela e são a resposta principal. Trocá-las por
 * um aviso de indisponibilidade seria deixar de mostrar o que funciona porque
 * outra coisa quebrou.
 *
 * SEM VERMELHO, também de propósito: no aplicativo o vermelho significa erro, e
 * um serviço externo fora do ar não é um erro do aplicativo. Pintar a tela
 * inicial de vermelho toda vez que o ClickUp oscila ensina a ignorar vermelho —
 * e aí ele deixa de funcionar onde importa.
 */
function FalhaDoClickUp({
  erro,
  aoTentarDeNovo,
}: {
  erro: { texto: string; motivo?: MotivoClickUp };
  aoTentarDeNovo: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <p className="inline-flex min-w-0 items-center gap-1.5 text-legenda text-ink-muted">
        <Icon.Alert width={13} height={13} className="shrink-0 text-ink-subtle" aria-hidden />
        <span className="min-w-0">ClickUp indisponível — {erro.texto}</span>
      </p>
      {/* Um 401 não se resolve tentando de novo: o token foi recusado, e a ação
          certa é reconectar. Oferecer "Tentar de novo" ali seria convidar a
          repetir o que já falhou. */}
      {erro.motivo === "token_invalido" ? (
        <Link
          href="/configuracoes"
          className="alvo-44 inline-flex h-8 shrink-0 items-center rounded-sm border border-line-strong px-3 text-legenda font-medium text-ink hover:bg-surface-muted"
        >
          Abrir Configurações
        </Link>
      ) : (
        <Button variant="secondary" size="sm" onClick={aoTentarDeNovo}>
          <Icon.Refresh width={14} height={14} /> Tentar de novo
        </Button>
      )}
    </div>
  );
}
