import { Icon, type IconName } from "@/components/ui/Icons";
import { iconePorDominio, type IconeSocial } from "@/lib/social";

/**
 * Ícone de um link social, escolhido pelo domínio.
 *
 * SEM "use client" DE PROPÓSITO: o mesmo componente é usado pela Início (que é
 * componente de servidor) e pelo painel de Configurações (que é de cliente). Um
 * componente sem diretiva atende aos dois — marcar "use client" aqui arrastaria
 * a Início para o pacote do navegador sem necessidade nenhuma.
 *
 * É por isso também que `iconePorDominio` mora em `social.ts`, que não importa
 * zod: se a escolha do ícone dependesse de `validation.ts`, o zod inteiro
 * entraria no pacote do cliente para desenhar um traço.
 */

/**
 * Plataforma -> glifo. `Record<IconeSocial, IconName>` é EXAUSTIVO nos dois
 * lados, e essa é a única razão de o mapa existir em vez de um `Icon[nome]`
 * direto:
 *
 *   - se `IconeSocial` (src/lib/social.ts) ganhar uma plataforma nova e ninguém
 *     decidir o ícone dela, o TypeScript reprova a compilação — não fica um
 *     buraco na tela em produção;
 *   - se alguém apagar ou renomear um glifo em Icons.tsx, o valor deixa de ser
 *     um `IconName` válido e o erro aparece aqui, não no `undefined is not a
 *     function` de quem for renderizar.
 *
 * As plataformas sem glifo próprio apontam para "Link" CONSCIENTEMENTE. Não é
 * ausência de decisão: o conjunto de ícones desta fase é o pedido (Instagram,
 * GitHub, LinkedIn, X, YouTube e o genérico), e o link continua funcionando e
 * legível — quem identifica o destino é o rótulo, o ícone só ajuda a bater o
 * olho.
 */
const GLIFO_POR_ICONE: Record<IconeSocial, IconName> = {
  Instagram: "Instagram",
  LinkedIn: "LinkedIn",
  GitHub: "GitHub",
  XTwitter: "XTwitter",
  YouTube: "YouTube",
  Facebook: "Link",
  WhatsApp: "Link",
  Telegram: "Link",
  TikTok: "Link",
  Discord: "Link",
  Reddit: "Link",
  Spotify: "Link",
  Twitch: "Link",
  Threads: "Link",
  Link: "Link",
};

/**
 * `aria-hidden` é FIXO e não uma opção do componente.
 *
 * O ícone é decorativo em todos os usos: ele repete o que o rótulo ao lado já
 * diz. Sem `aria-hidden`, um leitor de tela anunciaria o SVG antes do texto e a
 * pessoa ouviria ruído no lugar do nome do link. O nome acessível do `<a>` vem
 * do rótulo — ver o bloco da Início e o painel de Configurações.
 */
export function SocialLinkIcon({
  url,
  size = 16,
  className,
}: {
  url: string;
  size?: number;
  className?: string;
}) {
  const Glifo = Icon[GLIFO_POR_ICONE[iconePorDominio(url)]];
  return <Glifo width={size} height={size} aria-hidden="true" className={className} />;
}
