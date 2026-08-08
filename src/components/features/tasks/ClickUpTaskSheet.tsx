"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  comentarClickUp,
  detalharTarefaClickUp,
  mudarPrazoClickUp,
  mudarStatusClickUp,
} from "@/app/(app)/tarefas/clickup-actions";
import { CLASSE_DO_CAMPO, CLASSE_DO_CAMPO_MULTILINHA } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";
import type { ComentarioClickUp, StatusPossivel, TarefaClickUp } from "@/lib/clickup/types";
import { formatDayLabel, formatTime } from "@/lib/utils";
import { paraCampoLocal } from "@/lib/tempo";
import { ResponsaveisClickUp } from "@/components/features/tasks/ResponsaveisClickUp";

/**
 * Detalhe de uma tarefa do ClickUp: ler, mudar status, comentar.
 *
 * ⚠️ Os comentários são de COLEGAS e não são persistidos em lugar nenhum —
 * buscados agora, exibidos, esquecidos ao fechar. Guardá-los traria conversa de
 * terceiros para dentro de um banco pessoal que ninguém mais audita.
 */
export function ClickUpTaskSheet({
  tarefa,
  onFechar,
  onMudou,
}: {
  tarefa: TarefaClickUp;
  onFechar: () => void;
  /** Recarrega a lista depois de uma escrita que mudou o status. */
  onMudou: () => void;
}) {
  const { toast } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [detalhe, setDetalhe] = useState<TarefaClickUp>(tarefa);
  const [comentarios, setComentarios] = useState<ComentarioClickUp[]>([]);
  const [statusPossiveis, setStatusPossiveis] = useState<StatusPossivel[]>([]);

  const [texto, setTexto] = useState("");
  const [enviando, iniciarEnvio] = useTransition();
  const [mudandoStatus, iniciarStatus] = useTransition();

  /*
    Dia e hora em estados SEPARADOS, exatamente como em `TaskForm`, e pela mesma
    razão: alternar "Dia inteiro" troca o `type` do mesmo nó do DOM, e o
    navegador descarta o valor que virou incompatível. Guardando as duas metades
    aqui, a troca deixa de ser perda — o dia continua, e só a hora é ignorada.
  */
  const [prazoDia, setPrazoDia] = useState("");
  const [prazoHora, setPrazoHora] = useState("");
  const [prazoDiaInteiro, setPrazoDiaInteiro] = useState(false);
  const [salvandoPrazo, iniciarPrazo] = useTransition();

  /*
    O prazo do ClickUp vem como instante; os campos querem horário de parede no
    fuso do app. `paraCampoLocal` é a mesma função que o formulário interno usa —
    uma segunda conversão de data neste projeto seria uma segunda chance de
    errar do mesmo jeito.

    Depende de `detalhe.prazo` e não de `tarefa.prazo` porque o detalhe chega
    depois, pela busca do `useEffect` acima, e é ele que tem o valor autoritativo.
  */
  useEffect(() => {
    const completo = paraCampoLocal(detalhe.prazo, "datetime");
    const [dia, hora] = completo.split("T");
    setPrazoDia(dia ?? "");
    setPrazoHora(hora ?? "");
    // "00:00" é o que o ClickUp devolve quando `due_date_time` é falso — ou
    // seja, quando ninguém escolheu hora. Marcar a caixa nesse caso é ler o
    // dado como ele é, em vez de mostrar uma meia-noite que não foi decidida.
    setPrazoDiaInteiro(hora === "00:00" || !hora);
  }, [detalhe.prazo]);

  function salvarPrazo() {
    const valor = prazoDia
      ? prazoDiaInteiro
        ? prazoDia
        : `${prazoDia}T${prazoHora || "00:00"}`
      : "";

    iniciarPrazo(async () => {
      const r = await mudarPrazoClickUp(detalhe.id, valor);
      if (r.ok) {
        toast(valor ? "Prazo atualizado no ClickUp" : "Prazo removido", "success");
        onMudou();
      } else {
        toast(r.error ?? "Não foi possível mudar o prazo.", "error");
      }
    });
  }

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await detalharTarefaClickUp(tarefa.id);
      if (!vivo) return;
      setCarregando(false);
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível carregar a tarefa.");
        return;
      }
      if (r.tarefa) setDetalhe(r.tarefa);
      setComentarios(r.comentarios ?? []);
      setStatusPossiveis(r.statusPossiveis ?? []);
    })();
    // Evita `setState` depois de o painel fechar — o usuário pode fechar antes
    // de a resposta chegar, e o React avisa (com razão) sobre atualizar estado
    // de componente desmontado.
    return () => {
      vivo = false;
    };
  }, [tarefa.id]);

  function trocarStatus(novo: string) {
    if (novo === detalhe.status) return;
    const anterior = detalhe.status;

    // Otimista: mudar status é reversível e de baixo impacto, e esperar a ida e
    // volta para ver o seletor mudar faria a interface parecer travada.
    setDetalhe((d) => ({ ...d, status: novo }));

    iniciarStatus(async () => {
      const r = await mudarStatusClickUp(detalhe.id, novo);
      if (r.ok) {
        toast("Status atualizado no ClickUp", "success");
        onMudou();
      } else {
        // Reverte. Sem isto, a tela mostraria um status que o ClickUp recusou.
        setDetalhe((d) => ({ ...d, status: anterior }));
        toast(r.error ?? "Não foi possível mudar o status", "error");
      }
    });
  }

  function enviarComentario() {
    iniciarEnvio(async () => {
      const r = await comentarClickUp(detalhe.id, texto);
      if (r.ok) {
        // O campo só é limpo DEPOIS do ok. Se a rede cair, o texto continua
        // aqui — nada pior que perder o que se escreveu.
        setTexto("");
        toast("Comentário enviado ao ClickUp", "success");
        setComentarios((lista) => [
          ...lista,
          { id: r.id ?? "novo", texto, autor: "você", quando: new Date().toISOString() },
        ]);
      } else {
        toast(r.error ?? "Não foi possível comentar", "error");
      }
    });
  }

  return (
    <Modal title={detalhe.nome} size="lg" onClose={onFechar}>
      {carregando ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-4 w-1/2 animate-pulse rounded-sm bg-surface-muted" />
          <div className="h-20 animate-pulse rounded-sm bg-surface-muted" />
        </div>
      ) : erro ? (
        <p role="alert" className="flex items-start gap-2 text-corpo text-danger-ink">
          <Icon.Alert width={15} height={15} className="mt-0.5 shrink-0" />
          <span>{erro}</span>
        </p>
      ) : (
        <div className="space-y-5">
          {/* Contexto */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-ink-subtle">
            {detalhe.listaNome && <span>{detalhe.listaNome}</span>}
            {detalhe.prioridade && <span>Prioridade: {detalhe.prioridade}</span>}
            <ResponsaveisClickUp pessoas={detalhe.responsaveis} />
            {detalhe.url && (
              <a
                href={detalhe.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-muted hover:text-ink hover:underline"
              >
                Abrir no ClickUp
              </a>
            )}
          </div>

          {/*
            PRAZO — editável, e o único campo desta tela que ESCREVE data no
            workspace de outra empresa.

            ⚠️ O `type` acompanha "Dia inteiro" pelo mesmo motivo do formulário
            de tarefas internas, e com a mesma correção: o valor é CONTROLADO e
            a data é preservada ao alternar. Ver `TaskForm` — o defeito de
            perder o que foi digitado ao trocar o `type` é do navegador, não
            daquele componente, e aconteceria aqui igual.

            O botão é separado do campo (não salva no `onChange`) porque isto sai
            para o ClickUp e aparece para colegas: digitar "2026" no ano e ver
            três requisições saindo enquanto se completa a data é o comportamento
            errado para uma escrita externa.
          */}
          <div>
            <label htmlFor="clickup-prazo" className="mb-1.5 block text-corpo font-medium text-ink">
              Prazo
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="clickup-prazo"
                type={prazoDiaInteiro ? "date" : "datetime-local"}
                value={
                  prazoDia ? (prazoDiaInteiro ? prazoDia : `${prazoDia}T${prazoHora || "00:00"}`) : ""
                }
                onChange={(e) => {
                  const [dia, hora] = e.target.value.split("T");
                  setPrazoDia(dia ?? "");
                  if (hora) setPrazoHora(hora);
                }}
                className={cn(CLASSE_DO_CAMPO, "min-w-0 flex-1")}
              />
              <label className="flex items-center gap-2 text-legenda text-ink-muted">
                <input
                  type="checkbox"
                  checked={prazoDiaInteiro}
                  onChange={(e) => setPrazoDiaInteiro(e.target.checked)}
                  className="h-4 w-4 rounded-xs border-line-strong"
                />
                Dia inteiro
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={salvarPrazo}
                disabled={salvandoPrazo}
              >
                {salvandoPrazo ? "Salvando…" : "Salvar prazo"}
              </Button>
            </div>
            <p className="mt-1 text-legenda text-ink-subtle">
              Isto altera a tarefa no ClickUp e seus colegas veem a mudança. Deixe em branco para
              tirar o prazo.
            </p>
          </div>

          {/* Status — o seletor é populado pela LISTA desta tarefa. Cada Space
              do ClickUp define os seus, então não existe dropdown fixo. */}
          <div>
            <label htmlFor="clickup-status" className="mb-1.5 block text-corpo font-medium text-ink">
              Status
            </label>
            {statusPossiveis.length > 0 ? (
              <select
                id="clickup-status"
                value={detalhe.status ?? ""}
                disabled={mudandoStatus}
                onChange={(e) => trocarStatus(e.target.value)}
                className={cn(CLASSE_DO_CAMPO, "w-full max-w-xs")}
              >
                {statusPossiveis.map((s) => (
                  <option key={s.status} value={s.status}>
                    {s.status}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-corpo text-ink-subtle">
                {detalhe.status ?? "—"}{" "}
                <span className="text-legenda">(não foi possível ler os status da lista)</span>
              </p>
            )}
          </div>

          {/* Descrição */}
          {detalhe.descricao && (
            <div>
              <p className="mb-1.5 text-corpo font-medium text-ink">Descrição</p>
              <p className="whitespace-pre-wrap text-corpo text-ink-muted">{detalhe.descricao}</p>
            </div>
          )}

          {/* Comentários */}
          <div>
            <p className="mb-2 text-corpo font-medium text-ink">
              Comentários {comentarios.length > 0 && `(${comentarios.length})`}
            </p>
            {comentarios.length === 0 ? (
              <p className="text-corpo text-ink-subtle">Nenhum comentário ainda.</p>
            ) : (
              <ul className="space-y-2">
                {comentarios.map((c) => (
                  <li key={c.id} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                    <p className="text-legenda text-ink-subtle">
                      {c.autor ?? "alguém"}
                      {c.quando && ` · ${formatDayLabel(c.quando)} ${formatTime(c.quando)}`}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-corpo text-ink">{c.texto}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <label htmlFor="clickup-comentario" className="sr-only">
                Novo comentário
              </label>
              <textarea
                id="clickup-comentario"
                rows={3}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                maxLength={10_000}
                placeholder="Escreva um comentário…"
                className={cn(CLASSE_DO_CAMPO_MULTILINHA, "w-full")}
              />
              {/* Empilha no celular: o aviso pede ~250px e o botão outros ~155,
                  contra os 303px do modal em 375px. Lado a lado, quem encolhia
                  era o BOTÃO — "Comentar no ClickUp" quebrava em duas linhas
                  dentro de uma caixa de 32px de altura. */}
              <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                {/* O aviso é permanente, não um diálogo de confirmação. Um
                    diálogo a mais para cada comentário vira ruído e some da
                    atenção em dois dias; a frase fixa continua sendo lida. */}
                <p className="text-legenda text-ink-subtle">
                  Aparece no ClickUp com o seu nome, para o time.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  /* Desabilitado durante o envio: é a camada 1 das três contra
                     comentário duplicado (as outras duas são "sem retry em
                     POST" e o limite de 10/min). */
                  disabled={enviando || texto.trim().length === 0}
                  onClick={enviarComentario}
                >
                  {/* Nunca só "Enviar": a pessoa precisa saber que isto sai do
                      aplicativo pessoal. */}
                  {enviando ? "Enviando…" : "Comentar no ClickUp"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
