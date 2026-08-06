"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import {
  alternarClickUp,
  conectarClickUp,
  desconectarClickUp,
  testarClickUp,
} from "@/app/(app)/configuracoes/clickup-actions";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import type { ClickUpConnection } from "@/lib/database.types";
import { formatDayLabel, formatTime, cn } from "@/lib/utils";

/**
 * Painel de integrações — hoje só o ClickUp.
 *
 * ⚠️ O TOKEN NUNCA CHEGA AQUI. Nenhuma prop, nenhum retorno de action, nem
 * mascarado. O componente sabe NOME e WORKSPACE, que é o que responde "é a
 * conta certa?" — e é tudo que ele precisa saber.
 *
 * Uma máscara tipo `pk_••••3f2a` entregaria quatro caracteres do segredo em
 * troca de uma informação que o nome da pessoa na tela já dá melhor.
 */
export function IntegrationsPanel({
  conexao,
  verificadoEm,
}: {
  conexao: ClickUpConnection | null;
  /** ISO de `last_checked_at`. Só para exibir. */
  verificadoEm: string | null;
}) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);
  const [pendente, iniciar] = useTransition();

  const conectado = conexao?.conectado ?? false;

  function conectar() {
    setErro(null);
    iniciar(async () => {
      const r = await conectarClickUp(token);
      if (!r.ok) {
        setErro(r.error ?? "Não foi possível conectar.");
        return;
      }
      // Só limpa DEPOIS do sucesso: se falhou, o token colado continua no campo
      // e a pessoa corrige em vez de colar de novo.
      setToken("");
      toast(`Conectado como ${r.perfil?.username ?? "sua conta"}`, "success");
      if ((r.perfil?.totalDeWorkspaces ?? 1) > 1) {
        toast(
          `Você tem ${r.perfil?.totalDeWorkspaces} workspaces. Usando "${r.perfil?.workspaceName}".`,
        );
      }
    });
  }

  /* ------------------------------------------------------------ desconectado */

  if (!conectado) {
    return (
      <Card className="p-6">
        <Cabecalho />

        <p className="mt-3 text-corpo text-ink-muted">
          Veja as tarefas em que você é responsável, mude o status e comente —
          sem sair daqui.
        </p>

        <div className="mt-4">
          <label htmlFor="clickup-token" className="mb-1.5 block text-corpo font-medium text-ink">
            Token pessoal
          </label>
          <input
            id="clickup-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="pk_..."
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn(CLASSE_DO_CAMPO, "w-full font-mono")}
          />
          <p className="mt-1.5 text-legenda text-ink-subtle">
            No ClickUp:{" "}
            <span className="font-medium text-ink-muted">
              foto do perfil → Settings → Apps → API Token
            </span>
            .
          </p>
        </div>

        <BlocoDoQueOAppFaz />

        {erro && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-corpo text-danger-ink">
            <Icon.Alert width={15} height={15} className="mt-0.5 shrink-0" />
            <span>{erro}</span>
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={pendente || token.trim().length === 0}
            onClick={conectar}
          >
            {pendente ? "Conectando…" : "Conectar"}
          </Button>
        </div>
      </Card>
    );
  }

  /* -------------------------------------------------------------- conectado */

  const tokenRecusado = conexao?.status === "invalid";

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <Cabecalho />
        {/*
          O interruptor. DESLIGAR não é desconectar: some com a aba e para as
          chamadas, mas o token continua gravado. As duas ações ficam
          visualmente separadas de propósito — o interruptor aqui em cima,
          "Desconectar" lá embaixo, longe.
        */}
        <button
          type="button"
          role="switch"
          aria-checked={conexao?.ativo ?? false}
          aria-label={conexao?.ativo ? "Desativar ClickUp" : "Ativar ClickUp"}
          disabled={pendente}
          onClick={() =>
            iniciar(async () => {
              const r = await alternarClickUp(!(conexao?.ativo ?? false));
              if (!r.ok) toast(r.error ?? "Erro", "error");
            })
          }
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
            conexao?.ativo ? "border-transparent bg-accent" : "border-line-strong bg-surface-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-subtle transition-all",
              conexao?.ativo ? "left-[1.55rem]" : "left-0.5",
            )}
          />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={tokenRecusado ? "solid" : "outline"}>
          {tokenRecusado ? "Token recusado" : conexao?.ativo ? "Ativo" : "Desligado"}
        </Badge>
        <p className="text-corpo text-ink-muted">
          Conectado como{" "}
          <span className="font-medium text-ink">{conexao?.username ?? "sua conta"}</span>
        </p>
      </div>

      <p className="mt-1 text-legenda text-ink-subtle">
        Workspace: {conexao?.workspaceName ?? "—"}
        {verificadoEm && (
          <> · verificado {formatDayLabel(verificadoEm)} {formatTime(verificadoEm)}</>
        )}
      </p>

      {tokenRecusado && (
        <p className="mt-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-corpo text-ink-muted">
          O ClickUp recusou este token na última tentativa. Gere um novo e
          conecte de novo — desconectar primeiro não é necessário.
        </p>
      )}

      <BlocoDoQueOAppFaz />

      {erro && (
        <p role="alert" className="mt-3 text-corpo text-danger-ink">
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pendente}
          onClick={() => {
            setErro(null);
            iniciar(async () => {
              const r = await testarClickUp();
              if (r.ok) toast(`Conexão ok — ${r.perfil?.username ?? "conta"}`, "success");
              else setErro(r.error ?? "Falha ao testar.");
            });
          }}
        >
          <Icon.Refresh width={14} height={14} /> Testar conexão
        </Button>
        <Button variant="danger" size="sm" disabled={pendente} onClick={() => setConfirmarDesconexao(true)}>
          Desconectar
        </Button>
      </div>

      <ConfirmationDialog
        open={confirmarDesconexao}
        title="Desconectar do ClickUp"
        /*
          A segunda frase existe porque "desconectar" numa ferramenta de
          trabalho compartilhada soa como se fosse mexer lá. Não mexe: o token
          pessoal não tem revogação por API, e nada no ClickUp é alterado.
        */
        description="O token será apagado deste aplicativo. Nada no ClickUp é alterado — suas tarefas e comentários continuam lá."
        confirmLabel="Desconectar"
        destructive
        onCancel={() => setConfirmarDesconexao(false)}
        onConfirm={() => {
          setConfirmarDesconexao(false);
          iniciar(async () => {
            const r = await desconectarClickUp();
            toast(r.ok ? "ClickUp desconectado" : (r.error ?? "Erro"), r.ok ? "success" : "error");
          });
        }}
      />
    </Card>
  );
}

function Cabecalho() {
  return (
    <div>
      <p className="eyebrow">Integrações</p>
      <p className="text-corpo-forte font-semibold text-ink">ClickUp</p>
    </div>
  );
}

/**
 * O contrato, na tela.
 *
 * Não é enfeite: o token pessoal do ClickUp dá acesso TOTAL à conta no
 * workspace da empresa, e quem cola um aqui tem o direito de saber o que este
 * aplicativo é capaz de fazer com ele. A lista do que ele NÃO faz é mais
 * informativa que a do que faz — e é verdadeira por construção, não por
 * promessa: ver `src/lib/clickup/capabilities.ts`.
 */
function BlocoDoQueOAppFaz() {
  return (
    <div className="mt-4 rounded-md border border-line bg-surface-muted px-4 py-3">
      <p className="text-corpo font-medium text-ink">O que este aplicativo faz</p>
      <ul className="mt-1.5 space-y-0.5 text-legenda text-ink-muted">
        <li>· Lê as tarefas em que você é responsável</li>
        <li>· Muda o status dessas tarefas</li>
        <li>· Comenta nessas tarefas</li>
      </ul>
      <p className="mt-2 text-corpo font-medium text-ink">O que ele não consegue fazer</p>
      <p className="mt-1 text-legenda text-ink-subtle">
        Apagar ou criar qualquer coisa, renomear, mudar prazo ou prioridade,
        mexer em responsáveis, arquivar, mover entre listas, ou tocar em
        qualquer tarefa que não seja sua. Não é uma promessa: esses caminhos não
        existem no código.
      </p>
    </div>
  );
}
