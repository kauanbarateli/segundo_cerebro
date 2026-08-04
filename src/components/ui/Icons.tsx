import type { SVGProps } from "react";

/** Minimal linear icon set (stroke-based, currentColor). */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const Icon = {
  Home: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  Capture: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Tasks: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m4 12 3 3 5-6" />
      <path d="M14 8h6M14 14h6M4 19h16" />
    </svg>
  ),
  Calendar: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  ),
  Vault: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 15.2V18" />
    </svg>
  ),
  Settings: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 12 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9a2 2 0 1 1 0 4Z" />
    </svg>
  ),
  Help: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2.5 2-2.5 3.5M12 17h.01" />
    </svg>
  ),
  Search: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  Sun: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  Moon: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ),
  Play: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  ),
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  ),
  Clock: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  Video: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  ),
  MapPin: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  Lock: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  Eye: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.4 4M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3-.5" />
    </svg>
  ),
  Copy: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  ),
  Trash: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
    </svg>
  ),
  Refresh: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
    </svg>
  ),
  Dots: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  ),
  Logout: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
    </svg>
  ),
  Google: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M20.5 12.2c0-.6-.05-1.2-.15-1.7H12v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.6Z" />
      <path d="M12 21c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H3.9v2.3A9 9 0 0 0 12 21Z" />
      <path d="M6.9 13.7a5.4 5.4 0 0 1 0-3.4V8H3.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path d="M12 6.6c1.3 0 2.5.5 3.4 1.4l2.6-2.6A9 9 0 0 0 3.9 8l3 2.3C7.6 8.1 9.6 6.6 12 6.6Z" />
    </svg>
  ),
  Alert: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 9v5M12 17h.01" />
    </svg>
  ),
  Inbox: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M5 13 7 5h10l2 8v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
    </svg>
  ),
  /** Responsáveis de uma tarefa do ClickUp. */
  User: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  ),
  Folder: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  ),
  File: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  Upload: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  ),
  Download: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 4v12M8 12l4 4 4-4" />
      <path d="M4 18v0a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v0" />
    </svg>
  ),
  Wallet: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 10h13a2 2 0 0 1 0 4H3" />
    </svg>
  ),
  Bell: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10.5 20a1.8 1.8 0 0 0 3 0" />
    </svg>
  ),
  Board: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </svg>
  ),
  List: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  ),
  ChevronRight: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  X: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  // Caderno de anotações: capa com lombada curva e uma linha de texto. SVG
  // inline como todos os outros — nada de pacote de ícones nem CDN, que
  // acrescentaria um pedido de rede bloqueante e um terceiro no caminho crítico
  // por causa de 4 traços.
  Book: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v13.5H6.5A1.5 1.5 0 0 0 5 18Z" />
      <path d="M5 18a1.5 1.5 0 0 0 1.5 1.5H19" />
      <path d="M9 7.5h6" />
    </svg>
  ),
  Star: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9Z" />
    </svg>
  ),

  /* ----------------------------------------------------------- redes sociais
   *
   * Todos SVG INLINE, como o resto do arquivo — nada de pacote de ícones nem
   * CDN. Um CDN de ícones aqui seria pior que nas outras telas: cada visita à
   * Início entregaria a um terceiro o IP do usuário e a página visitada, e a
   * lista de links ficaria refém de uma requisição de rede que pode falhar.
   *
   * Traço, `currentColor`, sem preenchimento e sem cor de marca: o projeto é
   * monocromático de propósito, e a versão colorida de cada logo puxaria oito
   * cores para uma lista de oito itens.
   *
   * O CONJUNTO É PROPOSITALMENTE MENOR QUE `IconeSocial`: as plataformas sem
   * glifo próprio caem no `Link` genérico pelo mapa em
   * src/components/features/social/SocialLinkIcon.tsx, que é exaustivo e
   * quebra a compilação se `IconeSocial` ganhar um membro novo.
   */

  Instagram: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17 7h.01" />
    </svg>
  ),

  LinkedIn: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7.5 10.5V17" />
      <path d="M7.5 7.4h.01" />
      <path d="M11.5 17v-6.5" />
      <path d="M11.5 13.4c0-1.6 1-2.9 2.5-2.9s2.5 1.3 2.5 2.9V17" />
    </svg>
  ),

  // O contorno da silhueta do "octocat". Desenhado com traço e sem
  // preenchimento, como os demais — por isso o caminho é único e fechado.
  GitHub: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M15 21v-3.3c0-1 .3-1.7.8-2.2 2.9-.3 5.2-1.4 5.2-5.4 0-1.2-.4-2.2-1.1-3 .1-.3.5-1.4-.1-2.9 0 0-.9-.3-3 1.2a10.4 10.4 0 0 0-5.6 0C9.1 3.9 8.2 4.2 8.2 4.2c-.6 1.5-.2 2.6-.1 2.9-.7.8-1.1 1.8-1.1 3 0 4 2.3 5.1 5.2 5.4-.4.4-.7.9-.8 1.6" />
      <path d="M11.4 19.2c-1.4.5-3.2.5-4.1-1.1-.5-.9-1.1-1.2-1.7-1.3" />
      <path d="M11.4 19.2V21" />
    </svg>
  ),

  /**
   * O X do x.com. NÃO se chama `X`: `Icon.X` já existe neste arquivo e é o X de
   * FECHAR (dois traços cruzados, usado em modal e toast). Se este ícone
   * ocupasse aquele nome, a lista de links renderizaria um botão de fechar e
   * NÃO haveria erro de tipo, porque a chave existiria. Daí também a moldura:
   * ela distingue o logo do gesto de fechar mesmo a 16 px.
   */
  XTwitter: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  ),

  YouTube: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10.5 9.5 5 2.5-5 2.5Z" />
    </svg>
  ),

  // Genérico: dois elos de corrente. É o ícone de quem não está na tabela de
  // domínios — e ele nunca falta, porque `iconePorDominio` devolve "Link" para
  // qualquer entrada que não reconheça, inclusive a que nem é URL.
  Link: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
    </svg>
  ),
};

export type IconName = keyof typeof Icon;
