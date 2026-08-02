"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useToast } from "@/components/ui/Toast";
import {
  createVault,
  unlockVault,
  encryptItem,
  decryptItem,
  type VaultMasterKeyMaterial,
} from "@/lib/crypto/vault";
import { GerarKit, RestaurarComKit } from "@/components/features/vault/RecoveryKit";
import { analisarLinkExterno } from "@/lib/external-link";
import {
  deleteVaultItem,
  getVaultState,
  logAudit,
  setupVault,
  upsertVaultItem,
} from "@/app/(app)/cofre/actions";
import type { VaultStatePayload } from "@/lib/action-types";
import type { VaultItemType } from "@/lib/database.types";

const AUTO_LOCK_MS = 5 * 60 * 1000;

interface ItemPayload {
  name: string;
  username?: string;
  email?: string;
  password?: string;
  url?: string;
  accountNumber?: string;
  notes?: string;
}

interface DecryptedItem {
  id: string;
  itemType: VaultItemType;
  favorite: boolean;
  data: ItemPayload;
}

const TYPE_LABEL: Record<VaultItemType, string> = {
  login: "Logins",
  account: "Contas",
  document: "Documentos",
  financial: "Financeiro",
  secure_note: "Notas seguras",
};

const TYPES = Object.keys(TYPE_LABEL) as VaultItemType[];

export function VaultClient({ initial }: { initial: VaultStatePayload }) {
  const { toast } = useToast();
  const [state, setState] = useState<VaultStatePayload>(initial);
  // dataKey lives ONLY in component memory. Never persisted, never global.
  const dataKeyRef = useRef<CryptoKey | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lock = useCallback(() => {
    dataKeyRef.current = null;
    setItems([]);
    setUnlocked(false);
    if (lockTimer.current) clearTimeout(lockTimer.current);
    void logAudit("locked");
  }, []);

  // Auto-lock after inactivity.
  const resetLockTimer = useCallback(() => {
    if (!unlocked) return;
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(lock, AUTO_LOCK_MS);
  }, [unlocked, lock]);

  useEffect(() => {
    if (!unlocked) return;
    resetLockTimer();
    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetLockTimer, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetLockTimer));
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
  }, [unlocked, resetLockTimer]);

  async function decryptAll(key: CryptoKey, payload: VaultStatePayload) {
    const decrypted: DecryptedItem[] = [];
    for (const it of payload.items) {
      try {
        const data = await decryptItem<ItemPayload>(
          { ciphertextB64: it.ciphertextB64, ivB64: it.ivB64 },
          key,
        );
        decrypted.push({
          id: it.id,
          itemType: it.itemType as VaultItemType,
          favorite: it.favorite,
          data,
        });
      } catch {
        /* skip undecryptable item */
      }
    }
    setItems(decrypted);
  }

  async function refreshFromServer(key: CryptoKey) {
    const fresh = await getVaultState();
    setState(fresh);
    await decryptAll(key, fresh);
  }

  if (!unlocked) {
    return (
      <LockedView
        hasMasterKey={state.hasMasterKey}
        onUnlock={async (key) => {
          dataKeyRef.current = key;
          setUnlocked(true);
          await decryptAll(key, state);
          void logAudit("unlocked");
        }}
        master={state.master}
      />
    );
  }

  const key = dataKeyRef.current!;
  return (
    <UnlockedView
      items={items}
      dataKey={key}
      onLock={lock}
      onChanged={() => refreshFromServer(key)}
      toast={toast}
    />
  );
}

/* ------------------------------------------------------------------ Locked */

function LockedView({
  hasMasterKey,
  master,
  onUnlock,
}: {
  hasMasterKey: boolean;
  master: VaultStatePayload["master"];
  onUnlock: (key: CryptoKey) => Promise<void>;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Etapa da tela de criação do cofre.
   *   `senha`     — formulário de senha mestra (ou de desbloqueio)
   *   `kit`       — logo após criar: oferecer e PROVAR o kit de recuperação
   *   `sem-kit`   — o usuário optou por não gerar; a tela passa a dizer a verdade
   *   `restaurar` — cofre existente, senha mestra perdida, recuperação por kit
   */
  const [etapa, setEtapa] = useState<"senha" | "kit" | "sem-kit" | "restaurar">("senha");

  /**
   * Chave de dados recém-criada, aguardando o usuário confirmar que guardou o
   * kit antes de entrar no cofre.
   *
   * Antes isto era uma closure publicada em `window.__sbEnter` — e nunca
   * apagada. Qualquer script na origem (extensão do navegador, XSS, console
   * numa sessão aberta) alcançava a chave, e ela sobrevivia ao auto-lock:
   * o `lock()` zerava o ref, mas a função global continuava viva e reabria o
   * cofre sem a senha. `window` é um objeto compartilhado com todo código da
   * página; material criptográfico não pode passar por lá.
   */
  const pendingKeyRef = useRef<CryptoKey | null>(null);

  // Não deixa a chave sobreviver à saída da tela.
  useEffect(() => {
    return () => {
      pendingKeyRef.current = null;
    };
  }, []);

  async function handleUnlock() {
    if (!master) return;
    setBusy(true);
    setError(null);
    try {
      const key = await unlockVault(password, master as unknown as VaultMasterKeyMaterial);
      setPassword("");
      await onUnlock(key);
    } catch {
      setError("Senha mestra incorreta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (password.length < 8) return setError("Use ao menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setBusy(true);
    setError(null);
    try {
      const { material, dataKey } = await createVault(password);
      const res = await setupVault({
        ...material,
        kdfParameters: material.kdfParameters as unknown as Record<string, unknown>,
      });
      if (!res.ok) {
        setError(res.error ?? "Falha ao criar o cofre.");
        setBusy(false);
        return;
      }
      setPassword("");
      setConfirm("");
      toast("Cofre criado", "success");
      // Guarda em memória local do componente até o usuário confirmar.
      pendingKeyRef.current = dataKey;
      setEtapa("kit");
    } catch {
      setError("Não foi possível criar o cofre.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Consome a chave pendente e zera o ref no mesmo passo: depois daqui ela não
   * existe mais fora do estado do cofre destravado.
   */
  function entrarNoCofre() {
    const key = pendingKeyRef.current;
    pendingKeyRef.current = null;
    if (key) void onUnlock(key);
  }

  /**
   * Depois de criar o cofre: oferecer o kit de recuperação — e PROVÁ-LO.
   *
   * Esta tela já exibiu um "kit de recuperação" que era um código de 28
   * caracteres e mais nada. **A promessa era falsa.** `exportRecoveryKit()`
   * devolve DUAS partes — o código E o material com a chave de dados
   * reembrulhada (sal, IV, parâmetros). A interface mostrava o código e
   * descartava o material, que nunca era gravado em lugar nenhum. Código sem
   * material não desembrulha coisa alguma; o efeito prático era pior que não ter
   * recuperação, porque alguém confiaria no papel e trataria a senha mestra como
   * descartável.
   *
   * Agora as duas metades existem: o material vira arquivo `.json` que o
   * navegador baixa, e o `GerarKit` só declara que há recuperação depois de LER
   * esse arquivo de volta do disco e conferir, byte a byte, que a chave que sai
   * dele é a mesma que está viva na aba. A promessa aparece porque foi
   * executada, não porque alguém afirmou que funcionava.
   */
  if (etapa === "kit" && pendingKeyRef.current) {
    return (
      <Card className="mx-auto max-w-lg p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-ink">
            <Icon.Lock width={20} height={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">Cofre criado</h2>
            <p className="text-corpo text-ink-subtle">
              Guarde a senha mestra num gerenciador de senhas. Depois, gere o kit de recuperação.
            </p>
          </div>
        </div>
        <GerarKit
          dataKey={pendingKeyRef.current}
          onConcluir={entrarNoCofre}
          onPular={() => setEtapa("sem-kit")}
          rotuloPular="Seguir sem kit"
        />
      </Card>
    );
  }

  /**
   * Saída sem kit. A tela volta a dizer a verdade — a mesma frase de antes,
   * porque para quem não gera o kit ela continua sendo exata.
   */
  if (etapa === "sem-kit") {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink">
          <Icon.Lock width={20} height={20} />
        </div>
        <h2 className="text-lg font-semibold text-ink">Sem kit de recuperação</h2>

        <div className="my-4 rounded-md border border-line bg-surface-muted px-4 py-3 text-left">
          <p className="text-corpo font-medium text-ink">
            Não existe recuperação. Esqueceu a senha, perdeu o cofre.
          </p>
          <p className="mt-1 text-legenda text-ink-subtle">
            O cofre é cifrado no seu navegador com uma chave derivada da senha mestra. Ela não é
            enviada nem guardada em lugar nenhum — nem aqui, nem no servidor. É isso que impede
            qualquer outra pessoa de abrir o cofre, e é isso que torna a perda definitiva. Você pode
            gerar o kit depois, pelo painel do cofre destravado.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEtapa("kit")}>
            Gerar kit agora
          </Button>
          <Button variant="primary" size="sm" onClick={entrarNoCofre}>
            Guardei a senha — abrir cofre
          </Button>
        </div>
      </Card>
    );
  }

  if (etapa === "restaurar") {
    return (
      <Card className="mx-auto max-w-lg p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-ink">
            <Icon.Lock width={20} height={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">Recuperar com o kit</h2>
            <p className="text-corpo text-ink-subtle">
              Para quando a senha mestra se perdeu.
            </p>
          </div>
        </div>
        <RestaurarComKit
          onCancelar={() => setEtapa("senha")}
          onRestaurado={async (key) => {
            toast("Cofre recuperado", "success");
            await onUnlock(key);
          }}
        />
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink">
          <Icon.Lock width={20} height={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {hasMasterKey ? "Cofre bloqueado" : "Criar cofre"}
          </h2>
          <p className="text-corpo text-ink-subtle">
            {hasMasterKey
              ? "Use sua senha mestra para visualizar informações sensíveis."
              : "Defina uma senha mestra. Ela não é recuperável pelo servidor."}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="master" className="mb-1.5 block text-corpo font-medium text-ink">
            Senha mestra
          </label>
          <input
            id="master"
            type="password"
            autoComplete={hasMasterKey ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && hasMasterKey && handleUnlock()}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          />
        </div>
        {!hasMasterKey && (
          <div>
            <label htmlFor="confirm" className="mb-1.5 block text-corpo font-medium text-ink">
              Confirmar senha mestra
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-corpo text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy || !password}
          onClick={hasMasterKey ? handleUnlock : handleCreate}
        >
          {busy ? "Processando…" : hasMasterKey ? "Desbloquear cofre" : "Criar cofre"}
        </Button>

        {/* O texto é condicional de propósito: "tenho o kit" não afirma que
            existe um. Quem nunca gerou não encontra promessa nenhuma aqui —
            encontra a tela de recuperação dizendo que precisa das duas metades,
            que é a informação exata para essa pessoa. */}
        {hasMasterKey && (
          <button
            type="button"
            onClick={() => setEtapa("restaurar")}
            className="block w-full text-center text-corpo text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2"
          >
            Esqueci a senha mestra — tenho o kit de recuperação
          </button>
        )}

        <p className="text-center text-legenda text-ink-subtle">
          A descriptografia acontece somente no seu navegador (Argon2id + AES-256-GCM).
        </p>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- Unlocked */

function UnlockedView({
  items,
  dataKey,
  onLock,
  onChanged,
  toast,
}: {
  items: DecryptedItem[];
  dataKey: CryptoKey;
  onLock: () => void;
  onChanged: () => Promise<void>;
  toast: (m: string, t?: "default" | "success" | "error") => void;
}) {
  const [filter, setFilter] = useState<VaultItemType | "all">("all");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DecryptedItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DecryptedItem | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [kitOpen, setKitOpen] = useState(false);
  const [, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => filter === "all" || i.itemType === filter)
      .filter(
        (i) =>
          !q ||
          i.data.name.toLowerCase().includes(q) ||
          (i.data.username ?? "").toLowerCase().includes(q) ||
          (i.data.email ?? "").toLowerCase().includes(q),
      );
  }, [items, filter, query]);

  function copy(value: string | undefined, label: string) {
    if (!value) return;
    void navigator.clipboard.writeText(value); // value never passed to toast/logs
    toast(`${label} copiado`, "success");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative">
            <Icon.Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              width={16}
              height={16}
            />
            <input
              placeholder="Buscar no cofre"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-64 rounded-md border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink focus-visible:outline-2"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onLock}>
              <Icon.Lock width={14} height={14} /> Bloquear
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Icon.Capture width={15} height={15} /> Novo item
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-1.5">
          <PillButton active={filter === "all"} onClick={() => setFilter("all")}>
            Todos
          </PillButton>
          {TYPES.map((t) => (
            <PillButton key={t} active={filter === t} onClick={() => setFilter(t)}>
              {TYPE_LABEL[t]}
            </PillButton>
          ))}
        </div>

        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState icon="Vault" title="Nenhum item" description="Adicione um login, conta ou nota segura." />
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((item) => (
                <li key={item.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-legenda font-semibold text-ink">
                        {item.data.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{item.data.name}</p>
                        <p className="truncate text-legenda text-ink-subtle">
                          {item.data.username || item.data.email || item.data.accountNumber || "—"}
                        </p>
                      </div>
                    </div>
                    <Badge tone="outline">{TYPE_LABEL[item.itemType]}</Badge>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-12">
                    {item.data.password && (
                      <>
                        <code className="rounded-sm bg-surface-muted px-2 py-1 text-legenda text-ink">
                          {reveal[item.id] ? item.data.password : "••••••••"}
                        </code>
                        <IconBtn
                          label={reveal[item.id] ? "Ocultar senha" : "Revelar senha"}
                          onClick={() => setReveal((r) => ({ ...r, [item.id]: !r[item.id] }))}
                        >
                          {reveal[item.id] ? <Icon.EyeOff width={14} height={14} /> : <Icon.Eye width={14} height={14} />}
                        </IconBtn>
                        <IconBtn label="Copiar senha" onClick={() => copy(item.data.password, "Senha")}>
                          <Icon.Copy width={14} height={14} />
                        </IconBtn>
                      </>
                    )}
                    {item.data.username && (
                      <IconBtn label="Copiar usuário" onClick={() => copy(item.data.username, "Usuário")}>
                        <span className="text-meta">Usuário</span>
                      </IconBtn>
                    )}
                    {/*
                      "Abrir site" era texto fixo para qualquer coisa gravada no
                      campo URL — inclusive `javascript:…`, que executaria script
                      na origem DO COFRE, com a chave de dados viva na memória
                      desta aba. Não é conteúdo de terceiro como o convite de
                      agenda, mas o campo aceita colagem, e o custo de um engano
                      aqui é o cofre inteiro.

                      Agora o destino é mostrado. Link recusado por
                      `analisarLinkExterno` (não-https, credencial embutida, host
                      sem ponto) simplesmente não vira link.
                    */}
                    {(() => {
                      const site = analisarLinkExterno(item.data.url);
                      if (!site) return null;
                      return (
                        <a
                          href={site.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={site.href}
                          className="text-legenda text-ink-muted hover:text-ink hover:underline"
                        >
                          {site.hostname}
                        </a>
                      );
                    })()}
                    <div className="ml-auto flex gap-1">
                      <IconBtn
                        label="Editar"
                        onClick={() => {
                          setEditing(item);
                          setFormOpen(true);
                        }}
                      >
                        <span className="text-meta">Editar</span>
                      </IconBtn>
                      <IconBtn label="Excluir" danger onClick={() => setDeleteTarget(item)}>
                        <Icon.Trash width={14} height={14} />
                      </IconBtn>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Side panel */}
      <div className="space-y-4">
        <Card className="p-5">
          <p className="eyebrow mb-2">Sessão do cofre</p>
          <p className="text-corpo text-ink-muted">
            Bloqueio automático após 5 minutos de inatividade. Os dados descriptografados existem
            apenas na memória desta aba.
          </p>
        </Card>
        <Card className="p-5">
          <p className="eyebrow mb-2">Itens</p>
          <p className="text-3xl font-semibold text-ink">{items.length}</p>
          <p className="text-legenda text-ink-subtle">protegidos com AES-256-GCM</p>
        </Card>

        {/*
          Entrada do kit para quem JÁ TEM cofre.
          Sem isto, o recurso só existiria para cofres criados depois desta
          mudança — e o cofre que corre risco hoje é justamente o que já foi
          criado sem kit nenhum. Aqui a chave de dados está viva na aba, que é a
          única condição necessária para reembrulhá-la.
        */}
        <Card className="p-5">
          <p className="eyebrow mb-2">Kit de recuperação</p>
          <p className="text-corpo text-ink-muted">
            Um arquivo <code className="text-legenda">.json</code> mais um código que, juntos, abrem
            o cofre se a senha mestra se perder.
          </p>
          <p className="mt-2 text-legenda text-ink-subtle">
            Gerar um kit novo <span className="font-medium text-ink-muted">não invalida</span> os
            anteriores: cada kit embrulha a mesma chave de dados sob o próprio código. Apague os
            arquivos antigos que não quiser mais por aí.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => setKitOpen(true)}
          >
            <Icon.Download width={14} height={14} /> Gerar kit de recuperação
          </Button>
        </Card>
      </div>

      {kitOpen && (
        <Modal title="Kit de recuperação" onClose={() => setKitOpen(false)}>
          <GerarKit
            dataKey={dataKey}
            onConcluir={() => setKitOpen(false)}
            onPular={() => setKitOpen(false)}
            rotuloPular="Fechar"
          />
        </Modal>
      )}

      {formOpen && (
        <Modal
          title={editing ? "Editar item" : "Novo item"}
          onClose={() => setFormOpen(false)}
        >
          <VaultItemForm
            item={editing}
            onCancel={() => setFormOpen(false)}
            onSave={async (itemType, payload, id) => {
              const enc = await encryptItem(payload, dataKey);
              const res = await upsertVaultItem({
                id,
                itemType,
                ciphertextB64: enc.ciphertextB64,
                ivB64: enc.ivB64,
                favorite: false,
              });
              if (res.ok) {
                toast("Item salvo", "success");
                setFormOpen(false);
                await onChanged();
              } else {
                toast(res.error ?? "Erro", "error");
              }
            }}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={deleteTarget !== null}
        title="Excluir item"
        description={`"${deleteTarget?.data.name ?? ""}" será removido do cofre.`}
        confirmLabel="Excluir"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          start(async () => {
            const r = await deleteVaultItem(target.id);
            if (r.ok) {
              toast("Item excluído", "success");
              await onChanged();
            } else {
              toast(r.error ?? "Erro", "error");
            }
          });
        }}
      />
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong px-2 text-ink-muted hover:bg-surface-muted ${
        danger ? "hover:text-red-600 dark:hover:text-red-400" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function VaultItemForm({
  item,
  onSave,
  onCancel,
}: {
  item: DecryptedItem | null;
  onSave: (type: VaultItemType, payload: ItemPayload, id?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<VaultItemType>(item?.itemType ?? "login");
  const [data, setData] = useState<ItemPayload>(item?.data ?? { name: "" });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof ItemPayload>(k: K, v: string) {
    setData((d) => ({ ...d, [k]: v }));
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!data.name.trim()) return;
        setBusy(true);
        await onSave(type, data, item?.id);
        setBusy(false);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome do serviço" required value={data.name} onChange={(v) => set("name", v)} />
        <div>
          <label className="mb-1.5 block text-corpo font-medium text-ink">Tipo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as VaultItemType)}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Usuário" value={data.username ?? ""} onChange={(v) => set("username", v)} />
        <Field label="E-mail" value={data.email ?? ""} onChange={(v) => set("email", v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Senha" type="password" value={data.password ?? ""} onChange={(v) => set("password", v)} />
        <Field label="Número da conta" value={data.accountNumber ?? ""} onChange={(v) => set("accountNumber", v)} />
      </div>
      <Field label="URL" value={data.url ?? ""} onChange={(v) => set("url", v)} />
      <div>
        <label className="mb-1.5 block text-corpo font-medium text-ink">Observações</label>
        <textarea
          rows={2}
          value={data.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={busy}>
          {busy ? "Salvando…" : "Salvar item"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-corpo font-medium text-ink">{label}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
      />
    </div>
  );
}
