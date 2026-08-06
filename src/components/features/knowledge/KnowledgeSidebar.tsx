"use client";

import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  achatarVisiveis,
  caminhoDaPagina,
  descendentesDe,
  montarArvore,
  posicaoEntre,
  rotuloDaPagina,
} from "@/lib/knowledge";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import { cn, plural } from "@/lib/utils";
import type { KnowledgeNotebook, KnowledgePageSummary } from "@/lib/database.types";
import {
  createNotebook,
  createPage,
  deleteNotebook,
  deletePage,
  movePage,
  renameNotebook,
  renamePage,
} from "@/app/(app)/conhecimento/actions";

/**
 * BARRA LATERAL DO MÓDULO CONHECIMENTO: cadernos, árvore de páginas e o CRUD dos
 * dois. É o mesmo componente nas duas rotas do módulo — o índice e a página
 * aberta — porque uma segunda cópia da árvore divergiria da primeira no primeiro
 * ajuste, e a divergência apareceria como "a barra lateral muda quando eu abro
 * uma página".
 *
 * RECEBE A LISTA CHAPADA, NÃO A ÁRVORE, pelo mesmo motivo que `getNotebookPages`
 * é a consulta exportada: a mesma lista serve à árvore (`montarArvore`), ao
 * caminho até a página aberta (`caminhoDaPagina`, para abrir os ramos certos), à
 * subárvore que a exclusão leva junto (`descendentesDe`) e aos destinos do
 * mover. Uma consulta, quatro usos.
 *
 * A ÁRVORE É UM `role="tree"` DE VERDADE, com `aria-expanded`, `aria-level` e
 * navegação por setas. O papel sem o teclado seria pior do que papel nenhum:
 * quem usa leitor de tela ouve "árvore", tenta as setas e não acontece nada —
 * uma lista de links honesta ao menos não promete o que não cumpre.
 */

/* ------------------------------------------------------------------ ícones */

/**
 * Glifos LOCAIS, e isso é orçamento de bundle, não estética.
 *
 * `src/components/ui/Icons.tsx` é importado pelo cabeçalho, pela barra lateral e
 * por quase toda tela: ele está no chunk COMPARTILHADO, o que todas as rotas
 * baixam. Três ícones que só existem dentro da árvore de conhecimento fariam
 * `/tarefas`, `/login` e `/calendario` engordarem por um botão que elas não têm.
 * Aqui eles viajam no chunk desta rota. `ChevronRight`, `Trash`, `Book` e `File`
 * vêm de lá porque já estavam lá — reusar o que já foi baixado é grátis.
 */
function glifo(children: ReactNode) {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Glifo = {
  Mais: () => glifo(<path d="M12 5v14M5 12h14" />),
  Lapis: () => glifo(<><path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" /><path d="m13.5 7 3.5 3.5" /></>),
  Mover: () => glifo(<><path d="M12 3v18M3 12h18" /><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>),
};

/* -------------------------------------------------------------- utilitários */

/** Botãozinho de ação de linha. Ícone só, então o rótulo vai em `aria-label`. */
function BotaoDeLinha({
  rotulo,
  onClick,
  tabIndex,
  perigo,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  tabIndex: number;
  perigo?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        /*
          36px no celular, 24px no desktop — e o 36 é um MEIO-TERMO consciente,
          não descuido.

          24×24 com 2px de vão, tendo "Excluir" como vizinho, é alvo de toque
          pequeno demais: erra-se o dedo e o que abre é a confirmação de apagar
          uma página com as subpáginas dentro.

          O ideal seriam 44px, e aqui eles NÃO cabem. O motivo é o `invisible`
          que esconde este grupo: `visibility: hidden` continua ocupando espaço,
          então a largura reservada pelos quatro botões é descontada do título
          em TODAS as linhas da árvore, não só na que está com o mouse em cima.
          A 44px seriam 182px reservados dos ~335px da barra no celular, e o
          título de uma página em terceiro nível ficaria com menos de 100px. A
          36px são 150px, e o título continua legível.

          O ícone segue com 13px nos dois casos: cresceu a área, não o desenho.
        */
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-ink-subtle transition-colors",
        "sm:h-6 sm:w-6",
        perigo ? "hover:bg-danger/10 hover:text-danger-ink" : "hover:bg-line hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Formulário de um campo só (criar caderno, renomear caderno, renomear página).
 *
 * O `onSubmit` devolve o resultado da action em vez de tratá-lo aqui: erro de
 * regra ("Já existe um caderno com esse nome.") precisa aparecer DENTRO do
 * modal, com o texto ainda na tela para corrigir. Fechar o modal e mostrar um
 * toast obrigaria a pessoa a digitar tudo de novo.
 */
function FormularioDeNome({
  rotulo,
  inicial = "",
  maximo,
  acaoRotulo,
  onSubmit,
  onCancel,
}: {
  rotulo: string;
  inicial?: string;
  maximo: number;
  acaoRotulo: string;
  onSubmit: (nome: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // `useId` e não um literal: dois formulários montados ao mesmo tempo (um modal
  // aberto por cima de outro) repetiriam o mesmo `id`, e um `for` que aponta
  // para dois campos leva o clique no rótulo ao campo errado.
  const idDoCampo = useId();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (ocupado) return;
        setOcupado(true);
        setErro(null);
        const r = await onSubmit(nome.trim());
        // Em caso de sucesso o componente pode já ter sido desmontado junto com
        // o modal; só mexemos no estado no caminho de erro, que é o que mantém o
        // modal aberto.
        if (!r.ok) {
          setErro(r.error ?? "Erro");
          setOcupado(false);
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor={idDoCampo} className="mb-1.5 block text-corpo font-medium text-ink">
          {rotulo}
        </label>
        <input
          id={idDoCampo}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          required
          maxLength={maximo}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>
      {erro && (
        <p role="alert" className="text-corpo text-danger-ink">
          {erro}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={ocupado || nome.trim().length === 0}>
          {ocupado ? "Salvando…" : acaoRotulo}
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------- criar caderno */

/**
 * Botão + modal de "novo caderno", isolado porque aparece em DOIS lugares: no
 * cabeçalho da barra lateral e dentro do estado vazio do módulo (onde não existe
 * barra lateral nenhuma para clicar). Duplicar o modal nos dois pontos seria
 * duplicar também a mensagem de erro e o tratamento do nome repetido.
 */
export function NovoCadernoBotao({ variante = "ghost" }: { variante?: "ghost" | "primary" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button variant={variante} size="sm" onClick={() => setAberto(true)}>
        <Glifo.Mais /> Novo caderno
      </Button>
      {aberto && (
        <Modal title="Novo caderno" onClose={() => setAberto(false)}>
          <FormularioDeNome
            rotulo="Nome do caderno"
            maximo={80}
            acaoRotulo="Criar"
            onCancel={() => setAberto(false)}
            onSubmit={async (nome) => {
              const r = await createNotebook({ name: nome });
              if (r.ok && r.id) {
                setAberto(false);
                toast("Caderno criado", "success");
                // Vai para o caderno recém-criado: criar e continuar olhando
                // para outro caderno é o tipo de "nada aconteceu" que faz a
                // pessoa clicar duas vezes e criar dois.
                router.push(`/conhecimento?caderno=${r.id}`);
              }
              return r;
            }}
          />
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ árvore */

interface Props {
  cadernos: KnowledgeNotebook[];
  cadernoAtivoId: string | null;
  /** Páginas do caderno ativo, CHAPADAS e já ordenadas por `position`. */
  paginas: KnowledgePageSummary[];
  /** Página aberta, quando estamos em `/conhecimento/pagina/<id>`. */
  paginaAtivaId: string | null;
}

type AlvoDeRenomear = { tipo: "caderno" | "pagina"; id: string; nome: string };

export function KnowledgeSidebar({ cadernos, cadernoAtivoId, paginas, paginaAtivaId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendente, iniciar] = useTransition();

  const arvore = useMemo(() => montarArvore(paginas), [paginas]);

  /**
   * Ramos que precisam estar abertos para que a página aberta apareça.
   *
   * `slice(0, -1)` tira a própria página do caminho: abrir uma folha não é
   * expandir a si mesma. Sem isto, uma página aninhada a três níveis abriria com
   * a barra lateral mostrando só as raízes e o item destacado invisível.
   */
  const ancestrais = useMemo(() => {
    if (!paginaAtivaId) return new Set<string>();
    return new Set(
      caminhoDaPagina(paginas, paginaAtivaId)
        .slice(0, -1)
        .map((p) => p.id),
    );
  }, [paginas, paginaAtivaId]);

  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(() => new Set(ancestrais));

  /**
   * Reabre os ancestrais quando a página aberta muda, SEM apagar o que o usuário
   * expandiu à mão.
   *
   * É o padrão de "ajustar estado durante a renderização": comparar a prop com a
   * cópia anterior guardada em estado e corrigir na hora. Um `useEffect` faria a
   * mesma coisa um quadro DEPOIS, e nesse quadro intermediário a árvore seria
   * desenhada com o ramo fechado — o item selecionado piscaria aparecendo.
   */
  const [ultimaAtiva, setUltimaAtiva] = useState(paginaAtivaId);
  if (ultimaAtiva !== paginaAtivaId) {
    setUltimaAtiva(paginaAtivaId);
    if (ancestrais.size > 0) {
      setExpandidos((atual) => new Set([...atual, ...ancestrais]));
    }
  }

  const linhas = useMemo(() => achatarVisiveis(arvore, expandidos), [arvore, expandidos]);

  /* -- foco móvel da árvore ------------------------------------------------
   * Uma árvore inteira é UMA parada de Tab; as setas movem o foco dentro dela.
   * `focoId` é quem tem `tabIndex={0}` no momento. Sem isso, uma barra lateral
   * com 80 páginas seriam 80 paradas de Tab antes de chegar ao texto. */
  const [focoId, setFocoId] = useState<string | null>(null);

  const idComTab = useMemo(() => {
    const visivel = (id: string | null) => (id && linhas.some((l) => l.no.id === id) ? id : null);
    // Ordem de preferência: onde o usuário estava > a página aberta > a primeira.
    return visivel(focoId) ?? visivel(paginaAtivaId) ?? linhas[0]?.no.id ?? null;
  }, [linhas, focoId, paginaAtivaId]);

  /**
   * Move o foco de verdade, e não só o estado.
   *
   * Mudar `tabIndex` não move cursor nenhum: quem navega por teclado só percebe
   * a seta se o elemento receber `focus()`. A busca é pelo atributo de dado
   * porque a linha destino já está no DOM (é uma linha VISÍVEL) — o caso de
   * expandir e descer é tratado em dois passos justamente para não tentar focar
   * um nó que ainda não foi renderizado.
   */
  const focarLinha = (id: string) => {
    setFocoId(id);
    const alvo = document.querySelector<HTMLElement>(`[data-linha="${id}"]`);
    alvo?.focus();
  };

  const alternar = (id: string, abrir: boolean) => {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (abrir) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  };

  /**
   * Teclado do `role="tree"` (padrão da APG).
   *
   * Só responde quando o evento NASCEU numa linha (`data-linha`): os botões de
   * ação moram dentro do item e a seta para baixo, apertada com o foco num
   * botão, não pode arrastar o foco da árvore junto — quem está no botão
   * "Excluir" espera que as setas não façam nada.
   */
  const aoTeclar = (evento: React.KeyboardEvent<HTMLUListElement>) => {
    const alvo = evento.target as HTMLElement;
    const id = alvo.dataset?.linha;
    if (!id) return;
    const indice = linhas.findIndex((l) => l.no.id === id);
    if (indice < 0) return;
    const linha = linhas[indice];

    const irPara = (destino: number) => {
      const proxima = linhas[Math.max(0, Math.min(linhas.length - 1, destino))];
      if (proxima && proxima.no.id !== id) focarLinha(proxima.no.id);
    };

    switch (evento.key) {
      case "ArrowDown":
        irPara(indice + 1);
        break;
      case "ArrowUp":
        irPara(indice - 1);
        break;
      case "Home":
        irPara(0);
        break;
      case "End":
        irPara(linhas.length - 1);
        break;
      case "ArrowRight":
        // Fechada com filhas: abre. Já aberta: desce para a primeira filha, que
        // por construção é a PRÓXIMA linha visível. Folha: não faz nada.
        if (linha.temFilhas && !linha.expandida) alternar(id, true);
        else if (linha.expandida) irPara(indice + 1);
        else return;
        break;
      case "ArrowLeft":
        // Aberta: fecha. Fechada: sobe para a mãe DESENHADA (ver `LinhaVisivel`).
        if (linha.expandida) alternar(id, false);
        else if (linha.maeId) focarLinha(linha.maeId);
        else return;
        break;
      case "Enter":
      case " ":
        router.push(`/conhecimento/pagina/${linha.no.id}`);
        break;
      default:
        return;
    }
    // Só chega aqui quem foi tratado — os `return` acima deixam a tecla seguir.
    // Espaço e setas rolam a página por padrão, e a rolagem no meio da navegação
    // por teclado é exatamente o que faz perder o lugar.
    evento.preventDefault();
  };

  /* -- modais e diálogos --------------------------------------------------- */

  const [renomeando, setRenomeando] = useState<AlvoDeRenomear | null>(null);
  const [movendo, setMovendo] = useState<KnowledgePageSummary | null>(null);
  const [excluindoPagina, setExcluindoPagina] = useState<KnowledgePageSummary | null>(null);
  const [excluindoCaderno, setExcluindoCaderno] = useState<KnowledgeNotebook | null>(null);

  /* -- ações --------------------------------------------------------------- */

  const criarPagina = (parentId: string | null) => {
    if (!cadernoAtivoId) return;
    iniciar(async () => {
      const r = await createPage({ notebookId: cadernoAtivoId, parentId });
      if (!r.ok || !r.id) {
        toast(r.error ?? "Não foi possível criar a página.", "error");
        return;
      }
      // Abrir a mãe: a página nova nasce dentro dela e ficaria escondida.
      if (parentId) alternar(parentId, true);
      router.push(`/conhecimento/pagina/${r.id}`);
    });
  };

  const confirmarExclusaoDePagina = (alvo: KnowledgePageSummary) => {
    iniciar(async () => {
      const r = await deletePage(alvo.id);
      if (!r.ok) {
        toast(r.error ?? "Não foi possível excluir.", "error");
        return;
      }
      toast("Página excluída", "success");
      // Estamos DENTRO da página que acabou de sumir: continuar ali daria 404 no
      // próximo carregamento. Sai para o caderno.
      if (paginaAtivaId === alvo.id || descendentesDe(paginas, alvo.id).has(paginaAtivaId ?? "")) {
        router.push(`/conhecimento?caderno=${alvo.notebook_id}`);
      } else {
        router.refresh();
      }
    });
  };

  const confirmarExclusaoDeCaderno = (alvo: KnowledgeNotebook) => {
    iniciar(async () => {
      const r = await deleteNotebook(alvo.id);
      if (!r.ok) {
        toast(r.error ?? "Não foi possível excluir.", "error");
        return;
      }
      toast("Caderno excluído", "success");
      router.push("/conhecimento");
    });
  };

  /* -- render --------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------- cadernos */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow">Cadernos</h2>
          <NovoCadernoBotao />
        </div>

        <ul className="space-y-0.5">
          {cadernos.map((caderno) => {
            const ativo = caderno.id === cadernoAtivoId;
            return (
              <li key={caderno.id} className="group flex items-center gap-1">
                <Link
                  href={`/conhecimento?caderno=${caderno.id}`}
                  aria-current={ativo ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-corpo",
                    ativo
                      ? "bg-surface-muted font-medium text-ink"
                      : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  <Icon.Book width={15} height={15} className="shrink-0" />
                  <span className="truncate">{caderno.name}</span>
                </Link>

                {/* As ações só existem no caderno ABERTO, e o motivo não é
                    estético: a exclusão precisa dizer QUANTAS páginas vão junto,
                    e a única contagem que esta tela conhece sem uma consulta a
                    mais é a do caderno cuja lista de páginas ela já recebeu.
                    Avisar "e todas as páginas" sem o número é o cascade
                    silencioso que se quer evitar. */}
                {ativo && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <BotaoDeLinha
                      rotulo={`Renomear o caderno ${caderno.name}`}
                      tabIndex={0}
                      onClick={() =>
                        setRenomeando({ tipo: "caderno", id: caderno.id, nome: caderno.name })
                      }
                    >
                      <Glifo.Lapis />
                    </BotaoDeLinha>
                    <BotaoDeLinha
                      rotulo={`Excluir o caderno ${caderno.name}`}
                      tabIndex={0}
                      perigo
                      onClick={() => setExcluindoCaderno(caderno)}
                    >
                      <Icon.Trash width={13} height={13} />
                    </BotaoDeLinha>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------------------ páginas */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow">Páginas</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={!cadernoAtivoId || pendente}
            onClick={() => criarPagina(null)}
          >
            <Glifo.Mais /> Nova página
          </Button>
        </div>

        {linhas.length === 0 ? (
          <p className="px-2.5 py-2 text-corpo text-ink-subtle">
            {cadernoAtivoId
              ? "Este caderno ainda não tem páginas."
              : "Crie um caderno para começar."}
          </p>
        ) : (
          <ul role="tree" aria-label="Páginas do caderno" onKeyDown={aoTeclar} className="space-y-0.5">
            {linhas.map((linha) => {
              const id = linha.no.id;
              const rotulo = rotuloDaPagina(linha.no.title);
              const aberta = id === paginaAtivaId;
              const tab = id === idComTab ? 0 : -1;

              return (
                <li
                  key={id}
                  role="treeitem"
                  data-linha={id}
                  tabIndex={tab}
                  // O nome acessível é declarado, não inferido do conteúdo: o
                  // item contém o rótulo E os botões de ação, e um nome montado
                  // a partir de tudo isso sairia como "Sobre o projeto Renomear
                  // Mover Excluir".
                  aria-label={rotulo}
                  aria-level={linha.nivel}
                  aria-posinset={linha.posicao}
                  aria-setsize={linha.total}
                  // `aria-expanded` só existe em quem TEM filhas. Declará-lo como
                  // "false" numa folha faz o leitor anunciar "recolhido" e a
                  // pessoa apertar a seta direita esperando algo que não existe.
                  aria-expanded={linha.temFilhas ? linha.expandida : undefined}
                  // Árvore de seleção única: marcamos só o item selecionado, em
                  // vez de `aria-selected="false"` em todos os outros.
                  aria-selected={aberta ? true : undefined}
                  onFocus={() => setFocoId(id)}
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-1 outline-none",
                   "",
                    aberta ? "bg-surface-muted" : "hover:bg-surface-muted",
                  )}
                  // O recuo por nível vive aqui e não numa `<ul>` aninhada: a
                  // lista é ACHATADA (ver `achatarVisiveis`), que é o que torna a
                  // seta para baixo um `indice + 1` em vez de uma travessia.
                  style={{ paddingLeft: `${Math.min(linha.nivel - 1, 8) * 12}px` }}
                >
                  {/* Seta de expandir: <button> de verdade para o mouse, mas
                      `aria-hidden` e fora da ordem de foco. Quem usa teclado já
                      abre e fecha com as setas ← →, e o estado é anunciado pelo
                      `aria-expanded` do item; um segundo controle só repetiria a
                      mesma informação e criaria uma parada de foco inútil. */}
                  {linha.temFilhas ? (
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => alternar(id, !linha.expandida)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-subtle hover:text-ink"
                    >
                      <Icon.ChevronRight
                        width={13}
                        height={13}
                        className={cn("transition-transform", linha.expandida && "rotate-90")}
                      />
                    </button>
                  ) : (
                    <span aria-hidden="true" className="h-5 w-5 shrink-0" />
                  )}

                  {/* O rótulo é um <a> DE VERDADE (abre em nova aba, mostra o
                      endereço, aceita clique do meio), mas `aria-hidden` e fora
                      da ordem de foco: quem manda na acessibilidade é o
                      `treeitem` em volta, que já tem o mesmo nome e responde ao
                      Enter. Sem o `aria-hidden`, o leitor anunciaria o título
                      duas vezes — uma como item da árvore, outra como link. */}
                  <a
                    href={`/conhecimento/pagina/${id}`}
                    aria-hidden="true"
                    tabIndex={-1}
                    // Impede que o clique deixe o foco NO LINK: com o foco ali, o
                    // `onKeyDown` da árvore não reconheceria a linha e as setas
                    // parariam de funcionar logo depois de um clique de mouse.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      focarLinha(id);
                    }}
                    className={cn(
                      "min-w-0 flex-1 truncate py-1.5 text-corpo",
                      aberta ? "font-medium text-ink" : "text-ink-muted group-hover:text-ink",
                    )}
                  >
                    {rotulo}
                  </a>

                  {/* Ações da linha.
                      `invisible` (visibility: hidden) e NÃO `hidden`/`opacity-0`:
                      é a única das três que tira o botão da árvore de
                      acessibilidade E do alcance do clique enquanto ele está
                      escondido. Com `opacity-0` sobrariam alvos invisíveis
                      clicáveis em cima de "Excluir"; com `display:none` eles
                      sumiriam para o leitor de tela mesmo quando a linha está em
                      foco. Aqui aparecem no hover e no `focus-within`, que é
                      exatamente quando o teclado chega neles. */}
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-0.5",
                      // A linha da página ABERTA mostra as ações sempre, e isso
                      // não é destaque visual: em tela de toque não existe
                      // "hover", então sem esta exceção renomear, mover e
                      // excluir seriam inalcançáveis pelo dedo. Tocar numa
                      // página a abre, e a página aberta é justamente esta.
                      aberta
                        ? "visible"
                        : "invisible group-hover:visible group-focus-within:visible",
                    )}
                  >
                    <BotaoDeLinha
                      rotulo={`Nova subpágina em ${rotulo}`}
                      tabIndex={tab}
                      onClick={() => criarPagina(id)}
                    >
                      <Glifo.Mais />
                    </BotaoDeLinha>
                    <BotaoDeLinha
                      rotulo={`Renomear ${rotulo}`}
                      tabIndex={tab}
                      onClick={() => setRenomeando({ tipo: "pagina", id, nome: rotulo })}
                    >
                      <Glifo.Lapis />
                    </BotaoDeLinha>
                    <BotaoDeLinha
                      rotulo={`Mover ${rotulo}`}
                      tabIndex={tab}
                      onClick={() => setMovendo(linha.no)}
                    >
                      <Glifo.Mover />
                    </BotaoDeLinha>
                    <BotaoDeLinha
                      rotulo={`Excluir ${rotulo}`}
                      tabIndex={tab}
                      perigo
                      onClick={() => setExcluindoPagina(linha.no)}
                    >
                      <Icon.Trash width={13} height={13} />
                    </BotaoDeLinha>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------------- modais */}

      {renomeando && (
        <Modal
          title={renomeando.tipo === "caderno" ? "Renomear caderno" : "Renomear página"}
          onClose={() => setRenomeando(null)}
        >
          <FormularioDeNome
            rotulo={renomeando.tipo === "caderno" ? "Nome do caderno" : "Título da página"}
            inicial={renomeando.nome}
            maximo={renomeando.tipo === "caderno" ? 80 : 200}
            acaoRotulo="Renomear"
            onCancel={() => setRenomeando(null)}
            onSubmit={async (nome) => {
              const alvo = renomeando;
              const r =
                alvo.tipo === "caderno"
                  ? await renameNotebook({ id: alvo.id, name: nome })
                  : await renamePage({ id: alvo.id, title: nome });
              if (r.ok) {
                setRenomeando(null);
                toast("Renomeado", "success");
                router.refresh();
              }
              return r;
            }}
          />
        </Modal>
      )}

      {movendo && cadernoAtivoId && (
        <Modal title={`Mover "${rotuloDaPagina(movendo.title)}"`} onClose={() => setMovendo(null)}>
          <FormularioDeMover
            pagina={movendo}
            paginas={paginas}
            cadernos={cadernos}
            cadernoAtivoId={cadernoAtivoId}
            onCancel={() => setMovendo(null)}
            onSubmit={async (destino) => {
              const r = await movePage({ id: movendo.id, ...destino });
              if (r.ok) {
                setMovendo(null);
                toast("Página movida", "success");
                router.refresh();
              }
              return r;
            }}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={excluindoPagina !== null}
        title="Excluir página"
        description={descricaoDaExclusaoDePagina(paginas, excluindoPagina)}
        confirmLabel="Excluir"
        destructive
        onCancel={() => setExcluindoPagina(null)}
        onConfirm={() => {
          const alvo = excluindoPagina;
          setExcluindoPagina(null);
          if (alvo) confirmarExclusaoDePagina(alvo);
        }}
      />

      <ConfirmationDialog
        open={excluindoCaderno !== null}
        title="Excluir caderno"
        description={
          excluindoCaderno
            ? paginas.length === 0
              ? `"${excluindoCaderno.name}" está vazio e será excluído. Esta ação não pode ser desfeita.`
              : `"${excluindoCaderno.name}" e ${plural(paginas.length, "página", "páginas")} serão excluídos. Esta ação não pode ser desfeita.`
            : ""
        }
        confirmLabel="Excluir tudo"
        destructive
        onCancel={() => setExcluindoCaderno(null)}
        onConfirm={() => {
          const alvo = excluindoCaderno;
          setExcluindoCaderno(null);
          if (alvo) confirmarExclusaoDeCaderno(alvo);
        }}
      />
    </div>
  );
}

/**
 * Texto do aviso de exclusão de página.
 *
 * `deletePage` apaga a SUBÁRVORE inteira, então o número de subpáginas é a
 * informação que decide se a pessoa clica ou não. Uma frase genérica ("as
 * subpáginas também serão excluídas") é o que faz alguém apagar quarenta páginas
 * achando que apagou uma.
 */
function descricaoDaExclusaoDePagina(
  paginas: KnowledgePageSummary[],
  alvo: KnowledgePageSummary | null,
): string {
  if (!alvo) return "";
  const quantas = descendentesDe(paginas, alvo.id).size;
  const nome = rotuloDaPagina(alvo.title);
  if (quantas === 0) return `"${nome}" será excluída. Esta ação não pode ser desfeita.`;
  return `"${nome}" e ${plural(quantas, "subpágina", "subpáginas")} serão excluídas. Esta ação não pode ser desfeita.`;
}

/* ------------------------------------------------------------------- mover */

type DestinoDeMovimentacao = { parentId: string | null; notebookId: string; position?: number };

/**
 * Escolha do destino de uma página.
 *
 * DUAS CLASSES DE DESTINO, e a diferença entre elas não é arbitrária:
 *   - qualquer página do caderno ATUAL, porque a tela já tem a lista inteira
 *     dele em memória;
 *   - o TOPO de qualquer outro caderno, e só o topo. Oferecer "dentro da página
 *     X do caderno Y" exigiria carregar a árvore de todos os cadernos só para
 *     preencher um `<select>` que quase nunca é aberto — N consultas por
 *     renderização da barra lateral, por uma operação rara.
 *
 * A própria página e TODA a subárvore dela ficam fora da lista: mover uma página
 * para dentro de uma filha é o ciclo que o `trg_knowledge_pages_no_cycle`
 * recusa. Deixar a opção no `<select>` para depois mostrar o erro do banco é
 * oferecer o que não se pode cumprir.
 */
function FormularioDeMover({
  pagina,
  paginas,
  cadernos,
  cadernoAtivoId,
  onSubmit,
  onCancel,
}: {
  pagina: KnowledgePageSummary;
  paginas: KnowledgePageSummary[];
  cadernos: KnowledgeNotebook[];
  cadernoAtivoId: string;
  onSubmit: (destino: DestinoDeMovimentacao) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const proibidos = useMemo(() => {
    const conjunto = descendentesDe(paginas, pagina.id);
    conjunto.add(pagina.id);
    return conjunto;
  }, [paginas, pagina.id]);

  const candidatas = useMemo(
    () => paginas.filter((p) => !proibidos.has(p.id)),
    [paginas, proibidos],
  );

  /** Caminho legível ("Estudos / SQL / Índices") para desambiguar homônimas. */
  const caminhoDe = (alvo: KnowledgePageSummary) =>
    caminhoDaPagina(paginas, alvo.id)
      .map((p) => rotuloDaPagina(p.title))
      .join(" / ");

  const atual = pagina.parent_id ? `pagina:${pagina.parent_id}` : `caderno:${cadernoAtivoId}`;
  const [destino, setDestino] = useState(atual);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (ocupado) return;
        setOcupado(true);
        setErro(null);

        const [tipo, alvoId] = destino.split(":");
        const parentId = tipo === "pagina" ? (alvoId ?? null) : null;
        const notebookId =
          tipo === "pagina"
            ? cadernoAtivoId
            : (alvoId ?? cadernoAtivoId);

        /**
         * A página entra no FIM da lista do destino.
         *
         * Sem mandar `position`, a página levaria o índice fracionário antigo
         * para o destino e cairia num ponto arbitrário do meio da lista nova —
         * parece a interface embaralhando as coisas sozinha. `posicaoEntre` com
         * `proxima = null` devolve "depois da última".
         *
         * Só dá para calcular dentro do caderno ATUAL, que é o único cuja lista
         * está em memória. Ao mudar de caderno, `position` não é enviada e a
         * action mantém a atual — a ordem no destino fica indefinida, mas o
         * alternativo seria uma consulta extra a cada troca de caderno.
         */
        let position: number | undefined;
        if (notebookId === cadernoAtivoId) {
          const irmas = paginas.filter(
            (p) => p.id !== pagina.id && (p.parent_id ?? null) === parentId,
          );
          const ultima = irmas[irmas.length - 1];
          const calculada = posicaoEntre(ultima ? ultima.position : null, null);
          // `null` = o `double` não parte mais o intervalo. Ver `posicaoEntre`.
          if (calculada !== null) position = calculada;
        }

        const r = await onSubmit({ parentId, notebookId, ...(position !== undefined ? { position } : {}) });
        if (!r.ok) {
          setErro(r.error ?? "Erro");
          setOcupado(false);
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="destino-da-pagina" className="mb-1.5 block text-corpo font-medium text-ink">
          Mover para
        </label>
        <select
          id="destino-da-pagina"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        >
          <optgroup label="Topo de um caderno">
            {cadernos.map((c) => (
              <option key={c.id} value={`caderno:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
          {candidatas.length > 0 && (
            <optgroup label="Dentro de uma página deste caderno">
              {candidatas.map((p) => (
                <option key={p.id} value={`pagina:${p.id}`}>
                  {caminhoDe(p)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="mt-1.5 text-legenda text-ink-subtle">
          As subpáginas acompanham a página movida.
        </p>
      </div>
      {erro && (
        <p role="alert" className="text-corpo text-danger-ink">
          {erro}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={ocupado || destino === atual}>
          {ocupado ? "Movendo…" : "Mover"}
        </Button>
      </div>
    </form>
  );
}
