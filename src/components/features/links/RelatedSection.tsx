"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createLink, removeLink } from "@/app/(app)/vinculos/actions";
import { pairForLink, RELATED_KIND_LABEL, type RelatedEntity, type RelatedItem } from "@/lib/links";
import { cn } from "@/lib/utils";

/**
 * Seção "Relacionado": o que já está vinculado à entidade aberta, com botão de
 * remover, e um combobox para vincular algo novo.
 *
 * NADA É BUSCADO AQUI. Os vínculos e os candidatos chegam por prop, carregados
 * em lote pela página (ver `getRelatedItems` / `get*Candidates` em `lib/data`).
 * A regra é dura porque este componente vive dentro de cards e modais que se
 * repetem dezenas de vezes por tela: um `fetch` aqui seria N+1 imediato.
 *
 * As mutações são as duas server actions da 0009. Depois delas o
 * `revalidatePath` refaz a página e a prop `related` volta atualizada — por isso
 * não existe estado local espelhando a lista de vínculos. Espelhar traria de
 * volta o clássico "removi e voltou" quando o servidor recusa.
 */

/** Quantas sugestões o listbox mostra por vez. */
const MAX_SUGESTOES = 8;

/**
 * Compara ignorando maiúsculas E acentos: quem digita "reuniao" espera achar
 * "Reunião". `NFD` separa a letra do diacrítico e a classe `\p{Diacritic}`
 * apaga o diacrítico solto. A classe nomeada é usada no lugar da faixa
 * U+0300–U+036F escrita à mão de propósito: colar caracteres combinantes crus
 * num arquivo os deixa invisíveis para quem revisa o código. Cobre também o ç,
 * que em NFD vira c + cedilha combinante.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function RelatedSection({
  entity,
  related,
  candidates,
  className,
}: {
  /** A entidade aberta na tela (tarefa, captura ou evento). */
  entity: RelatedEntity;
  /** Já vinculados — vem do Map carregado pela página. */
  related: RelatedItem[];
  /** Pool do autocomplete: os itens dos DOIS outros tipos. */
  candidates: RelatedItem[];
  className?: string;
}) {
  const { toast } = useToast();
  const [pendente, iniciar] = useTransition();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-entrada`;
  const listboxId = `${baseId}-lista`;
  const opcaoId = (i: number) => `${baseId}-opcao-${i}`;

  const vinculados = useMemo(() => new Set(related.map((r) => r.id)), [related]);

  const sugestoes = useMemo(() => {
    const alvo = normalizar(busca.trim());
    return candidates
      // Mesmo tipo dos dois lados não tem tabela de vínculo (ver pairForLink).
      // Se a página passar a lista errada, o item some da sugestão em vez de
      // virar um erro do banco na cara do usuário.
      .filter((c) => c.kind !== entity.kind)
      .filter((c) => !vinculados.has(c.id))
      .filter((c) => alvo === "" || normalizar(`${c.label} ${c.hint ?? ""}`).includes(alvo))
      .slice(0, MAX_SUGESTOES);
  }, [candidates, busca, vinculados, entity.kind]);

  // O índice ativo é DERIVADO, não corrigido por efeito: a lista encolhe a cada
  // tecla digitada, e um `useEffect` que ajustasse o estado renderizaria um
  // quadro com `aria-activedescendant` apontando para uma opção que não existe
  // mais — o leitor de tela anunciaria o vazio.
  const ativo = sugestoes.length === 0 ? -1 : Math.min(indice, sugestoes.length - 1);
  /** Lista aberta E com algo dentro — é este o estado que a interface expõe. */
  const listaVisivel = aberto && sugestoes.length > 0;

  /*
    ESC PRECISA SER INTERCEPTADO ANTES DO MODAL.

    O `Modal` escuta `keydown` no `document`, em fase de BOLHA, e fecha o
    diálogo no Esc. Se o Esc só fechasse a lista de sugestões, quem estivesse
    procurando um item perderia o modal inteiro — no formulário de tarefa, junto
    com o que já tinha digitado.

    `event.stopPropagation()` dentro de um `onKeyDown` do React NÃO resolve: no
    App Router o React monta a raiz sobre o `document`, ou seja, o listener
    delegado do React e o do Modal estão no MESMO nó, e `stopPropagation` não
    cancela outros listeners do mesmo nó (isso é `stopImmediatePropagation`, que
    dependeria da ordem de registro — frágil demais para depender).

    O que funciona sem depender de ordem: um listener em fase de CAPTURA no
    `document`. A captura percorre a árvore de cima para baixo ANTES de qualquer
    bolha; marcar a flag de parada ali faz o despacho terminar sem nunca chegar à
    fase de bolha do `document`, onde o Modal escuta. Só é registrado enquanto a
    lista está aberta, então o Esc volta a fechar o modal no resto do tempo.
  */
  useEffect(() => {
    // Condicionado ao que está VISÍVEL: com a lista fechada (ou aberta e vazia)
    // não há nada para o Esc fechar aqui, e sequestrá-lo faria a tecla parecer
    // quebrada — o modal deixaria de fechar sem nenhuma razão aparente.
    if (!listaVisivel) return;
    function aoTeclarNoDocumento(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const alvo = event.target;
      // Só sequestramos o Esc quando o foco está DENTRO deste combobox.
      if (!(alvo instanceof Node) || !containerRef.current?.contains(alvo)) return;
      event.preventDefault();
      event.stopPropagation();
      setAberto(false);
    }
    document.addEventListener("keydown", aoTeclarNoDocumento, true);
    return () => document.removeEventListener("keydown", aoTeclarNoDocumento, true);
  }, [listaVisivel]);

  function vincular(item: RelatedItem) {
    const par = pairForLink(entity, item);
    if (!par) return;
    setBusca("");
    setAberto(false);
    setIndice(0);
    iniciar(async () => {
      const r = await createLink(par.tipo, par.aId, par.bId);
      toast(r.ok ? "Vínculo criado" : (r.error ?? "Erro"), r.ok ? "success" : "error");
    });
  }

  function desvincular(item: RelatedItem) {
    const par = pairForLink(entity, item);
    if (!par) return;
    iniciar(async () => {
      const r = await removeLink(par.tipo, par.aId, par.bId);
      // Foco devolvido nos DOIS desfechos. O botão clicado fica desabilitado
      // durante a transição (e some de vez quando a remoção dá certo), e o
      // navegador joga no <body> o foco de um elemento que desabilita — estado
      // que a armadilha do Modal lê como "saiu do diálogo". O campo de busca é o
      // lugar natural para continuar em qualquer um dos casos.
      inputRef.current?.focus();
      toast(r.ok ? "Vínculo removido" : (r.error ?? "Erro"), r.ok ? "success" : "error");
    });
  }

  function aoTeclar(event: React.KeyboardEvent<HTMLInputElement>) {
    // SETAS VERTICAIS SÃO LIVRES dentro do Modal: ele só intercepta ArrowLeft e
    // ArrowRight (a navegação entre notas da CaptureView), e mesmo essas ele já
    // ignora quando o foco está num campo de texto. Por isso o combobox usa
    // cima/baixo — não há conflito a resolver, e trocar por esquerda/direita
    // criaria um.
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Sem o preventDefault, a seta move o cursor para o começo/fim do texto
      // digitado além de mudar a opção ativa.
      event.preventDefault();
      if (!aberto) {
        setAberto(true);
        setIndice(0);
        return;
      }
      if (sugestoes.length === 0) return;
      const passo = event.key === "ArrowDown" ? 1 : -1;
      setIndice((ativo + passo + sugestoes.length) % sugestoes.length);
      return;
    }

    if (event.key === "Enter") {
      // preventDefault SEMPRE, inclusive com a lista fechada: Enter num campo de
      // texto dispara o envio implícito do <form> que estiver em volta. Hoje a
      // seção é renderizada FORA do <form> da tarefa; amanhã alguém a move para
      // dentro e o formulário passaria a ser salvo ao escolher um vínculo.
      event.preventDefault();
      const escolhido = ativo >= 0 ? sugestoes[ativo] : undefined;
      if (listaVisivel && escolhido) vincular(escolhido);
      return;
    }

    if (event.key === "Tab") setAberto(false);
  }

  return (
    <section className={cn("border-t border-line pt-4", className)}>
      <h3 className="mb-2 text-corpo font-semibold text-ink">Relacionado</h3>

      {related.length === 0 ? (
        <p className="mb-3 text-legenda text-ink-subtle">Nada relacionado ainda.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {related.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-muted px-2.5 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone="outline">{RELATED_KIND_LABEL[item.kind]}</Badge>
                <span className="min-w-0">
                  <span className="block truncate text-corpo text-ink">{item.label}</span>
                  {item.hint && (
                    <span className="block truncate text-meta text-ink-subtle">{item.hint}</span>
                  )}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={pendente}
                // O texto visível se repete em toda linha; o rótulo acessível
                // diz DE QUEM é o vínculo, senão o leitor de tela anuncia uma
                // fila de "Remover vínculo" indistinguíveis.
                aria-label={`Remover vínculo com ${item.label}`}
                onClick={() => desvincular(item)}
              >
                Remover vínculo
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
        COMBOBOX (padrão ARIA 1.2, com listbox e aria-activedescendant).

        O foco NUNCA sai do input: as opções não são focáveis e não são botões.
        É o que o padrão pede — `aria-activedescendant` aponta para a opção
        corrente e o leitor de tela a anuncia sem mover o foco, o que mantém a
        digitação funcionando. Transformar cada opção em <button> quebraria a
        semântica de listbox (option não pode ser button) e ainda encheria a
        armadilha de foco do Modal de paradas de Tab a cada letra digitada.
      */}
      <div ref={containerRef} className="relative">
        <label htmlFor={inputId} className="mb-1.5 block text-legenda font-medium text-ink-muted">
          Vincular a…
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          // `aria-expanded` acompanha o que está NA TELA, não a intenção: com a
          // busca sem resultado o listbox fica escondido, e anunciar "expandido"
          // mandaria o leitor de tela procurar uma lista que não existe.
          aria-expanded={listaVisivel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={listaVisivel && ativo >= 0 ? opcaoId(ativo) : undefined}
          autoComplete="off"
          placeholder="Busque uma tarefa, captura ou evento"
          value={busca}
          // Sem `disabled` durante a transição, de propósito: desabilitar o
          // campo que está com o foco faz o navegador jogar o foco no <body>, e
          // a armadilha do Modal passaria a tratar a pessoa como se ela tivesse
          // saído do diálogo. Um clique repetido também não faz estrago —
          // `createLink` é idempotente por causa da PK composta.
          onChange={(e) => {
            setBusca(e.target.value);
            setAberto(true);
            setIndice(0);
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={aoTeclar}
          onBlur={(event) => {
            // `relatedTarget` é para onde o foco FOI. Continuar dentro do
            // combobox não fecha a lista.
            const destino = event.relatedTarget;
            if (destino instanceof Node && containerRef.current?.contains(destino)) return;
            setAberto(false);
          }}
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />

        {/*
          O listbox é renderizado sempre e apenas escondido: `aria-controls` do
          combobox precisa apontar para um id que exista no documento, e o
          `hidden` já o remove da árvore de acessibilidade e da tela.
        */}
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Itens para vincular"
          hidden={!listaVisivel}
          /* A animação de entrada funciona mesmo com a lista sempre montada: o
             `hidden` aplica `display: none`, e a especificação de CSS Animations
             diz que sair de `display: none` REINICIA as animações do elemento.
             Ou seja, ela roda toda vez que a lista abre, não uma única vez na
             montagem da página. */
          className="absolute z-10 mt-1 max-h-56 w-full animate-popover-in overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-raised"
        >
          {sugestoes.map((item, i) => (
            <li
              key={`${item.kind}-${item.id}`}
              id={opcaoId(i)}
              role="option"
              aria-selected={i === ativo}
              // mousedown dispara ANTES do blur do input. Sem o preventDefault o
              // campo perderia o foco, `onBlur` fecharia a lista e o clique
              // pousaria no vazio — o bug clássico de autocomplete "não dá para
              // clicar na sugestão".
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => vincular(item)}
              onMouseEnter={() => setIndice(i)}
              className={cn(
                "cursor-pointer px-3 py-2 text-corpo",
                i === ativo ? "bg-surface-muted text-ink" : "text-ink-muted",
              )}
            >
              <span className="flex items-center gap-2">
                <Badge tone="outline">{RELATED_KIND_LABEL[item.kind]}</Badge>
                <span className="min-w-0 truncate">{item.label}</span>
              </span>
              {item.hint && <span className="mt-0.5 block text-meta text-ink-subtle">{item.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
