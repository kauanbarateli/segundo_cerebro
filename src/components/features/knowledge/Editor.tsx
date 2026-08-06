"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Content,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { updatePageContent } from "@/app/(app)/conhecimento/actions";
import { reconciliarPagina, rotuloDaPagina, semAcento } from "@/lib/knowledge";
import { cn } from "@/lib/utils";
import type { ProseMirrorDoc } from "@/lib/database.types";

/**
 * EDITOR DE PÁGINA (TipTap/ProseMirror).
 *
 * ESTE É O ÚNICO ARQUIVO DO PROJETO QUE PODE IMPORTAR `@tiptap/*` OU `lowlight`.
 * Nenhum outro arquivo pode importá-lo DIRETAMENTE: quem usa importa
 * `./EditorLoader`, que faz o `dynamic(..., { ssr: false })`. O motivo está
 * escrito por extenso lá, mas o resumo é: um import estático deste módulo em
 * qualquer lugar joga os ~150 kB do ProseMirror para dentro do bundle comum e
 * desfaz a correção C1 (lentidão entre abas) da Fase 1 — TODAS as rotas passam a
 * baixar o editor, inclusive as que não têm editor nenhum.
 *
 * CONTRATO DE MONTAGEM — quem renderiza PRECISA passar `key={pageId}`.
 * O App Router reaproveita a instância do componente ao navegar entre dois
 * valores do MESMO segmento dinâmico (`/conhecimento/pagina/A` →
 * `/conhecimento/pagina/B`): a posição na árvore do React é a mesma, então sem
 * `key` o React faz um RE-RENDER com props novas em vez de uma remontagem. O
 * editor mantém conteúdo, título e carimbo de concorrência em refs (é o que o
 * autosave exige), de modo que a instância reaproveitada continuaria segurando o
 * texto da página A enquanto a URL já diz B — e o primeiro autosave gravaria o
 * conteúdo de A por cima de B. Como isso é perda de dado SILENCIOSA, a violação
 * do contrato levanta exceção logo abaixo em vez de degradar.
 */

/* ------------------------------------------------------------------ lowlight */

/**
 * LINGUAGENS DO DESTAQUE DE SINTAXE — lista curta e explícita, de propósito.
 *
 * NÃO troque isto por `import { all } from 'lowlight'`. O `all` traz as ~190
 * gramáticas do highlight.js, ~500 kB de JavaScript, para um recurso que na
 * prática usa meia dúzia delas. O chunk do editor é carregado sob demanda, mas
 * "sob demanda" não torna meio megabyte aceitável: é o que o usuário espera
 * baixar toda vez que abre uma página do caderno.
 *
 * `createLowlight()` sem argumento nasce com registro VAZIO — só entra aqui o
 * que for importado nominalmente acima, e é isso que permite ao empacotador
 * descartar o resto do highlight.js.
 *
 * POR ISSO `highlight.js` É DEPENDÊNCIA DECLARADA em package.json, fixada em
 * `~11.11.0`. Ele já vinha instalado como dependência do lowlight e os imports
 * acima resolviam pela subida do pacote para a raiz de node_modules — arranjo
 * que quebra sob gerenciador com node_modules estrito (pnpm, yarn PnP) e que
 * deixaria a VERSÃO fora do nosso controle: os aliases logo abaixo dependem
 * literalmente do comportamento do 11.11, e uma troca silenciosa de versão faria
 * o destaque resolver a gramática errada. Declarada, a árvore não muda sozinha.
 */
const lowlight = createLowlight();

lowlight.register({
  bash,
  css,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  sql,
  typescript,
  xml,
});

/**
 * ALIASES — não são conveniência, são correção.
 *
 * O `register` acima aproveita os aliases declarados dentro de cada gramática do
 * highlight.js, e no 11.11 esses aliases têm dois problemas que mordem aqui:
 *
 *   1. A gramática do TYPESCRIPT declara os aliases `js`, `jsx`, `mjs`, `cjs` —
 *      os MESMOS do javascript, e não `ts`/`tsx`. Como o registro é por ordem de
 *      inserção, quem entrar por último fica com `js`. Resultado sem esta
 *      chamada: `ts` e `tsx` não resolvem nada (caem no `highlightAuto`) e `js`
 *      aponta para a gramática errada.
 *   2. A gramática do XML não declara alias nenhum, então `html` — o nome que
 *      todo mundo digita — simplesmente não existiria.
 *
 * Reafirmar `js`/`jsx` para javascript DEPOIS de registrar typescript é o que
 * desfaz o item 1; a ordem destas duas entradas importa.
 */
lowlight.registerAlias({
  typescript: ["ts", "tsx", "mts", "cts"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  xml: ["html", "xhtml", "svg", "vue"],
  bash: ["sh", "shell", "zsh"],
  python: ["py"],
  markdown: ["md"],
  plaintext: ["text", "txt"],
  sql: ["postgres", "postgresql", "psql"],
});

/** Rótulos do seletor de linguagem. Só nomes REGISTRADOS acima entram. */
const LINGUAGENS: { valor: string; rotulo: string }[] = [
  { valor: "plaintext", rotulo: "Texto simples" },
  { valor: "bash", rotulo: "Bash" },
  { valor: "css", rotulo: "CSS" },
  { valor: "xml", rotulo: "HTML / XML" },
  { valor: "javascript", rotulo: "JavaScript" },
  { valor: "json", rotulo: "JSON" },
  { valor: "markdown", rotulo: "Markdown" },
  { valor: "python", rotulo: "Python" },
  { valor: "sql", rotulo: "SQL" },
  { valor: "typescript", rotulo: "TypeScript" },
];

/* ------------------------------------------------------- menu de barra ("/") */

/**
 * MENU DE COMANDOS: digitar "/" no começo de uma palavra abre a lista de blocos.
 *
 * POR QUE ISTO NÃO USA `@tiptap/suggestion`. A extensão oficial existe e resolve
 * o mesmo problema, mas ela renderiza fora do React (`ReactRenderer` monta uma
 * segunda raiz) e traz o próprio contrato de teclado. Aqui o menu precisa ser um
 * `role="listbox"` que compartilha estado com o resto do editor, e o gatilho
 * cabe em três leituras do estado do ProseMirror. Uma dependência a mais custa
 * mais que este arquivo.
 *
 * O QUE O MENU É, DO PONTO DE VISTA DE ACESSIBILIDADE. O foco NÃO sai da área
 * editável — se saísse, as letras seguintes não filtrariam mais a lista. Então o
 * padrão correto é o do `aria-activedescendant`: a lista é um `listbox` com
 * `option`s de verdade, e a área editável aponta para a opção ativa. É o mesmo
 * arranjo de um campo de autocompletar, com a diferença de que o "campo" é um
 * `contenteditable`.
 */
interface ComandoDoMenu {
  id: string;
  rotulo: string;
  /** Texto de apoio à direita: o que a pessoa digitaria para chegar rápido. */
  dica: string;
  /** Palavras que casam, JÁ sem acento — a comparação não normaliza a tabela. */
  termos: string[];
  aplicar: (editor: Editor, de: number, ate: number) => void;
}

/**
 * A tabela.
 *
 * Cada comando primeiro APAGA o trecho "/consulta" e só então aplica o bloco, na
 * MESMA cadeia. Em duas cadeias separadas o texto sumiria numa transação e o
 * bloco mudaria noutra: seriam dois passos no histórico, e um Ctrl+Z desfaria só
 * metade — o parágrafo viraria título de novo com a barra de volta no meio.
 */
const COMANDOS: ComandoDoMenu[] = [
  {
    id: "texto",
    rotulo: "Texto",
    dica: "/texto",
    termos: ["texto", "paragrafo", "normal"],
    aplicar: (e, de, ate) => e.chain().focus().deleteRange({ from: de, to: ate }).setParagraph().run(),
  },
  {
    id: "titulo1",
    rotulo: "Título 1",
    dica: "/titulo1",
    termos: ["titulo1", "titulo", "cabecalho", "h1"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleHeading({ level: 1 }).run(),
  },
  {
    id: "titulo2",
    rotulo: "Título 2",
    dica: "/titulo2",
    termos: ["titulo2", "titulo", "cabecalho", "h2"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleHeading({ level: 2 }).run(),
  },
  {
    id: "titulo3",
    rotulo: "Título 3",
    dica: "/titulo3",
    termos: ["titulo3", "titulo", "cabecalho", "h3"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleHeading({ level: 3 }).run(),
  },
  {
    id: "lista",
    rotulo: "Lista com marcadores",
    dica: "/lista",
    termos: ["lista", "marcador", "topico", "ul"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleBulletList().run(),
  },
  {
    id: "numerada",
    rotulo: "Lista numerada",
    dica: "/numerada",
    termos: ["numerada", "numero", "ordenada", "ol"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleOrderedList().run(),
  },
  {
    id: "citacao",
    rotulo: "Citação",
    dica: "/citacao",
    termos: ["citacao", "quote", "bloco"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleBlockquote().run(),
  },
  {
    id: "codigo",
    rotulo: "Bloco de código",
    dica: "/codigo",
    termos: ["codigo", "code", "programa", "sql"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).toggleCodeBlock().run(),
  },
  {
    id: "linha",
    rotulo: "Linha divisória",
    dica: "/linha",
    termos: ["linha", "divisoria", "separador", "hr"],
    aplicar: (e, de, ate) =>
      e.chain().focus().deleteRange({ from: de, to: ate }).setHorizontalRule().run(),
  },
];

/**
 * Filtra por PREFIXO, e sem acento dos dois lados.
 *
 * Prefixo e não "contém": com `includes`, digitar "/o" traria Código, Citação e
 * Numerada — a lista deixaria de encurtar conforme se digita, que é a única
 * razão de ela filtrar. Sem acento porque ninguém digita "/código" com o acento
 * no meio de um comando.
 */
function filtrarComandos(consulta: string): ComandoDoMenu[] {
  const alvo = semAcento(consulta.trim());
  if (alvo.length === 0) return COMANDOS;
  return COMANDOS.filter((c) => c.termos.some((t) => t.startsWith(alvo)));
}

/** Estado do menu enquanto ele está aberto. Fechado = `null`. */
interface EstadoDoMenu {
  /** Posição da "/" no documento. É o início do trecho que o comando apaga. */
  pos: number;
  /** O que foi digitado depois da barra. */
  consulta: string;
  /** Coordenadas de tela (`position: fixed`), calculadas a partir da "/". */
  x: number;
  topo?: number;
  base?: number;
}

/** Altura suposta do menu, só para decidir se ele abre para cima ou para baixo. */
const ALTURA_DO_MENU = 300;
const LARGURA_DO_MENU = 260;
/** Depois disto o que veio da barra é texto, não comando: o menu desiste. */
const CONSULTA_MAXIMA = 24;

/* -------------------------------------------------------------- autosave */

/**
 * Atraso do autosave.
 *
 * 800 ms é o intervalo que separa "parou de digitar" de "pausa entre palavras"
 * para a maioria das pessoas. Menos que isso transforma digitação corrida numa
 * rajada de gravações; mais que isso aumenta a janela de perda quando o
 * navegador fecha sozinho.
 */
const ATRASO_AUTOSAVE_MS = 800;

type EstadoDoSalvamento = "ocioso" | "pendente" | "salvando" | "salvo" | "erro" | "conflito";

const ROTULO_DO_ESTADO: Record<EstadoDoSalvamento, string> = {
  ocioso: "",
  pendente: "Alterações não salvas",
  salvando: "Salvando...",
  salvo: "Salvo",
  erro: "Falha ao salvar",
  conflito: "Conflito",
};

/* ---------------------------------------------------------------- ícones */

/**
 * Ícones da barra de ferramentas, LOCAIS a este arquivo.
 *
 * Ficam aqui e não em `src/components/ui/Icons.tsx` porque aquele módulo é
 * importado por praticamente toda tela do aplicativo: sete ícones que só o
 * editor usa entrariam no bundle compartilhado de TODAS as rotas. Aqui eles
 * viajam dentro do chunk carregado sob demanda, que é onde são necessários.
 */
function svgBase(children: ReactNode) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Glifo = {
  ListaMarcador: () => svgBase(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" /></>),
  ListaNumero: () => svgBase(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 8V4l-1 .8M3 12h2.5L3 16h2.5" /></>),
  Citacao: () => svgBase(<><path d="M7 15c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3c0 3.5-2 5.5-4.5 6" /><path d="M17 15c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3c0 3.5-2 5.5-4.5 6" /></>),
  BlocoCodigo: () => svgBase(<><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /><path d="m13 6-2 12" /></>),
  Linha: () => svgBase(<path d="M4 12h16" />),
  Desfazer: () => svgBase(<><path d="M4 9h11a4.5 4.5 0 0 1 0 9h-6" /><path d="m8 5-4 4 4 4" /></>),
  Refazer: () => svgBase(<><path d="M20 9H9a4.5 4.5 0 0 0 0 9h6" /><path d="m16 5 4 4-4 4" /></>),
};

/* ---------------------------------------------------------- barra de ferramentas */

interface BotaoProps {
  rotulo: string;
  /** Presente = botão de ALTERNÂNCIA (vira `aria-pressed`). Ausente = ação. */
  ativo?: boolean;
  /**
   * Vira `aria-disabled`, NUNCA o atributo `disabled`.
   *
   * Botão com `disabled` some da ordem de foco, e numa barra com foco móvel
   * (roving tabindex) isso quebra a navegação por setas: o `focus()` no botão
   * desativado não faz nada e a seta parece travada. É também o que a APG
   * recomenda para `role="toolbar"`. A inibição real do clique fica no handler.
   */
  desativado?: boolean;
  indice: number;
  indiceComFoco: number;
  aoAcionar: () => void;
  children: ReactNode;
}

function BotaoDeFerramenta({
  rotulo,
  ativo,
  desativado,
  indice,
  indiceComFoco,
  aoAcionar,
  children,
}: BotaoProps) {
  return (
    <button
      type="button"
      data-ferramenta=""
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      aria-disabled={desativado || undefined}
      // Foco móvel: apenas UM botão da barra fica na ordem de tabulação, e as
      // setas movem o foco entre eles. Sem isso a barra viraria uma dezena de
      // paradas de Tab antes de o usuário chegar ao texto.
      tabIndex={indice === indiceComFoco ? 0 : -1}
      onClick={() => {
        if (desativado) return;
        aoAcionar();
      }}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-2 text-corpo font-medium transition-colors",
        desativado
          ? "cursor-not-allowed text-ink-subtle opacity-50"
          : ativo
            ? "bg-accent text-accent-ink"
            : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ props */

export interface EditorDePaginaProps {
  pageId: string;
  titulo: string;
  conteudo: ProseMirrorDoc;
  /**
   * `updated_at` da linha, EXATAMENTE como veio do banco.
   *
   * É o token de concorrência: vai em toda gravação e o banco compara dentro do
   * próprio UPDATE. Depois da montagem, quem manda é o carimbo devolvido por
   * cada gravação bem-sucedida — MAIS a reconciliação com as fotos que o
   * servidor manda depois (o efeito "reconciliação com o servidor", abaixo).
   *
   * Adotar esta prop CEGAMENTE seria errado, e continua proibido: se o carimbo
   * subiu porque outra aba gravou conteúdo, adotá-lo faz a gravação seguinte
   * apagar aquele conteúdo. Quem decide é `reconciliarPagina`, que só adota
   * quando o CONTEÚDO do servidor é o mesmo que o editor já conhecia — ou seja,
   * quando o carimbo subiu por renomear/mover, que é o que a barra lateral faz
   * na própria página aberta.
   */
  atualizadoEm: string;
}

/* ----------------------------------------------------------------- editor */

export default function EditorDePagina({
  pageId,
  titulo: tituloInicial,
  conteudo,
  atualizadoEm,
}: EditorDePaginaProps) {
  /* -- guarda do contrato de montagem (ver o cabeçalho do arquivo) --------- */
  const pageIdInicialRef = useRef(pageId);
  if (pageIdInicialRef.current !== pageId) {
    throw new Error(
      "EditorDePagina recebeu um pageId diferente do de montagem. " +
        "Renderize o editor com key={pageId}: sem a remontagem, o conteúdo da " +
        "página anterior seria gravado por cima desta.",
    );
  }

  /* -- estado visível ------------------------------------------------------ */
  const [titulo, setTitulo] = useState(tituloInicial);
  const [estado, setEstado] = useState<EstadoDoSalvamento>("ocioso");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [documentoInvalido, setDocumentoInvalido] = useState(false);
  const [indiceComFoco, setIndiceComFoco] = useState(0);

  /* -- refs do autosave ----------------------------------------------------
   * Tudo aqui é ref, e não estado, porque o autosave precisa do valor MAIS
   * RECENTE dentro de callbacks que não são recriados a cada tecla (o timer, o
   * `onUpdate` do ProseMirror, a limpeza de desmontagem). Estado nesses lugares
   * daria closure velha: gravar-se-ia o texto de dois segundos atrás. */

  /**
   * Último documento conhecido, como NÓ do ProseMirror — não como JSON.
   *
   * Guardar o nó custa uma atribuição de referência por tecla, porque documentos
   * do ProseMirror são imutáveis: cada transação produz um nó novo e o anterior
   * continua válido. Serializar (`toJSON`) a cada tecla, ao contrário, percorre a
   * árvore inteira e seria trabalho jogado fora entre uma gravação e outra.
   *
   * O ganho decisivo, porém, é de CICLO DE VIDA: como o nó é autossuficiente, a
   * limpeza de desmontagem consegue montar o pacote de gravação mesmo depois de
   * o TipTap ter destruído a instância do editor. Depender de
   * `editor.getJSON()` naquele ponto seria depender da ordem em que o React roda
   * as limpezas de dois efeitos diferentes.
   */
  const docRef = useRef<Editor["state"]["doc"] | null>(null);
  const tituloRef = useRef(tituloInicial);
  const tituloSalvoRef = useRef(tituloInicial);
  const carimboRef = useRef(atualizadoEm);

  /**
   * O conteúdo que o editor SABE estar gravado no servidor.
   *
   * Nasce da prop e é atualizado a cada gravação bem-sucedida (com o documento
   * que a gravação levou). Não é o documento na tela: enquanto o usuário digita,
   * os dois divergem de propósito.
   *
   * Serve a uma pergunta só, e ela é a chave do efeito de reconciliação: quando
   * uma foto nova chega do servidor, o conteúdo dela é o mesmo que já
   * conhecíamos (então o carimbo subiu por renomear/mover e pode ser adotado) ou
   * é conteúdo novo de outro lugar (então é conflito de verdade)?
   */
  const conteudoNoServidorRef = useRef<unknown>(conteudo);

  /**
   * Contador de versão local: `versaoRef` sobe a cada edição, `versaoSalvaRef`
   * recebe a versão que a gravação levou.
   *
   * Comparar as duas responde "há algo por salvar?" em tempo constante. A
   * alternativa — comparar o documento com o último gravado — exigiria manter
   * uma cópia serializada e compará-la a cada verificação, caro e sem ganho: o
   * pior caso de um contador é uma gravação redundante.
   */
  const versaoRef = useRef(0);
  const versaoSalvaRef = useRef(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emVooRef = useRef(false);
  /** Promessa da gravação em voo — a limpeza de desmontagem espera por ela. */
  const emVooPromessaRef = useRef<Promise<unknown> | null>(null);
  /** Trava definitiva: conflito ou documento ilegível. Nada mais é gravado. */
  const bloqueadoRef = useRef(false);
  const montadoRef = useRef(true);
  /** Saída deliberada (o usuário clicou em recarregar): não avisar de novo. */
  const saindoRef = useRef(false);
  const salvarRef = useRef<(() => void) | null>(null);
  const docInvalidoRef = useRef(false);

  /* -- montagem do pacote de gravação -------------------------------------- */

  const montarPacote = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return null;
    const tituloAtual = tituloRef.current;
    return {
      id: pageId,
      content: doc.toJSON() as ProseMirrorDoc,
      updatedAt: carimboRef.current,
      /**
       * `title` SÓ quando mudou — é contrato com a action, não economia de
       * bytes. É o título que dispara `revalidatePath`, e mandá-lo em todo
       * autosave faria o roteador descartar o cache da rota a cada poucos
       * segundos de digitação.
       */
      ...(tituloAtual !== tituloSalvoRef.current ? { title: tituloAtual } : {}),
    };
  }, [pageId]);

  const armarTimer = useCallback(() => {
    if (bloqueadoRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      salvarRef.current?.();
    }, ATRASO_AUTOSAVE_MS);
  }, []);

  const salvar = useCallback(async () => {
    if (bloqueadoRef.current) return;
    // Nada mudou desde a última gravação bem-sucedida.
    if (versaoRef.current === versaoSalvaRef.current) return;
    /**
     * JÁ EXISTE UMA GRAVAÇÃO EM VOO — e esta guarda é a que evita o conflito
     * FALSO, o modo de falha mais provável de todo este arquivo.
     *
     * Cada gravação devolve um carimbo novo, e a seguinte precisa usá-lo. Duas
     * gravações em paralelo sairiam com o MESMO carimbo antigo; a primeira a
     * chegar ao banco muda o `updated_at`, e a segunda não encontra mais a linha
     * — o usuário veria "Conflito" por ter digitado rápido, sozinho, numa aba
     * só. Serializando, o carimbo está sempre fresco.
     *
     * O que ficou de fora não se perde: o bloco de sucesso rearma o timer quando
     * percebe que a versão subiu durante a ida ao servidor.
     */
    if (emVooRef.current) return;

    const pacote = montarPacote();
    if (!pacote) return;

    const versaoEnviada = versaoRef.current;
    const tituloEnviado = tituloRef.current;

    emVooRef.current = true;
    if (montadoRef.current) setEstado("salvando");

    const promessa = updatePageContent(pacote);
    emVooPromessaRef.current = promessa;

    try {
      const r = await promessa;

      if (r.ok) {
        if (r.updatedAt) carimboRef.current = r.updatedAt;
        versaoSalvaRef.current = versaoEnviada;
        tituloSalvoRef.current = tituloEnviado;
        // O servidor agora tem EXATAMENTE este documento. É a partir daqui que a
        // reconciliação decide se uma foto futura traz conteúdo novo ou só um
        // carimbo novo.
        conteudoNoServidorRef.current = pacote.content;
        if (montadoRef.current) {
          setMensagem(null);
          setEstado(versaoRef.current === versaoEnviada ? "salvo" : "pendente");
        }
        // Digitou durante a ida ao servidor: rearma o ciclo em vez de gravar
        // imediatamente, senão digitação contínua viraria uma gravação por
        // ida-e-volta de rede.
        if (versaoRef.current !== versaoEnviada) armarTimer();
      } else if (r.conflict) {
        /**
         * A CORRIDA COM A BARRA LATERAL, e é conflito FALSO.
         *
         * A gravação saiu com o carimbo X; enquanto ela viajava, a reconciliação
         * adotou um carimbo Y (renomear/mover na própria página aberta, ver o
         * efeito lá embaixo). O banco recusou por causa de X, não por causa de
         * conteúdo: adotar Y só aconteceu porque o CONTEÚDO do servidor era o
         * mesmo que já conhecíamos, então não existe versão alheia para
         * preservar. As duas condições juntas identificam esse caso sem
         * ambiguidade — o carimbo local mudou desde o envio E o banco está
         * exatamente no carimbo que reconciliamos. Rearmar o timer repete a
         * gravação com o carimbo fresco em vez de travar o editor.
         */
        if (
          r.updatedAt &&
          pacote.updatedAt !== carimboRef.current &&
          r.updatedAt === carimboRef.current
        ) {
          if (montadoRef.current) {
            setEstado("pendente");
            setMensagem(null);
          }
          armarTimer();
          return;
        }

        /**
         * CONFLITO DE VERDADE — trava tudo, e o carimbo do banco NÃO é adotado.
         *
         * Adotá-lo faria a gravação seguinte passar, apagando a versão que a
         * outra aba (ou o outro dispositivo) gravou. O carimbo novo só teria uso
         * numa fusão de versões, que está fora do escopo congelado da v1. Aqui a
         * única saída é o usuário decidir, e a decisão oferecida é recarregar.
         */
        bloqueadoRef.current = true;
        if (montadoRef.current) {
          setEstado("conflito");
          setMensagem(r.error ?? "Esta página mudou em outro lugar.");
        }
      } else {
        /**
         * Erro comum (rede, sessão expirada, página apagada). NÃO rearma o
         * timer: uma nova tentativa automática sobre uma causa persistente —
         * página apagada, por exemplo — viraria um laço de requisições que só
         * para quando a aba fecha. A retentativa acontece na próxima tecla
         * digitada ou no botão explícito.
         */
        if (montadoRef.current) {
          setEstado("erro");
          setMensagem(r.error ?? "Não foi possível salvar.");
        }
      }
    } catch {
      if (montadoRef.current) {
        setEstado("erro");
        setMensagem("Sem conexão com o servidor. Suas alterações continuam nesta aba.");
      }
    } finally {
      emVooRef.current = false;
      emVooPromessaRef.current = null;
    }
  }, [montarPacote, armarTimer]);

  useEffect(() => {
    salvarRef.current = () => {
      void salvar();
    };
  }, [salvar]);

  const marcarSujo = useCallback(() => {
    if (bloqueadoRef.current) return;
    versaoRef.current += 1;
    setEstado((anterior) => (anterior === "salvando" ? anterior : "pendente"));
    armarTimer();
  }, [armarTimer]);

  /* -- menu de barra --------------------------------------------------------
   * Ver o bloco de comentário da tabela `COMANDOS`, acima. Aqui mora só o
   * rastreamento: onde está a "/", o que foi digitado depois dela e quando
   * desistir. */

  const [menu, setMenu] = useState<EstadoDoMenu | null>(null);
  const [indiceDoComando, setIndiceDoComando] = useState(0);
  const idDoMenu = useId();

  /** Posição da "/" que abriu o menu. Ref porque é lida dentro do ProseMirror. */
  const posBarraRef = useRef<number | null>(null);

  const comandos = useMemo(() => (menu ? filtrarComandos(menu.consulta) : []), [menu]);
  const menuVisivel = menu !== null && comandos.length > 0;

  /**
   * Espelhos do estado do menu para o `handleKeyDown`.
   *
   * `handleKeyDown` é capturado pelo ProseMirror quando o editor é CRIADO, e
   * enxergaria para sempre o valor do primeiro render. Refs sincronizadas por
   * efeito resolvem: o efeito roda antes do próximo evento de teclado, então o
   * que a tecla lê é sempre o estado do quadro que está na tela.
   */
  const menuRef = useRef<EstadoDoMenu | null>(null);
  const comandosRef = useRef<ComandoDoMenu[]>([]);
  const indiceRef = useRef(0);
  const aplicarComandoRef = useRef<((indice: number) => void) | null>(null);

  useEffect(() => {
    menuRef.current = menu;
    comandosRef.current = comandos;
    indiceRef.current = indiceDoComando;
  }, [menu, comandos, indiceDoComando]);

  const fecharMenu = useCallback(() => {
    posBarraRef.current = null;
    // `setMenu(null)` com o menu já fechado não re-renderiza (o React compara
    // por identidade e desiste), então chamar isto a cada transação é barato.
    setMenu(null);
  }, []);

  /**
   * Decide, a cada transação, se o menu abre, muda ou fecha.
   *
   * `permitirAbrir` só é verdadeiro quando a transação MEXEU NO DOCUMENTO. Sem
   * essa distinção, mover o cursor com a seta para logo depois de uma "/" que já
   * estava escrita no texto abriria o menu sozinho — o gatilho é DIGITAR a
   * barra, não estar ao lado de uma.
   */
  const sincronizarMenu = useCallback(
    (instancia: Editor, permitirAbrir: boolean) => {
      /*
        SEM VIEW MONTADA NÃO HÁ MENU A POSICIONAR — e tocar nela aqui LANÇA.

        Ver o aviso longo no efeito de `aria-activedescendant`, mais abaixo: com
        `immediatelyRender: true` a instância existe antes de a view existir, e
        `instancia.view` nesse intervalo é um Proxy que lança em quase toda
        propriedade. O `coordsAtPos` do fim desta função é uma delas.

        Sair cedo é o comportamento certo, não um remendo: este callback só tem
        trabalho quando existe uma área editável na tela para medir.
      */
      if (!instancia.isInitialized) return;

      const { state } = instancia;
      const selecao = state.selection;

      // Seleção de trecho não tem "cursor" onde ancorar; dentro de bloco de
      // código "/" é código, e um menu de formatação ali não faria sentido.
      if (!selecao.empty || instancia.isActive("codeBlock")) {
        fecharMenu();
        return;
      }

      const cursor = selecao.from;
      let pos = posBarraRef.current;

      if (pos === null) {
        if (!permitirAbrir) return;
        // Texto do começo do bloco até o cursor. `parentOffset` é a distância
        // do cursor ao início do conteúdo do nó pai — subtrair dá o início.
        const inicioDoBloco = cursor - selecao.$from.parentOffset;
        const antes = state.doc.textBetween(inicioDoBloco, cursor, "\n", "\n");
        if (!antes.endsWith("/")) return;
        // A barra precisa COMEÇAR uma palavra. Sem isto, "e/ou" e qualquer
        // caminho de arquivo digitado no meio de uma frase abririam o menu.
        const anterior = antes.slice(-2, -1);
        if (anterior !== "" && !/\s/.test(anterior)) return;
        pos = cursor - 1;
        posBarraRef.current = pos;
      }

      // A barra pode ter sido apagada ou o cursor ter ido para trás dela.
      if (
        cursor <= pos ||
        pos >= state.doc.content.size ||
        state.doc.textBetween(pos, pos + 1, "\n", "\n") !== "/"
      ) {
        fecharMenu();
        return;
      }

      const consulta = state.doc.textBetween(pos + 1, cursor, "\n", "\n");
      // Espaço encerra: quem escreveu "/ ou" está escrevendo texto.
      if (/\s/.test(consulta) || consulta.length > CONSULTA_MAXIMA) {
        fecharMenu();
        return;
      }

      const coords = instancia.view.coordsAtPos(pos);
      // Abre para cima quando não cabe embaixo, e nunca ultrapassa a borda
      // direita — um menu cortado pela janela é um menu inutilizável.
      const paraCima = coords.bottom + ALTURA_DO_MENU > window.innerHeight;
      const proximo: EstadoDoMenu = {
        pos,
        consulta,
        x: Math.max(8, Math.min(coords.left, window.innerWidth - LARGURA_DO_MENU - 8)),
        ...(paraCima
          ? { base: Math.max(8, window.innerHeight - coords.top + 6) }
          : { topo: coords.bottom + 6 }),
      };

      // O índice volta ao topo só quando a LISTA muda (a consulta mudou). Senão
      // cada rolagem de página desfaria a escolha feita com as setas.
      if (menuRef.current?.consulta !== consulta) setIndiceDoComando(0);
      setMenu(proximo);
    },
    [fecharMenu],
  );

  /* -- instância do TipTap -------------------------------------------------- */

  const editor = useEditor({
    /**
     * ⚠️ ESTA FLAG DEPENDE DE OUTRO ARQUIVO. `immediatelyRender: true` só é
     * seguro porque `EditorLoader.tsx` monta este módulo com `ssr: false` — não
     * existe HTML de servidor deste componente para divergir na hidratação, o
     * servidor emite o esqueleto do `loading` daquele arquivo. Se aquele
     * `ssr: false` sair, esta linha tem que sair junto.
     *
     * SEM ELA O MÓDULO INTEIRO QUEBRA, e quebra de um jeito que o compilador não
     * vê. O TipTap 3 detecta o Next (`window.next`, posto por
     * `next/dist/client/app-bootstrap.js`) e, quando a flag é `undefined`,
     * desliga a criação imediata e devolve `null` no primeiro render. Só que os
     * overloads de `useEditor` prometem `Editor` não-nulo justamente no caso sem
     * a flag — então `tsc` passa limpo e o `useEditorState` lá embaixo, que roda
     * DURANTE a renderização, estoura em `e.isActive("bold")` com o editor nulo.
     * A página cai no `error.tsx` antes de pintar qualquer coisa.
     *
     * `false` corrigiria o mesmo bug fazendo o compilador exigir o tratamento do
     * nulo — ao custo de mexer em ~15 pontos deste arquivo (o seletor inteiro e
     * todos os handlers da barra) para tratar um nulo que aqui nunca acontece.
     */
    immediatelyRender: true,
    /**
     * `codeBlock: false` desliga o bloco de código SIMPLES do StarterKit para
     * que o `CodeBlockLowlight` ocupe o nome `codeBlock` sem colisão de schema —
     * dois nós com o mesmo nome fazem o ProseMirror recusar a montagem.
     */
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
    ],
    /**
     * A ASSERÇÃO DE TIPO AQUI É O ENCONTRO DE DUAS FRONTEIRAS, e não preguiça.
     *
     * `ProseMirrorDoc` declara `content?: unknown[]` de propósito: `data.ts` e
     * `validation.ts` garantem a RAIZ (`type` presente, tamanho e profundidade
     * limitados) e deixam explicitamente o schema dos NÓS para quem tem o
     * editor — este arquivo. Ou seja, o `unknown` não é ignorância acidental, é
     * a divisão de responsabilidade combinada; converter é justamente o ato de
     * assumir a metade que cabe aqui.
     *
     * O que sustenta a conversão em tempo de execução é o `enableContentCheck`
     * logo abaixo: se algum nó não existir no schema, o editor não engole
     * calado, cai em `onContentError` e a gravação é travada. A asserção
     * promete ao compilador só aquilo que a verificação confere de fato.
     */
    content: conteudo as Content,
    /**
     * Verificação do conteúdo LIGADA, e é a defesa contra a pior perda de dado
     * possível aqui.
     *
     * O ProseMirror descarta em silêncio todo nó que não exista no schema atual.
     * Um documento gravado por uma versão futura do editor (ou por uma extensão
     * que alguém remover depois) seria aberto MUTILADO, e o primeiro autosave
     * gravaria a mutilação por cima do original — sem erro, sem aviso, sem
     * desfazer. Com a verificação, o caso vira `onContentError`, que TRAVA a
     * gravação e mostra o aviso. Melhor uma página temporariamente somente
     * leitura do que um parágrafo apagado para sempre.
     */
    enableContentCheck: true,
    onContentError: ({ editor: instancia }) => {
      // Nada de `setState` aqui: este callback roda durante a construção do
      // editor, que acontece na fase de renderização. O sinal vai por ref e
      // vira estado no efeito de montagem, abaixo.
      docInvalidoRef.current = true;
      bloqueadoRef.current = true;
      instancia.setEditable(false, false);
    },
    onCreate: ({ editor: instancia }) => {
      docRef.current = instancia.state.doc;
    },
    onUpdate: ({ editor: instancia }) => {
      docRef.current = instancia.state.doc;
      marcarSujo();
      // Só aqui o menu PODE abrir: mudou o documento, então a "/" acabou de ser
      // digitada. Ver `sincronizarMenu`.
      sincronizarMenu(instancia, true);
    },
    onSelectionUpdate: ({ editor: instancia }) => {
      // Cursor andou sem mexer no texto: o menu aberto pode precisar fechar (o
      // cursor saiu de perto da barra), mas nunca abrir.
      sincronizarMenu(instancia, false);
    },
    onBlur: () => {
      // Sair da área editável encerra o comando. O clique numa opção do menu não
      // passa por aqui: o `onMouseDown` da opção cancela o gesto que tiraria o
      // foco (ver o `role="listbox"` lá embaixo).
      fecharMenu();
    },
    editorProps: {
      /**
       * O teclado do menu, interceptado ANTES do ProseMirror.
       *
       * Devolver `true` consome a tecla; `false` deixa seguir. Com o menu aberto,
       * Enter não pode virar parágrafo novo e as setas não podem mover o cursor —
       * senão o menu perde a âncora no mesmo gesto em que se tenta escolher.
       *
       * `indiceRef` é atualizado à mão aqui, além do `setState`: dois ArrowDown
       * no mesmo quadro leriam o mesmo valor se dependessem só do estado.
       */
      handleKeyDown: (_vista, evento) => {
        const lista = comandosRef.current;
        if (menuRef.current === null || lista.length === 0) return false;

        if (evento.key === "Escape") {
          fecharMenu();
          return true;
        }
        if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
          const passo = evento.key === "ArrowDown" ? 1 : -1;
          const proximo = (indiceRef.current + passo + lista.length) % lista.length;
          indiceRef.current = proximo;
          setIndiceDoComando(proximo);
          return true;
        }
        if (evento.key === "Enter" || evento.key === "Tab") {
          aplicarComandoRef.current?.(indiceRef.current);
          return true;
        }
        return false;
      },
      attributes: {
        class: "sb-editor-conteudo",
        /**
         * Rótulo acessível da área editável.
         *
         * Repare que NÃO há `role="textbox"`. Um `contenteditable` já é
         * anunciado como área de edição pelos leitores de tela, e forçar o papel
         * de caixa de texto ACHATA a semântica interna: títulos, listas e
         * citações deixam de ser navegáveis pelos atalhos de estrutura, que é
         * justamente o que torna um editor rico utilizável sem enxergar a tela.
         */
        "aria-label": "Conteúdo da página",
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
  });

  /* -- aplicação do comando escolhido --------------------------------------- */

  /**
   * Apaga o "/consulta" e aplica o bloco.
   *
   * O fim do trecho é lido do estado NA HORA (`selection.from`), não do que o
   * menu guardou: entre a última sincronização e o Enter pode ter entrado mais
   * uma letra. Usar o valor guardado deixaria essa letra órfã no texto.
   */
  const aplicarComando = useCallback(
    (indice: number) => {
      const estado = menuRef.current;
      const lista = comandosRef.current;
      const comando = lista[indice] ?? lista[0];
      // Fecha ANTES de qualquer desistência: um menu que continua aberto depois
      // de o usuário ter apertado Enter continuaria engolindo o Enter seguinte,
      // e a página pararia de aceitar parágrafo novo até alguém clicar fora.
      fecharMenu();
      if (!estado || !comando) return;
      const ate = editor.state.selection.from;
      if (ate < estado.pos) return;
      comando.aplicar(editor, estado.pos, ate);
    },
    [editor, fecharMenu],
  );

  useEffect(() => {
    aplicarComandoRef.current = aplicarComando;
  }, [aplicarComando]);

  /**
   * O menu é `position: fixed` e a âncora é uma posição do DOCUMENTO: rolar a
   * página move o texto e deixa o menu para trás. Recalcular na rolagem custa
   * uma leitura de coordenadas e só acontece com o menu aberto.
   *
   * `true` na captura porque a rolagem que interessa pode ser de um ancestral
   * com barra própria, e evento de rolagem não sobe até a janela.
   */
  useEffect(() => {
    if (!menuVisivel) return;
    const recalcular = () => sincronizarMenu(editor, false);
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);
    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
    };
  }, [menuVisivel, editor, sincronizarMenu]);

  /**
   * Liga a área editável ao menu para quem usa leitor de tela.
   *
   * Os atributos vão direto no DOM do ProseMirror, e não em
   * `editorProps.attributes`, porque aquele objeto é montado uma vez e mudá-lo a
   * cada tecla recriaria as props do editor inteiro. O ProseMirror só remove os
   * atributos que ELE mesmo colocou, então estes ficam intactos entre
   * atualizações.
   *
   * Não há `role="combobox"` aqui de propósito: ele transformaria a área de
   * edição numa caixa de texto simples para o leitor de tela e apagaria a
   * navegação por títulos e listas dentro do documento — um prejuízo permanente
   * em troca de um menu que aparece por dois segundos. `aria-activedescendant` é
   * o que faz o trabalho, e ele não exige o papel.
   */
  useEffect(() => {
    /*
      =========================================================================
      ⚠️ `editor.view` NÃO É UM CAMPO QUE PODE SER NULO — É UM PROXY QUE LANÇA
      =========================================================================
      A versão anterior desta linha era `const dom = editor.view?.dom`, e o `?.`
      não protegia NADA. Quando a view ainda não montou, o TipTap 3 devolve em
      `editor.view` um Proxy (@tiptap/core, "The editor view is not available"):
      ele é um objeto, portanto TRUTHY, portanto o `?.` passa direto — e quem
      lança é o acesso a `.dom`, porque o Proxy só finge ter `dispatch`,
      `composing`, `dragging`, `editable`, `isDestroyed` e `state`. `dom` não
      está na lista.

      E o compilador não podia ajudar: o tipo declarado é `get view(): EditorView`,
      não-nulo. Para o TypeScript, o `?.` era até redundante.

      QUANDO ISSO ACONTECE NA PRÁTICA. Com `immediatelyRender: true` — que é o
      que esta tela precisa, porque `EditorLoader` a monta com `ssr: false` — a
      INSTÂNCIA passa a existir já no primeiro render, enquanto a VIEW só nasce
      quando o `EditorContent` entra no DOM. Este efeito depende de `comandos` e
      `indiceDoComando`, então roda em passagens em que aquela janela ainda está
      aberta. O sintoma era a tela de erro do módulo ao abrir uma página, com o
      "Tentar novamente" funcionando — porque a remontagem chega com a view já
      pronta.

      A guarda é `isInitialized`, e ela é CONSERVADORA de propósito: o Proxy
      consulta um campo interno que não é essa flag, então existe janela em que a
      view já existe e `isInitialized` ainda é falso. O custo é pular estes
      atributos numa passagem — e eles são reaplicados na próxima, porque o
      efeito depende de `menuVisivel`, `comandos` e `indiceDoComando`. O erro
      inverso, tocar na view cedo demais, derruba o módulo inteiro.

      NÃO troque por `?.` (inútil, ver acima), nem por `try/catch` (esconderia
      erro real do ProseMirror), nem por `editor.isDestroyed` (responde outra
      pergunta: se o editor ACABOU, não se ele começou).

      O contrato está travado em `tiptap-view.test.ts`, ao lado.
    */
    if (!editor.isInitialized) return;
    const dom = editor.view.dom;
    if (menuVisivel) {
      const ativo = comandos[indiceDoComando] ?? comandos[0];
      dom.setAttribute("aria-expanded", "true");
      dom.setAttribute("aria-controls", idDoMenu);
      if (ativo) dom.setAttribute("aria-activedescendant", `${idDoMenu}-${ativo.id}`);
    } else {
      dom.removeAttribute("aria-expanded");
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [editor, menuVisivel, comandos, indiceDoComando, idDoMenu]);

  /* -- ciclo de vida -------------------------------------------------------- */

  useEffect(() => {
    montadoRef.current = true;
    if (docInvalidoRef.current) setDocumentoInvalido(true);
    return () => {
      montadoRef.current = false;
    };
  }, []);

  /**
   * RECONCILIAÇÃO COM O SERVIDOR — a correção do conflito falso de uma aba só.
   *
   * A barra lateral mexe na página ABERTA: renomear e mover disparam o trigger
   * `set_updated_at` e depois um `router.refresh()`. Como esta tela é montada com
   * `key={pageId}` e o id não mudou, o React RE-RENDERIZA em vez de remontar — as
   * props chegam novas, as refs continuam velhas. Sem este efeito, o carimbo
   * congela no valor da montagem, a próxima gravação bate em zero linhas e vira
   * "Conflito" para um usuário que está sozinho numa aba só; e o campo de título
   * continua exibindo o nome antigo enquanto a barra lateral já mostra o novo.
   *
   * A DECISÃO NÃO MORA AQUI. Ela é uma função pura em `@/lib/knowledge`
   * (`reconciliarPagina`), com teste, porque é ela que separa "o carimbo subiu
   * por causa de um rótulo" de "outra aba gravou conteúdo" — e errar para o lado
   * permissivo apagaria o texto do outro lado sem deixar rastro. Aqui fica só a
   * aplicação do resultado.
   *
   * As props do documento entram nas dependências mesmo sendo objeto novo a cada
   * renderização do servidor: isso faz o efeito rodar a cada `router.refresh()`,
   * que é exatamente quando há foto nova para reconciliar, e não a cada tecla
   * (digitar não re-renderiza este componente com props novas).
   */
  useEffect(() => {
    // Documento ilegível ou conflito real já travaram a gravação; adotar carimbo
    // depois disso não destravaria nada e só confundiria o diagnóstico.
    if (bloqueadoRef.current) return;

    const decisao = reconciliarPagina(
      {
        carimbo: carimboRef.current,
        tituloAtual: tituloRef.current,
        tituloSalvo: tituloSalvoRef.current,
        conteudoNoServidor: conteudoNoServidorRef.current,
      },
      { carimbo: atualizadoEm, titulo: tituloInicial, conteudo },
    );

    if (decisao.carimbo === null) return;

    carimboRef.current = decisao.carimbo;
    conteudoNoServidorRef.current = conteudo;

    if (decisao.titulo !== null) {
      tituloRef.current = decisao.titulo;
      // Também o "salvo": o valor VEIO do servidor, então não há nada pendente
      // nele. Sem esta linha o próximo autosave mandaria `title` de novo e
      // dispararia um `revalidatePath` inútil.
      tituloSalvoRef.current = decisao.titulo;
      setTitulo(decisao.titulo);
    }
  }, [atualizadoEm, tituloInicial, conteudo]);

  /**
   * DESMONTAGEM: limpa o timer E NÃO PERDE O QUE ESTAVA PENDENTE.
   *
   * Navegar para outra página no meio dos 800 ms de espera é o caso comum —
   * escreve-se uma frase e clica-se num link da barra lateral. Apenas limpar o
   * timer descartaria a frase. Então a limpeza GRAVA, sem esperar resposta: a
   * requisição já saiu do navegador e o servidor a processa mesmo com a árvore
   * do React desmontada.
   *
   * O caso torto é haver uma gravação EM VOO com edições mais novas por cima
   * dela. Disparar agora usaria o carimbo antigo (o novo ainda está vindo) e o
   * banco recusaria por conflito — perdendo exatamente as últimas teclas. Por
   * isso, quando há algo em voo, a gravação final é ENFILEIRADA no `then` da
   * promessa: quando ela roda, `carimboRef` já foi atualizado pelo caminho de
   * sucesso. `then(enviar, enviar)` cobre também a rejeição, em que o carimbo
   * continua valendo e a nova tentativa é legítima.
   */
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const enviar = () => {
        if (bloqueadoRef.current) return;
        if (versaoRef.current === versaoSalvaRef.current) return;
        const pacote = montarPacote();
        if (!pacote) return;
        // Sem `await` e sem tratar o resultado: não há mais interface para
        // avisar. O `catch` vazio existe só para não deixar rejeição solta.
        void updatePageContent(pacote).catch(() => {});
      };

      const emVoo = emVooPromessaRef.current;
      if (emVoo) void emVoo.then(enviar, enviar);
      else enviar();
    };
  }, [montarPacote]);

  /**
   * Aviso ao FECHAR a aba ou recarregar.
   *
   * A limpeza de desmontagem acima não roda nesse caminho — o React não desmonta
   * nada quando o documento inteiro vai embora. Uma gravação disparada aqui
   * também não é confiável (o navegador cancela requisições pendentes), então o
   * honesto é avisar e deixar a pessoa decidir, em vez de fingir que salvou.
   *
   * O conflito também entra na condição: sair com um conflito em aberto descarta
   * a versão local, que é a única cópia do que foi digitado.
   *
   * O OUVINTE SÓ EXISTE ENQUANTO HÁ O QUE PERDER, e isso não é economia de
   * memória: um `beforeunload` registrado impede o navegador de guardar a página
   * no cache de retorno (bfcache), e sem bfcache o "voltar" do navegador
   * remonta a rota inteira em vez de restaurá-la instantaneamente. Numa página
   * já salva não há o que avisar, então também não há por que pagar esse preço.
   * `estado` serve de gatilho porque é a única parte do controle de sujeira que
   * mora em estado do React; a condição de verdade continua sendo lida das refs
   * dentro do próprio handler, que enxerga o valor do instante da saída.
   */
  const podePerderTexto =
    estado === "pendente" || estado === "salvando" || estado === "erro" || estado === "conflito";

  useEffect(() => {
    if (!podePerderTexto) return;
    const aoSair = (evento: BeforeUnloadEvent) => {
      if (saindoRef.current) return;
      const pendente = versaoRef.current !== versaoSalvaRef.current;
      if (!pendente && !bloqueadoRef.current) return;
      evento.preventDefault();
      evento.returnValue = "";
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [podePerderTexto]);

  /* -- estado derivado da barra --------------------------------------------
   * `useEditorState` é OBRIGATÓRIO aqui. No TipTap 3 o `useEditor` deixou de
   * re-renderizar o componente a cada transação (era o comportamento do 2, e
   * custava um render por tecla). Sem se inscrever, `editor.isActive("bold")`
   * seria lido uma vez e os `aria-pressed` da barra congelariam — mostrando o
   * estado de formatação de onde o cursor estava na montagem. */
  const marcas = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrito: e.isActive("bold"),
      italico: e.isActive("italic"),
      riscado: e.isActive("strike"),
      codigo: e.isActive("code"),
      titulo1: e.isActive("heading", { level: 1 }),
      titulo2: e.isActive("heading", { level: 2 }),
      titulo3: e.isActive("heading", { level: 3 }),
      listaMarcador: e.isActive("bulletList"),
      listaNumero: e.isActive("orderedList"),
      citacao: e.isActive("blockquote"),
      blocoCodigo: e.isActive("codeBlock"),
      linguagem: (e.getAttributes("codeBlock").language as string | undefined) ?? "plaintext",
      podeDesfazer: e.can().undo(),
      podeRefazer: e.can().redo(),
    }),
  });

  const barraRef = useRef<HTMLDivElement>(null);

  /** Setas/Home/End movem o foco dentro da barra (padrão `role="toolbar"`). */
  const aoTeclarNaBarra = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    const botoes = Array.from(
      barraRef.current?.querySelectorAll<HTMLButtonElement>("button[data-ferramenta]") ?? [],
    );
    if (botoes.length === 0) return;
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (atual < 0) return;

    let destino: number;
    if (evento.key === "ArrowRight") destino = (atual + 1) % botoes.length;
    else if (evento.key === "ArrowLeft") destino = (atual - 1 + botoes.length) % botoes.length;
    else if (evento.key === "Home") destino = 0;
    else if (evento.key === "End") destino = botoes.length - 1;
    else return;

    evento.preventDefault();
    botoes[destino]?.focus();
    setIndiceComFoco(destino);
  };

  const aoMudarTitulo = (valor: string) => {
    tituloRef.current = valor;
    setTitulo(valor);
    marcarSujo();
  };

  const recarregar = () => {
    // Desarma o aviso de saída: recarregar aqui é escolha explícita, e um
    // segundo diálogo de confirmação seria só ruído.
    saindoRef.current = true;
    window.location.reload();
  };

  const tentarDeNovo = () => {
    setEstado("pendente");
    setMensagem(null);
    salvarRef.current?.();
  };

  /* -- render ---------------------------------------------------------------- */

  const rotuloEstado = ROTULO_DO_ESTADO[estado];
  let indice = 0;
  const proximo = () => indice++;

  return (
    <div className="rounded-md border border-line bg-surface">
      {/* Título da página. Um `<input>` e não um nó do documento: o título é
          coluna própria no banco (a árvore e a busca leem dela), e mantê-lo fora
          do ProseMirror evita ter duas fontes de verdade para o mesmo texto. */}
      <div className="border-b border-line px-5 pb-3 pt-4">
        <label htmlFor="titulo-da-pagina" className="sr-only">
          Título da página
        </label>
        <input
          id="titulo-da-pagina"
          value={titulo}
          onChange={(e) => aoMudarTitulo(e.target.value)}
          disabled={documentoInvalido}
          placeholder={rotuloDaPagina(null)}
          maxLength={200}
          className="w-full bg-transparent text-titulo font-semibold tracking-tight text-ink outline-none placeholder:text-ink-subtle disabled:opacity-60"
        />
      </div>

      {documentoInvalido && (
        <p
          role="alert"
          className="border-b border-line bg-surface-muted px-5 py-3 text-corpo text-ink-muted"
        >
          Esta página foi criada por uma versão mais recente do editor e não pode ser
          exibida por inteiro. A edição está desativada para não apagar o conteúdo
          que este editor não entende.
        </p>
      )}

      {/* Barra de ferramentas. `role="toolbar"` acompanhado da navegação por
          setas — o papel sem as setas seria pior do que papel nenhum, porque
          promete ao leitor de tela um comportamento que não existiria. */}
      <div
        ref={barraRef}
        role="toolbar"
        aria-label="Formatação do texto"
        aria-controls="area-do-editor"
        onKeyDown={aoTeclarNaBarra}
        className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-2"
      >
        <BotaoDeFerramenta
          rotulo="Negrito"
          ativo={marcas.negrito}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleBold().run()}
        >
          <span className="font-bold">N</span>
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Itálico"
          ativo={marcas.italico}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Riscado"
          ativo={marcas.riscado}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleStrike().run()}
        >
          <span className="line-through">S</span>
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Código embutido"
          ativo={marcas.codigo}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleCode().run()}
        >
          <span className="font-mono text-legenda">{"<>"}</span>
        </BotaoDeFerramenta>

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />

        {([1, 2, 3] as const).map((nivel) => (
          <BotaoDeFerramenta
            key={nivel}
            rotulo={`Título ${nivel}`}
            ativo={nivel === 1 ? marcas.titulo1 : nivel === 2 ? marcas.titulo2 : marcas.titulo3}
            desativado={documentoInvalido}
            indice={proximo()}
            indiceComFoco={indiceComFoco}
            aoAcionar={() => editor.chain().focus().toggleHeading({ level: nivel }).run()}
          >
            H{nivel}
          </BotaoDeFerramenta>
        ))}

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />

        <BotaoDeFerramenta
          rotulo="Lista com marcadores"
          ativo={marcas.listaMarcador}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Glifo.ListaMarcador />
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Lista numerada"
          ativo={marcas.listaNumero}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <Glifo.ListaNumero />
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Citação"
          ativo={marcas.citacao}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Glifo.Citacao />
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Bloco de código"
          ativo={marcas.blocoCodigo}
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Glifo.BlocoCodigo />
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Linha divisória"
          desativado={documentoInvalido}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Glifo.Linha />
        </BotaoDeFerramenta>

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />

        <BotaoDeFerramenta
          rotulo="Desfazer"
          desativado={documentoInvalido || !marcas.podeDesfazer}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().undo().run()}
        >
          <Glifo.Desfazer />
        </BotaoDeFerramenta>

        <BotaoDeFerramenta
          rotulo="Refazer"
          desativado={documentoInvalido || !marcas.podeRefazer}
          indice={proximo()}
          indiceComFoco={indiceComFoco}
          aoAcionar={() => editor.chain().focus().redo().run()}
        >
          <Glifo.Refazer />
        </BotaoDeFerramenta>

        {/* Só aparece com o cursor dentro de um bloco de código: fora dele o
            seletor não teria em que agir, e um controle inerte na barra é ruído
            permanente para quem navega por teclado. */}
        {marcas.blocoCodigo && (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <label htmlFor="linguagem-do-bloco" className="sr-only">
              Linguagem do bloco de código
            </label>
            <select
              id="linguagem-do-bloco"
              value={marcas.linguagem}
              disabled={documentoInvalido}
              onChange={(e) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("codeBlock", { language: e.target.value })
                  .run()
              }
              className="h-11 rounded-md border border-line bg-surface px-3 text-legenda text-ink-muted"
            >
              {LINGUAGENS.map((l) => (
                <option key={l.valor} value={l.valor}>
                  {l.rotulo}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div id="area-do-editor" className="sb-editor-area px-5 py-4">
        <EditorContent editor={editor} />
      </div>

      {/* MENU DE BARRA.
          `role="listbox"` com `role="option"` de verdade — nada de <div> com
          onClick. O foco NÃO vem para cá (continua na área editável, senão as
          letras seguintes não filtrariam mais nada): a ligação é feita pelo
          `aria-activedescendant` que o efeito acima escreve no editor. Por isso
          as opções não têm `tabIndex` e não recebem `focus()`. */}
      {menuVisivel && menu && (
        <ul
          id={idDoMenu}
          role="listbox"
          aria-label="Comandos de bloco"
          style={{ position: "fixed", left: menu.x, top: menu.topo, bottom: menu.base }}
          /* `animate-popover-in` só na ENTRADA. A posição continua vindo do
             `style` acima, em `left/top/bottom` — não em `transform` —, então a
             animação (que é translateY) não briga com o posicionamento: ela
             desloca a partir de onde o menu já foi colocado, e o deslocamento
             zera no último quadro. Se um dia o posicionamento passar a usar
             `transform`, esta classe tem que sair junto. */
          className="z-[80] max-h-[300px] w-[260px] animate-popover-in overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-raised"
        >
          {comandos.map((comando, i) => (
            <li
              key={comando.id}
              id={`${idDoMenu}-${comando.id}`}
              role="option"
              aria-selected={i === indiceDoComando}
              // `onMouseDown` com `preventDefault`, e não `onClick`: o mousedown
              // é o que tiraria o foco (e a seleção) da área editável. Sem o
              // cancelamento, quando o clique chegasse não haveria mais cursor
              // onde inserir o bloco.
              onMouseDown={(evento) => {
                evento.preventDefault();
                aplicarComando(i);
              }}
              onMouseMove={() => {
                if (i !== indiceDoComando) setIndiceDoComando(i);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-corpo",
                i === indiceDoComando ? "bg-surface-muted text-ink" : "text-ink-muted",
              )}
            >
              <span>{comando.rotulo}</span>
              <span className="text-meta text-ink-subtle">{comando.dica}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Abertura do menu anunciada uma vez. A região existe SEMPRE, mesmo
          vazia: região viva criada junto com o conteúdo costuma não ser
          anunciada, porque o leitor de tela precisa tê-la observado antes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {menuVisivel ? `Menu de comandos aberto, ${comandos.length} opções.` : ""}
      </p>

      {/* Indicador de estado. `aria-live="polite"` enfileira e substitui: uma
          sequência rápida de "Salvando..." → "Salvo" colapsa no anúncio final,
          em vez de tagarelar a cada tecla. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-2.5">
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-legenda",
            estado === "conflito" || estado === "erro" ? "text-ink" : "text-ink-subtle",
          )}
        >
          {rotuloEstado}
          {mensagem ? <span className="text-ink-muted"> — {mensagem}</span> : null}
        </p>

        <div className="flex items-center gap-2">
          {/* Descoberta do menu: sem esta linha, "/" é um recurso que só existe
              para quem já sabe que ele existe. */}
          <span className="text-legenda text-ink-subtle">
            Digite <kbd className="rounded-xs border border-line px-1 font-mono">/</kbd> para
            inserir blocos
          </span>
          {estado === "erro" && (
            <button
              type="button"
              onClick={tentarDeNovo}
              className="alvo-44 rounded-sm border border-line-strong px-2.5 py-1 text-legenda text-ink hover:bg-surface-muted"
            >
              Tentar de novo
            </button>
          )}
          {estado === "conflito" && (
            <button
              type="button"
              onClick={recarregar}
              className="alvo-44 rounded-sm border border-line-strong px-2.5 py-1 text-legenda text-ink hover:bg-surface-muted"
            >
              Recarregar a página
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
