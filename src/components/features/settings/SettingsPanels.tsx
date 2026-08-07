"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import { CSS } from "@dnd-kit/utilities";
import { useSensoresDeArrastar } from "@/components/ui/arrastar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PillButton } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { SocialLinkIcon } from "@/components/features/social/SocialLinkIcon";
import { MODULES } from "@/lib/modules";
import { LEAD_MINUTE_OPTIONS, TAMANHO_MAXIMO_DO_LABEL } from "@/lib/validation";
import { LIMITE_DE_LINKS, TAMANHO_MAXIMO_DA_URL, urlSegura } from "@/lib/social";
import type { SocialLink } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import {
  updateProfile,
  updateAvatar,
  removeAvatar,
  toggleModule,
  updateNotificationPreferences,
  toggleFinanceHideValues,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink,
  reorderSocialLinks,
} from "@/app/(app)/configuracoes/actions";

/* ------------------------------------------------------------------- perfil */

export function ProfilePanel({
  displayName,
  email,
  avatarUrl,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(displayName);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Redimensiona no navegador antes de enviar: evita subir um JPEG de 8 MB do
   * celular e dispensa processamento de imagem no servidor.
   */
  async function resizeToWebp(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const max = 512;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar a imagem"))),
        "image/webp",
        0.85,
      );
    });
  }

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast("Escolha uma imagem de até 5 MB.", "error");
      return;
    }
    setUploading(true);
    try {
      const blob = await resizeToWebp(file);
      const fd = new FormData();
      fd.append("file", new File([blob], "avatar.webp", { type: "image/webp" }));
      const r = await updateAvatar(fd);
      if (r.ok) {
        toast("Foto atualizada", "success");
        router.refresh();
      } else {
        toast(r.error ?? "Erro ao enviar", "error");
      }
    } catch {
      toast("Não foi possível processar a imagem.", "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-corpo-forte font-semibold text-ink">Perfil</h2>
      <p className="mt-1 text-corpo text-ink-subtle">
        O nome aparece na saudação da tela Início.
      </p>

      <div className="mt-4 flex items-center gap-4">
        <Avatar name={name || displayName} url={avatarUrl} size={64} />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Icon.Upload width={14} height={14} />
            {uploading ? "Enviando…" : "Trocar foto"}
          </Button>
          {avatarUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                start(async () => {
                  const r = await removeAvatar();
                  if (r.ok) {
                    toast("Foto removida", "success");
                    router.refresh();
                  } else toast(r.error ?? "Erro", "error");
                })
              }
            >
              Remover
            </Button>
          )}
        </div>
      </div>

      <form
        className="mt-5 space-y-3"
        action={(fd) =>
          start(async () => {
            const r = await updateProfile(fd);
            if (r.ok) {
              toast("Perfil atualizado", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          })
        }
      >
        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-corpo font-medium text-ink">
            Nome exibido
          </label>
          <input
            id="displayName"
            name="displayName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            className={cn(CLASSE_DO_CAMPO, "w-full max-w-sm")}
          />
          <p className="mt-1.5 text-legenda text-ink-subtle">
            Prévia: <span className="text-ink">Bom dia, {name.trim() || "…"}.</span>
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-corpo font-medium text-ink">E-mail</label>
          <input
            value={email}
            disabled
            className={cn(CLASSE_DO_CAMPO, "w-full max-w-sm")}
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ módulos */

export function ModulesPanel({ enabled }: { enabled: string[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const enabledSet = new Set(enabled);

  return (
    <Card className="p-6">
      <h2 className="text-corpo-forte font-semibold text-ink">Abas</h2>
      <p className="mt-1 text-corpo text-ink-subtle">
        Desative o que não usa. Abas essenciais não podem ser removidas.
      </p>

      <ul className="mt-4 divide-y divide-line">
        {MODULES.map((m) => {
          const on = enabledSet.has(m.key);
          const Glyph = Icon[m.icon];
          return (
            <li key={m.key} className="flex items-center gap-3 py-3">
              <Glyph width={18} height={18} className="shrink-0 text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {m.label}
                  {m.core && (
                    <span className="ml-2 text-meta font-normal text-ink-subtle">essencial</span>
                  )}
                </p>
                <p className="text-legenda text-ink-subtle">{m.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? "Desativar" : "Ativar"} ${m.label}`}
                disabled={m.core}
                onClick={() =>
                  start(async () => {
                    const r = await toggleModule(m.key, !on);
                    if (r.ok) router.refresh();
                    else toast(r.error ?? "Erro", "error");
                  })
                }
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  on ? "bg-accent" : "bg-line-strong"
                } ${m.core ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${
                    on ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------- notificações */

export function NotificationsPanel({
  enabled,
  leadMinutes,
  channel,
}: {
  enabled: boolean;
  leadMinutes: number[];
  channel: "in_app" | "push" | "both";
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [on, setOn] = useState(enabled);
  const [leads, setLeads] = useState<number[]>(leadMinutes);
  const [permission, setPermission] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );

  function persist(next: { enabled?: boolean; leads?: number[] }) {
    const payload = {
      notificationsEnabled: next.enabled ?? on,
      leadMinutes: next.leads ?? leads,
      channel,
    };
    start(async () => {
      const r = await updateNotificationPreferences(payload);
      if (r.ok) router.refresh();
      else toast(r.error ?? "Erro", "error");
    });
  }

  function toggleLead(minutes: number) {
    const has = leads.includes(minutes);
    let next = has ? leads.filter((l) => l !== minutes) : [...leads, minutes];
    if (next.length === 0) {
      toast("Mantenha ao menos uma antecedência.", "error");
      return;
    }
    if (next.length > 3) next = next.slice(-3);
    setLeads(next);
    persist({ leads: next });
  }

  return (
    <Card className="p-6">
      <h2 className="text-corpo-forte font-semibold text-ink">Notificações de reunião</h2>
      <p className="mt-1 text-corpo text-ink-subtle">
        Aviso antes dos eventos do Google Calendar.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-ink">Avisar sobre reuniões</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Ativar notificações"
          onClick={() => {
            const next = !on;
            setOn(next);
            persist({ enabled: next });
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            on ? "bg-accent" : "bg-line-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${
              on ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {on && (
        <>
          <p className="mt-5 mb-2 text-corpo font-medium text-ink">
            Antecedência <span className="font-normal text-ink-subtle">(até 3)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_MINUTE_OPTIONS.map((m) => (
              <PillButton key={m} active={leads.includes(m)} onClick={() => toggleLead(m)}>
                {m === 0 ? "Na hora" : m < 60 ? `${m} min` : `${m / 60} h`}
              </PillButton>
            ))}
          </div>

          <div className="mt-5 rounded-md border border-line bg-surface-muted p-3">
            <p className="text-legenda text-ink-muted">
              <strong className="text-ink">Permissão do navegador:</strong>{" "}
              {permission === "granted"
                ? "concedida"
                : permission === "denied"
                  ? "negada (libere nas configurações do navegador)"
                  : "não solicitada"}
            </p>
            {permission === "default" && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={async () => {
                  const p = await Notification.requestPermission();
                  setPermission(p);
                  if (p === "granted") {
                    new Notification("Segundo Cérebro", {
                      body: "Notificações ativadas com sucesso.",
                    });
                  }
                }}
              >
                Permitir e testar
              </Button>
            )}
            {permission === "granted" && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() =>
                  new Notification("Segundo Cérebro", {
                    body: "Exemplo: sua reunião começa em 15 min.",
                  })
                }
              >
                Enviar notificação de teste
              </Button>
            )}
          </div>

          <p className="mt-3 text-legenda text-ink-subtle">
            O aviso funciona com a aplicação aberta. Notificar com o navegador
            fechado exige Web Push (fase seguinte). Os lembretes também dependem
            da última sincronização do Calendário — reuniões criadas há poucos
            minutos podem ainda não estar em cache.
          </p>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ redes sociais */

/**
 * O que a lista precisa saber de cada link. `position` NÃO entra: a ordem é a
 * do array, e guardar o número junto criaria duas fontes de verdade que se
 * contradizem no primeiro arrastar (o array já reordenado e o número antigo).
 */
interface ItemDeLink {
  id: string;
  label: string;
  url: string;
}

/**
 * Painel dos links do perfil: adicionar, editar, remover e reordenar.
 *
 * ACESSIBILIDADE DO ARRASTAR — a decisão desta tela. Arrastar-e-soltar sem
 * alternativa exclui quem não usa mouse: teclado, leitor de tela, controle
 * adaptativo, ou simplesmente quem está numa tela sensível ao toque com a mão
 * ocupada. Aqui a alternativa é o `KeyboardSensor` do dnd-kit, o mesmo do Kanban
 * (src/components/features/tasks/TaskBoard.tsx), e ele está IMPLEMENTADO DE
 * VERDADE, não só declarado:
 *
 *   - a alça de arrastar é um `<button>` de verdade, então entra na ordem de
 *     tabulação sozinha (um `<div>` com `onPointerDown` não entraria, e o sensor
 *     de teclado nunca receberia o foco para começar);
 *   - `sortableKeyboardCoordinates` traduz as setas em movimento entre irmãos;
 *   - os anúncios e as instruções de leitor de tela estão em PORTUGUÊS. O padrão
 *     do dnd-kit é em inglês, e uma pessoa cega ouviria "Draggable item was
 *     dropped over droppable area" no meio de uma interface em português. Como
 *     esse texto é a ÚNICA pista de que a operação funcionou (não há nada visual
 *     para quem não vê), traduzi-lo não é polimento: é a metade da função.
 *
 * ESTADO LOCAL COMO FONTE DA TELA: `items` é semeado das props e atualizado a
 * cada operação bem-sucedida. O `router.refresh()` mantém a Início coerente, mas
 * a lista não espera por ele — arrastar e ver o item voltar ao lugar por meio
 * segundo até o servidor responder é a pior sensação possível num controle de
 * ordenação.
 */
export function SocialLinksPanel({ links }: { links: SocialLink[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pendente, start] = useTransition();
  const [items, setItems] = useState<ItemDeLink[]>(() =>
    links.map((l) => ({ id: l.id, label: l.label, url: l.url })),
  );
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const cheio = items.length >= LIMITE_DE_LINKS;

  // Os mesmos sensores do Kanban, agora de um lugar só. A distância mínima de
  // ativação — que evita que um clique no botão de remover, dentro da linha,
  // vire início de arrasto — está documentada lá.
  const sensors = useSensoresDeArrastar();

  function rotuloDe(id: string): string {
    return items.find((i) => i.id === id)?.label ?? "link";
  }

  function adicionar(label: string, url: string) {
    start(async () => {
      const r = await createSocialLink({ label, url });
      const novoId = r.id;
      if (!r.ok || !novoId) {
        toast(r.error ?? "Não foi possível adicionar", "error");
        return;
      }
      // A `url` que chega aqui já passou por `urlSegura` no formulário, então é
      // a MESMA forma canônica que o servidor acabou de gravar. Guardar o texto
      // cru digitado faria a lista mostrar "instagram.com/eu" enquanto o banco
      // tem "https://instagram.com/eu", e a divergência só apareceria no
      // próximo carregamento.
      setItems((atual) => [...atual, { id: novoId, label, url }]);
      toast("Link adicionado", "success");
      router.refresh();
    });
  }

  function salvarEdicao(id: string, label: string, url: string) {
    start(async () => {
      const r = await updateSocialLink({ id, label, url });
      if (!r.ok) {
        toast(r.error ?? "Não foi possível salvar", "error");
        return;
      }
      setItems((atual) => atual.map((i) => (i.id === id ? { ...i, label, url } : i)));
      setEditandoId(null);
      toast("Link atualizado", "success");
      router.refresh();
    });
  }

  function remover(id: string) {
    const anterior = items;
    setItems((atual) => atual.filter((i) => i.id !== id));
    start(async () => {
      const r = await deleteSocialLink(id);
      if (!r.ok) {
        setItems(anterior);
        toast(r.error ?? "Não foi possível remover", "error");
        return;
      }
      router.refresh();
    });
  }

  function aoSoltar(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over || active.id === over.id) return;

    const de = items.findIndex((i) => i.id === active.id);
    const para = items.findIndex((i) => i.id === over.id);
    if (de < 0 || para < 0) return;

    const anterior = items;
    const nova = arrayMove(items, de, para);
    setItems(nova);

    start(async () => {
      // A ordem inteira vai numa chamada só, e a action a grava numa instrução
      // só — ver o comentário de `reorderSocialLinks`. Se o servidor recusar,
      // a lista volta ao estado exato de antes do arrasto.
      const r = await reorderSocialLinks(nova.map((i) => i.id));
      if (!r.ok) {
        setItems(anterior);
        toast(r.error ?? "Não foi possível salvar a ordem", "error");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-corpo-forte font-semibold text-ink">Links do perfil</h2>
          <p className="mt-1 text-corpo text-ink-subtle">
            Aparecem no fim da tela Início. Só endereços https.
          </p>
        </div>
        <span className="shrink-0 text-legenda text-ink-subtle">
          {items.length} de {LIMITE_DE_LINKS}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-line py-6 text-center text-corpo text-ink-subtle">
          Nenhum link ainda.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={aoSoltar}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Para reordenar, pressione espaço ou Enter na alça de arrastar. " +
                "Use as setas para cima e para baixo para mover o link. " +
                "Pressione espaço ou Enter de novo para soltar, ou Esc para cancelar.",
            },
            announcements: {
              onDragStart: ({ active }) => `Pegou o link ${rotuloDe(String(active.id))}.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `Link ${rotuloDe(String(active.id))} sobre ${rotuloDe(String(over.id))}.`
                  : `Link ${rotuloDe(String(active.id))} fora da lista.`,
              onDragEnd: ({ active, over }) =>
                over
                  ? `Link ${rotuloDe(String(active.id))} solto na posição de ${rotuloDe(String(over.id))}.`
                  : `Link ${rotuloDe(String(active.id))} voltou ao lugar.`,
              onDragCancel: ({ active }) =>
                `Movimento cancelado. O link ${rotuloDe(String(active.id))} continua onde estava.`,
            },
          }}
        >
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="mt-4 divide-y divide-line">
              {items.map((item) =>
                editandoId === item.id ? (
                  <li key={item.id} className="py-3">
                    <FormularioDeLink
                      labelInicial={item.label}
                      urlInicial={item.url}
                      textoDoBotao="Salvar"
                      pendente={pendente}
                      onEnviar={(label, url) => salvarEdicao(item.id, label, url)}
                      onCancelar={() => setEditandoId(null)}
                    />
                  </li>
                ) : (
                  <LinhaDeLink
                    key={item.id}
                    item={item}
                    onEditar={() => setEditandoId(item.id)}
                    onRemover={() => remover(item.id)}
                  />
                ),
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div className="mt-4 border-t border-line pt-4">
        {cheio ? (
          <p className="text-legenda text-ink-subtle">
            Você chegou ao limite de {LIMITE_DE_LINKS} links. Remova um para adicionar outro.
          </p>
        ) : (
          <FormularioDeLink
            // A chave muda a cada adição para o formulário voltar vazio: sem
            // ela, o React reaproveita o estado dos campos e o rótulo anterior
            // continua escrito depois de salvar.
            key={items.length}
            labelInicial=""
            urlInicial=""
            textoDoBotao="Adicionar"
            pendente={pendente}
            onEnviar={adicionar}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * Uma linha da lista, arrastável.
 *
 * A alça (`{...attributes} {...listeners}`) fica num BOTÃO PRÓPRIO, e não na
 * linha inteira como no Kanban. O motivo é concreto: a linha tem os botões de
 * editar e remover dentro dela, e com os ouvintes de arrasto na linha toda o
 * `pointerdown` sobre "Remover" começaria um arrasto — o clique só chegaria ao
 * botão se a pessoa não movesse o dedo nenhum pixel. Separando a alça, cada
 * gesto tem um alvo só.
 */
function LinhaDeLink({
  item,
  onEditar,
  onRemover,
}: {
  item: ItemDeLink;
  onEditar: () => void;
  onRemover: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 py-2.5", isDragging && "opacity-40")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        // Depois do spread de propósito: `attributes` traz
        // `aria-roledescription`, e o nome acessível precisa dizer QUAL link
        // está sendo movido — "sortable" sozinho não ajuda ninguém.
        aria-label={`Reordenar ${item.label}`}
        className="alvo-44 shrink-0 cursor-grab rounded-sm p-1 text-ink-subtle hover:text-ink active:cursor-grabbing"
      >
        <Icon.Dots width={16} height={16} className="rotate-90" />
      </button>

      <SocialLinkIcon url={item.url} className="shrink-0 text-ink-muted" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.label}</p>
        <p className="truncate text-legenda text-ink-subtle">{item.url}</p>
      </div>

      <Button variant="ghost" size="sm" onClick={onEditar} aria-label={`Editar ${item.label}`}>
        Editar
      </Button>
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Remover ${item.label}`}
        className="alvo-44 shrink-0 rounded-sm p-1.5 text-ink-subtle hover:text-danger-ink"
      >
        <Icon.Trash width={16} height={16} />
      </button>
    </li>
  );
}

/**
 * Formulário de link, usado tanto para adicionar quanto para editar.
 *
 * A CONFERÊNCIA DA URL ACONTECE AQUI COM A MESMA FUNÇÃO DO SERVIDOR. `urlSegura`
 * é pura e não importa zod (é o motivo de ela morar em `social.ts` e não em
 * `validation.ts`), então roda no navegador sem arrastar nada para o pacote.
 *
 * Isto NÃO é a barreira de segurança — a barreira é o schema na server action e
 * o CHECK do banco, e as duas continuam valendo mesmo que alguém desligue o
 * JavaScript ou chame a action direto. O que se ganha aqui é a mensagem na hora,
 * com o texto idêntico ao que o servidor devolveria, sem uma ida e volta para
 * descobrir que faltou o domínio.
 *
 * `type="url"` NÃO é usado no input de propósito: a validação nativa do
 * navegador aceita `javascript:alert(1)` como URL válida (ela só verifica a
 * sintaxe), então ela daria a impressão de proteger sem proteger. O campo é
 * `type="text"` e quem decide é `urlSegura`.
 */
function FormularioDeLink({
  labelInicial,
  urlInicial,
  textoDoBotao,
  pendente,
  onEnviar,
  onCancelar,
}: {
  labelInicial: string;
  urlInicial: string;
  textoDoBotao: string;
  pendente: boolean;
  onEnviar: (label: string, url: string) => void;
  onCancelar?: () => void;
}) {
  const [label, setLabel] = useState(labelInicial);
  const [url, setUrl] = useState(urlInicial);
  const [erro, setErro] = useState<string | null>(null);

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const rotulo = label.trim();
    if (rotulo.length === 0) {
      setErro("Informe um rótulo");
      return;
    }
    const conferida = urlSegura(url);
    if (!conferida.ok) {
      setErro(conferida.motivo);
      return;
    }
    setErro(null);
    // Sobe a forma CANÔNICA, não o texto digitado: é o que o banco vai guardar.
    onEnviar(rotulo, conferida.url);
  }

  return (
    <form onSubmit={enviar} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={TAMANHO_MAXIMO_DO_LABEL}
          placeholder="Rótulo (ex.: Meu GitHub)"
          aria-label="Rótulo do link"
          className={cn(CLASSE_DO_CAMPO, "w-full min-w-0 sm:w-40")}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={TAMANHO_MAXIMO_DA_URL}
          inputMode="url"
          placeholder="https://instagram.com/voce"
          aria-label="Endereço do link"
          className={cn(CLASSE_DO_CAMPO, "w-full min-w-0 flex-1")}
        />
      </div>
      {erro && (
        <p role="alert" className="text-legenda text-danger-ink">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pendente}>
          {pendente ? "Salvando…" : textoDoBotao}
        </Button>
        {onCancelar && (
          <Button variant="ghost" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- privacidade */

export function PrivacyPanel({ hideValues }: { hideValues: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [hide, setHide] = useState(hideValues);

  return (
    <Card className="p-6">
      <h2 className="text-corpo-forte font-semibold text-ink">Privacidade</h2>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink">Ocultar valores financeiros</p>
          <p className="mt-0.5 text-legenda text-ink-subtle">
            Mascara os valores na tela até você revelar. É privacidade visual —
            não substitui criptografia.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hide}
          aria-label="Ocultar valores financeiros"
          onClick={() => {
            const next = !hide;
            setHide(next);
            start(async () => {
              const r = await toggleFinanceHideValues(next);
              if (r.ok) router.refresh();
              else toast(r.error ?? "Erro", "error");
            });
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            hide ? "bg-accent" : "bg-line-strong"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${
              hide ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </Card>
  );
}
