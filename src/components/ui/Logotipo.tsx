import { cn } from "@/lib/utils";

/**
 * A MARCA — símbolo, lockup horizontal e versão compacta.
 *
 * ============================================================================
 * UM ARQUIVO, DOIS TEMAS — por que `currentColor` e não duas versões
 * ============================================================================
 * O kit da marca entrega `logo-symbol.svg` e `logo-horizontal-inverse.svg`: o
 * primeiro com quadrado `#111111` e traço `#F7F7F4`, o segundo com as duas cores
 * trocadas para superfície escura. Consumir os dois arquivos exigiria alternar
 * entre eles por CSS — duas requisições, duas tags `<img>`, uma escondida —, e o
 * modo escuro deste projeto é uma CLASSE no `<html>`, aplicada antes da pintura,
 * não uma media query. Um `<img>` não enxerga essa classe.
 *
 * Aqui o SVG é INLINE e as duas cores saem de token:
 *
 *   quadrado  `currentColor`             → herda `text-ink`  (#111 / #f5f5f2)
 *   traço     `rgb(var(--sb-accent-ink))` → o contraste dele (#f7f7f4 / #111)
 *
 * O resultado é exatamente o arquivo normal no tema claro e exatamente o
 * arquivo inverso no escuro, com um só desenho e nenhuma requisição. Os SVGs de
 * origem continuam em `public/brand/` — são o mestre da marca, para uso fora do
 * produto (e-mail, apresentação, favicon de terceiros).
 *
 * ============================================================================
 * MÍNIMOS E ÁREA DE PROTEÇÃO (kit da marca, §"Área de proteção")
 * ============================================================================
 *   símbolo   mínimo 24px      · usado a 28–44px em todos os pontos do produto
 *   lockup    mínimo 136px     · o `horizontal` mede ~150px no menor caso
 *   proteção  ¼ da largura do símbolo em todos os lados
 *
 * A proteção é responsabilidade de quem posiciona, e por isso o componente NÃO
 * traz margem própria: margem embutida vira dívida no primeiro layout que
 * precisar encostar a marca em outra coisa. Os dois usos atuais (topo da barra
 * lateral e tela de login) reservam o espaço no contêiner.
 *
 * ⚠️ O kit proíbe inclinar, contornar, aplicar gradiente ou recolorir o símbolo
 * com cor semântica. Como as duas cores vêm de `ink` / `accent-ink`, não existe
 * caminho aqui para pintá-lo de teal ou vermelho sem editar este arquivo.
 */

type Variante = "simbolo" | "horizontal" | "compacta";

/**
 * O desenho, e só ele. `aria-hidden` sempre: o nome acessível é dado por quem
 * chama (o `<span className="sr-only">` do lockup, ou o `aria-label` do link que
 * envolve o símbolo). Um `<title>` aqui dentro seria anunciado DUAS vezes nos
 * casos em que o texto "Segundo Cérebro" já está na tela ao lado.
 */
function Simbolo({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <path
        d="M18.5 20C18.5 15.858 21.858 12.5 26 12.5H35C41.627 12.5 47 17.873 47 24.5C47 28.253 45.245 31.791 42.255 34.056L21.5 49.5H47"
        stroke="rgb(var(--sb-accent-ink))"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="18.5"
        cy="20"
        r="3"
        fill="currentColor"
        stroke="rgb(var(--sb-accent-ink))"
        strokeWidth="1.5"
      />
      <circle
        cx="47"
        cy="49.5"
        r="3"
        fill="currentColor"
        stroke="rgb(var(--sb-accent-ink))"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function Logotipo({
  variante = "horizontal",
  size,
  className,
}: {
  variante?: Variante;
  /** Lado do símbolo em px. O mínimo da marca é 24. */
  size?: number;
  className?: string;
}) {
  const lado = size ?? (variante === "simbolo" ? 36 : 44);

  if (variante === "simbolo") {
    return <Simbolo size={lado} className={cn("text-ink", className)} />;
  }

  /*
    A PALAVRA É TEXTO DE VERDADE, não `<text>` dentro do SVG.

    O `logo-horizontal.svg` do kit desenha "Segundo Cérebro" com dois nós
    `<text>` em Inter. Dentro de um SVG isso depende da fonte estar carregada no
    momento em que o desenho é rasterizado — e a Inter deste projeto entra por
    `next/font` com `display: swap`, então há uma janela real em que o navegador
    substituiria por Arial e a marca sairia com outro desenho de letra. Texto em
    HTML usa a mesma pilha de fontes do resto da interface, é selecionável,
    aumenta com o zoom do navegador e é lido pelo leitor de tela.

    A hierarquia de peso e cor reproduz o lockup do kit: "Segundo" em 700 sobre
    `ink`, "Cérebro" em peso normal sobre `ink-muted`.

    ⚠️ O TAMANHO DA PALAVRA SAI DE `lado`, NUNCA DE UM DEGRAU DA ESCALA.

    Ela já usou `text-corpo-forte` / `text-corpo`, e isso estava errado por um
    motivo que só apareceu quando aconteceu: a escala tipográfica foi revertida
    aos tamanhos originais do projeto (ver tailwind.config.ts) e a palavra
    encolheu de 20/16px para 15/13px enquanto o símbolo continuou nos mesmos
    52px — o lockup saiu desenhado errado, e a largura mínima de 136px que o kit
    exige deixou de ser garantida. Uma decisão sobre corpo de texto de interface
    não pode deformar a marca.

    As proporções vêm do próprio `logo-horizontal.svg`: com o símbolo em 104,
    "Segundo" é 33 (≈0,317) e "Cérebro" é 27 (≈0,26). Derivando de `lado`, o
    lockup fica correto em qualquer tamanho e imune ao que a interface faça com
    a escala dela.
  */
  const px = (proporcao: number) => `${Math.round(lado * proporcao)}px`;

  if (variante === "compacta") {
    return (
      <span className={cn("inline-flex items-center gap-2.5 text-ink", className)}>
        <Simbolo size={lado} />
        <span
          className="font-bold leading-none tracking-tight"
          style={{ fontSize: px(0.3) }}
        >
          Segundo <span className="font-normal text-ink-muted">Cérebro</span>
        </span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-3 text-ink", className)}>
      <Simbolo size={lado} />
      <span className="leading-none">
        <span
          className="block font-bold leading-none tracking-tight"
          style={{ fontSize: px(0.317) }}
        >
          Segundo
        </span>
        <span
          className="mt-1 block leading-none text-ink-muted"
          style={{ fontSize: px(0.26) }}
        >
          Cérebro
        </span>
      </span>
    </span>
  );
}
