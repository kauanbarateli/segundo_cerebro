"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { buscarAnexaveis, vincularAoProjeto } from "@/app/(app)/projetos/actions";
import { ANEXAVEL, type ItemAnexavel, type TipoAnexavel } from "@/components/features/projects/anexaveis";

/**
 * ESCOLHER ITENS PARA UM PROJETO — o inverso de `SeletorDeProjeto`.
 *
 * `SeletorDeProjeto` é um `<select>` dentro do formulário de UM item: "a que
 * projeto esta tarefa pertence?". Aqui a pergunta é a de trás para frente:
 * estando dentro do projeto, "quais tarefas passam a ser deste projeto?". Por
 * isso a seleção é MÚLTIPLA — ninguém entra nesta tela para vincular uma coisa
 * só, e um `<select>` por item obrigaria a abrir cada tarefa em outra aba.
 *
 * ============================================================================
 * ⚠️ POR QUE O BOTÃO DIZ "VINCULAR" E NÃO "ADICIONAR"
 * ============================================================================
 * Porque nada é criado nem copiado aqui. O vínculo é a coluna `project_id` da
 * própria linha (0017): marcar uma tarefa e confirmar grava um uuid nela. A
 * tarefa continua sendo a MESMA, com o mesmo id, aparecendo em Tarefas como
 * sempre apareceu — e agora também aqui. "Adicionar" faria a pessoa achar que
 * está duplicando informação, que é exatamente o que este desenho evita.
 *
 * ============================================================================
 * ⚠️ ITEM QUE JÁ ESTÁ EM OUTRO PROJETO É MOSTRADO, MAS COM AVISO
 * ============================================================================
 * Esconder esses itens pareceria mais seguro e seria pior: a pessoa procuraria
 * a tarefa, não a encontraria, e não teria como saber por quê. Como
 * `project_id` é uma coluna só, vincular aqui MOVE — não põe nos dois. O selo
 * "está em «X»" no candidato e a frase antes do botão dizem isso ANTES de
 * gravar, que é o único momento em que a informação serve para alguma coisa.
 */
export function VincularExistente({
  projectId,
  nomeDoProjeto,
  tipo,
  onDone,
  onCancel,
}: {
  projectId: string;
  nomeDoProjeto: string;
  tipo: TipoAnexavel;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const def = ANEXAVEL[tipo];
  const idDaBusca = useId();

  const [termo, setTermo] = useState("");
  const [itens, setItens] = useState<ItemAnexavel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  /**
   * ⚠️ É UM `Map` DE ITENS, E NÃO UM `Set` DE IDS. Os dois motivos:
   *
   *   A ESCOLHA SOBREVIVE À BUSCA, de propósito — marcar duas tarefas, trocar o
   *   termo e marcar mais duas é o uso normal, e zerar a seleção a cada tecla
   *   faria a pessoa vincular de quatro em quatro vezes. Mas isso significa que
   *   um item escolhido pode não estar mais em `itens`.
   *
   *   E o aviso "vai MUDAR de projeto" precisa saber de ONDE cada escolhido vem.
   *   Com um `Set`, essa conta só enxergaria os visíveis: escolher uma tarefa de
   *   outro projeto e depois buscar outra coisa apagaria o aviso da tela sem
   *   apagar a consequência. Guardando o item inteiro, a conta continua certa
   *   com a lista mostrando qualquer coisa.
   */
  const [escolhidos, setEscolhidos] = useState<Map<string, ItemAnexavel>>(new Map());

  /**
   * Contador de pedidos, para descartar resposta ATRASADA.
   *
   * Digitar "reforma" dispara buscas conforme as letras entram. Sem isto, a
   * resposta de "refor" chegando depois da de "reforma" repintaria a lista com
   * o resultado antigo — e a pessoa veria a lista "voltar" sozinha, sem nada na
   * tela explicando. O `clearTimeout` do cleanup resolve só o caso em que o
   * pedido nem chegou a sair.
   */
  const pedidoRef = useRef(0);

  useEffect(() => {
    const meuPedido = pedidoRef.current + 1;
    pedidoRef.current = meuPedido;
    setCarregando(true);

    // Atraso curto: a busca é um endpoint HTTP com limite de taxa próprio, e
    // uma ida ao banco por tecla gastaria a cota antes de a frase terminar.
    const relogio = setTimeout(async () => {
      const r = await buscarAnexaveis({ projectId, tipo, termo });
      if (pedidoRef.current !== meuPedido) return;
      setCarregando(false);
      if (r.ok) {
        setItens(r.itens ?? []);
        setErro(null);
      } else {
        setItens([]);
        setErro(r.error ?? "Não foi possível buscar.");
      }
    }, 250);

    return () => clearTimeout(relogio);
  }, [projectId, tipo, termo]);

  function alternar(item: ItemAnexavel) {
    setEscolhidos((antes) => {
      const novo = new Map(antes);
      if (novo.has(item.id)) novo.delete(item.id);
      else novo.set(item.id, item);
      return novo;
    });
  }

  // Quantos dos escolhidos vão SAIR de outro projeto — inclusive os que a busca
  // atual não está mostrando. Ver o comentário de `escolhidos`.
  const mudamDeProjeto = [...escolhidos.values()].filter((i) => i.projetoAtual !== null).length;
  // Escolhidos que sumiram da lista visível por causa do termo de busca. O
  // número no botão contaria uma coisa que não está na tela; esta linha explica.
  const foraDaBusca = [...escolhidos.keys()].filter(
    (id) => !itens.some((i) => i.id === id),
  ).length;

  function confirmar() {
    const ids = [...escolhidos.keys()];
    if (ids.length === 0) return;
    iniciar(async () => {
      const r = await vincularAoProjeto({ projectId, tipo, ids });
      if (r.ok) {
        // Sem número no aviso, de propósito: `ids.length` é o que foi PEDIDO, e
        // um item apagado em outra aba entre a busca e o clique não entra. A
        // lista revalidada logo atrás mostra o que de fato ficou — repetir um
        // número de memória só cria a chance de ele divergir dela.
        toast("Vinculado ao projeto", "success");
        onDone();
      } else {
        toast(r.error ?? "Erro ao vincular", "error");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-corpo text-ink-muted">
        Vincular não copia nem tira nada do lugar: {def.artigo} {def.singular} continua em{" "}
        {def.modulo} e passa a aparecer também em «{nomeDoProjeto}».
      </p>

      <div>
        <label htmlFor={idDaBusca} className="mb-1.5 block text-corpo font-medium text-ink">
          Buscar {def.plural}
        </label>
        <input
          id={idDaBusca}
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          maxLength={80}
          autoFocus
          placeholder={`Nome ou trecho d${def.artigo} ${def.singular}`}
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />
      </div>

      {/* `aria-live` para quem não vê a lista repintar: o número de resultados é
          a única confirmação de que a digitação surtiu efeito. */}
      <div aria-live="polite" className="min-h-[1rem] text-legenda text-ink-subtle">
        {carregando
          ? "Buscando…"
          : erro
            ? ""
            : `${itens.length} ${itens.length === 1 ? "resultado" : "resultados"}`}
      </div>

      {erro && (
        <p role="alert" className="text-corpo text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}

      {!carregando && !erro && itens.length === 0 && (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-5 text-corpo text-ink-subtle">
          {termo.trim().length > 0
            ? `Nada encontrado fora deste projeto.`
            : `Não há ${def.plural} para vincular — o que existe já está aqui.`}
        </p>
      )}

      {itens.length > 0 && (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {itens.map((item) => {
            const marcado = escolhidos.has(item.id);
            return (
              <li key={item.id}>
                {/* O <label> inteiro é o alvo do toque (44px de altura mínima),
                    não só a caixinha de 16px. */}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => alternar(item)}
                    className="h-4 w-4 shrink-0 rounded border-line-strong"
                  />
                  <span className="min-w-0 flex-1 truncate text-corpo text-ink">{item.rotulo}</span>
                  {item.projetoAtual && (
                    /* O selo NÃO é uma cor, é texto: quem não distingue tons
                       precisa ler que este item vai mudar de projeto. */
                    <Badge tone="outline" className="shrink-0">
                      está em «{item.projetoAtual}»
                    </Badge>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {foraDaBusca > 0 && (
        <p className="text-legenda text-ink-subtle">
          {foraDaBusca === 1
            ? "1 item escolhido antes não aparece nesta busca, mas continua escolhido."
            : `${foraDaBusca} itens escolhidos antes não aparecem nesta busca, mas continuam escolhidos.`}{" "}
          Eles entram no vínculo do mesmo jeito — é por isso que o número do botão é maior que a
          lista.
        </p>
      )}

      {mudamDeProjeto > 0 && (
        <p className="rounded-md border border-line-strong bg-surface-muted px-3 py-2.5 text-corpo text-ink">
          {mudamDeProjeto === 1
            ? `1 item escolhido já está em outro projeto e vai MUDAR para «${nomeDoProjeto}».`
            : `${mudamDeProjeto} itens escolhidos já estão em outro projeto e vão MUDAR para «${nomeDoProjeto}».`}{" "}
          Um item pertence a um projeto de cada vez.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} type="button">
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={confirmar}
          disabled={salvando || escolhidos.size === 0}
        >
          {salvando ? "Vinculando…" : `Vincular ${escolhidos.size > 0 ? escolhidos.size : ""}`.trim()}
        </Button>
      </div>
    </div>
  );
}
