"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/Toast";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import { cn, formatDayLabel, plural } from "@/lib/utils";
import {
  bloquearUsuario,
  criarUsuario,
  definirPapel,
  desbloquearUsuario,
  type UsuarioAdmin,
} from "@/app/(app)/admin/actions";

/**
 * A tela de administração.
 *
 * ⚠️ ELA MOSTRA METADADO, E SÓ. E-mail, quando entrou, quando apareceu pela
 * última vez, papel, bloqueio. Nenhuma tarefa, nota, lançamento ou item de
 * Cofre — nem existe caminho para isso, porque `listarUsuarios` não os busca.
 *
 * A restrição não é de tela, é de produto: administrar contas não é ler a vida
 * das pessoas. E mesmo que alguém quisesse contornar, o Cofre continuaria
 * ilegível — é cifrado com chave derivada da senha mestra do dono, e o banco
 * guarda ciphertext.
 */
export function AdminView({
  usuarios,
  erro,
  euId,
}: {
  usuarios: UsuarioAdmin[];
  erro: string | null;
  /** O master logado — para nunca oferecer a ele as ações contra si mesmo. */
  euId: string;
}) {
  const { toast } = useToast();
  const [pendente, iniciar] = useTransition();
  const [criando, setCriando] = useState(false);
  const [bloqueando, setBloqueando] = useState<UsuarioAdmin | null>(null);

  const ativos = usuarios.filter((u) => u.ativo).length;
  const bloqueados = usuarios.filter((u) => u.bloqueado).length;

  if (erro) {
    return (
      <Card className="p-6">
        <p role="alert" className="text-corpo text-danger-ink">
          {erro}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>{plural(usuarios.length, "conta", "contas")}</Badge>
          {/* "Ativo" = não bloqueado E com sessão nos últimos 30 dias. Contar só
              o login diria que alguém bloqueado ontem continua ativo. */}
          <Badge tone="outline">{ativos} ativos nos últimos 30 dias</Badge>
          {bloqueados > 0 && <Badge tone="outline">{bloqueados} bloqueados</Badge>}
        </div>
        <Button variant="primary" size="sm" onClick={() => setCriando(true)}>
          Cadastrar usuário
        </Button>
      </div>

      {usuarios.length === 0 ? (
        <EmptyState icon="User" title="Nenhuma conta ainda" />
      ) : (
        <Card className="divide-y divide-line">
          {usuarios.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  <span className="truncate font-medium">{u.displayName ?? u.email}</span>
                  {u.papel !== "user" && <Badge tone="outline">{u.papel}</Badge>}
                  {u.bloqueado && (
                    <Badge tone="outline" ponto="danger">
                      Bloqueado
                    </Badge>
                  )}
                  {u.id === euId && <Badge tone="outline">você</Badge>}
                </p>
                <p className="mt-0.5 truncate text-legenda text-ink-subtle">
                  {u.email} · entrou {formatDayLabel(u.criadoEm)} ·{" "}
                  {u.ultimoLogin ? `visto ${formatDayLabel(u.ultimoLogin)}` : "nunca entrou"}
                  {u.bloqueado && u.motivo ? ` · ${u.motivo}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/*
                  ⚠️ As ações contra SI MESMO nem são renderizadas.

                  O servidor já as recusa (ver `bloquearUsuario` e
                  `definirPapel`), e é ele quem garante — mas oferecer um botão
                  que só produz erro é ensinar a pessoa a tentar. O último
                  master também não aparece com "rebaixar", pelo mesmo motivo.
                */}
                {u.id !== euId && (
                  <>
                    <select
                      aria-label={`Papel de ${u.email}`}
                      value={u.papel}
                      disabled={pendente}
                      onChange={(e) =>
                        iniciar(async () => {
                          const r = await definirPapel({ userId: u.id, papel: e.target.value });
                          toast(
                            r.ok ? "Papel atualizado" : (r.error ?? "Erro"),
                            r.ok ? "success" : "error",
                          );
                        })
                      }
                      className={cn(CLASSE_DO_CAMPO, "text-legenda")}
                    >
                      <option value="user">Usuário</option>
                      <option value="admin">Admin</option>
                      <option value="master">Master</option>
                    </select>

                    {u.bloqueado ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendente}
                        onClick={() =>
                          iniciar(async () => {
                            const r = await desbloquearUsuario(u.id);
                            toast(
                              r.ok ? "Desbloqueado" : (r.error ?? "Erro"),
                              r.ok ? "success" : "error",
                            );
                          })
                        }
                      >
                        Desbloquear
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendente}
                        onClick={() => setBloqueando(u)}
                      >
                        Bloquear
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {criando && (
        <Modal title="Cadastrar usuário" onClose={() => setCriando(false)}>
          <FormularioDeUsuario
            onDone={() => setCriando(false)}
            onCancel={() => setCriando(false)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={bloqueando !== null}
        destructive
        title="Bloquear acesso"
        /*
          A frase diz o que acontece nas DUAS camadas, porque o efeito imediato
          é o que surpreende: a pessoa é desconectada no próximo clique, não
          quando a sessão dela expirar. Ver `bloquearUsuario`.
        */
        description={
          bloqueando
            ? `${bloqueando.email} não conseguirá entrar, e a sessão dele cai no próximo clique. Nada é apagado, e desbloquear devolve tudo.`
            : undefined
        }
        confirmLabel="Bloquear"
        onCancel={() => setBloqueando(null)}
        onConfirm={() => {
          const alvo = bloqueando;
          setBloqueando(null);
          if (!alvo) return;
          iniciar(async () => {
            const r = await bloquearUsuario({ userId: alvo.id });
            toast(r.ok ? "Acesso bloqueado" : (r.error ?? "Erro"), r.ok ? "success" : "error");
          });
        }}
      />
    </div>
  );
}

function FormularioDeUsuario({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        iniciar(async () => {
          const r = await criarUsuario({ email, senha, displayName: nome || undefined });
          if (r.ok) {
            toast("Usuário criado", "success");
            onDone();
          } else {
            setErro(r.error ?? "Erro ao criar");
          }
        });
      }}
    >
      <div>
        <label htmlFor="admin-email" className="mb-1.5 block text-corpo font-medium text-ink">
          E-mail
        </label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>

      <div>
        <label htmlFor="admin-nome" className="mb-1.5 block text-corpo font-medium text-ink">
          Nome (opcional)
        </label>
        <input
          id="admin-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>

      <div>
        <label htmlFor="admin-senha" className="mb-1.5 block text-corpo font-medium text-ink">
          Senha provisória
        </label>
        <input
          id="admin-senha"
          type="password"
          required
          minLength={12}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
        {/*
          Doze caracteres, e não os oito de praxe: esta senha é escolhida por
          UMA PESSOA e comunicada a outra por algum canal (mensagem, papel,
          voz). Ela vive mais tempo em trânsito do que uma senha que o próprio
          dono digita, e o custo de exigir mais aqui é uma linha de aviso.
        */}
        <p className="mt-1 text-legenda text-ink-subtle">
          Mínimo de 12 caracteres. Combine com a pessoa para ela trocar depois de entrar.
        </p>
      </div>

      {erro && (
        <p role="alert" className="text-corpo text-danger-ink">
          {erro}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={pendente}>
          {pendente ? "Criando…" : "Criar conta"}
        </Button>
      </div>
    </form>
  );
}
