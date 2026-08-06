import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";

export interface HeaderUser {
  name: string;
  avatarUrl: string | null;
}

/**
 * Cabeçalho global: eyebrow, título, subtítulo + busca / tema / capturar /
 * avatar.
 *
 * ============================================================================
 * A BUSCA É UM SLOT, E NÃO UM BOOLEANO — o porquê importa
 * ============================================================================
 * Aqui existia um `<input type="search">` fixo: sem `name`, sem `value`, sem
 * `onChange`, sem `<form>` em volta. Ele não fazia absolutamente nada, em DOZE
 * rotas. Em `/conhecimento` era pior que inútil: aparecia logo acima da
 * `KnowledgeSearch`, que é a busca de verdade — duas barras, uma funcionando e
 * outra não, a um dedo de distância.
 *
 * Um `mostrarBusca?: boolean` resolveria metade: a barra sumiria de onde não
 * serve e continuaria decorativa onde ficasse. Este arquivo é Componente de
 * SERVIDOR e não pode ter `useState` nem `onChange` — a busca é interação, e
 * interação mora num componente de cliente.
 *
 * Então a prop recebe o componente PRONTO. Quem tem busca passa o seu; as dez
 * rotas que não têm não mudam uma linha, porque a prop simplesmente não é
 * passada. E cada página fica livre para levar o termo para a URL
 * (`/conhecimento`, onde a ida ao servidor É a busca) ou mantê-lo no cliente
 * (`/tarefas`, onde ir ao servidor não traria nada).
 *
 * A prop `right`, que seguia este mesmo padrão, saiu junto: `grep -rn 'right={'
 * src` não retornava nenhuma ocorrência. Era código morto desde que foi escrita.
 *
 * ============================================================================
 * O LAYOUT, E POR QUE ELE É `flex-wrap` COM `order`
 * ============================================================================
 * A barra antiga era `hidden lg:block` — nunca apareceu abaixo de 1024px. Como
 * ela não fazia nada, ninguém sentiu falta; com busca de verdade, esconder no
 * celular tiraria a busca justamente de onde a lista mobile é a visão
 * principal.
 *
 * Mas empilhar o campo na mesma linha do título e dos botões, num telefone, não
 * cabe. A saída é UMA instância só, reposicionada por CSS: no celular ela quebra
 * para a linha de baixo (`w-full`, `order-3`); a partir de `lg` ela volta para o
 * meio da linha (`order-2`), antes do seletor de tema.
 *
 * ⚠️ Renderizar o slot duas vezes (uma visível no celular, outra no desktop)
 * seria mais simples de escrever e ERRADO: dois componentes de cliente
 * independentes, com estado próprio e `id` duplicado no DOM. Digitar em um não
 * apareceria no outro.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  user,
  busca,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
  user: HeaderUser;
  /** O campo de busca DESTA página, já montado. Ver o bloco acima. */
  busca?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="order-1 min-w-0 flex-1">
          <p className="eyebrow">{eyebrow}</p>
          {/* `text-display` já traz o clamp, a entrelinha 0.96 e o tracking de
              −0.055em do DS §4. O par `text-4xl sm:text-5xl` que estava aqui
              tinha DOIS degraus e um ponto de quebra; o clamp acompanha a
              largura continuamente e resolve o teto de 44–52px que o DS §9 pede
              no mobile sem precisar de breakpoint. `tracking-tight` saiu porque
              venceria o tracking do degrau — ver a nota de precedência em
              tailwind.config.ts. */}
          <h1 className="mt-2 text-display font-bold text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-corpo-forte text-ink-muted">{subtitle}</p>}
        </div>

        {busca && <div className="order-3 w-full lg:order-2 lg:w-80">{busca}</div>}

        <div className="order-2 flex shrink-0 items-center gap-2 lg:order-3">
          <ThemeToggle />
          <Link
            href="/capturar"
            className="flex h-11 items-center gap-2.5 rounded-md bg-accent px-4 text-corpo font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            <Icon.Capture width={18} height={18} /> Capturar
          </Link>
          <Link href="/configuracoes" aria-label="Configurações do perfil">
            <Avatar name={user.name} url={user.avatarUrl} size={44} />
          </Link>
        </div>
      </div>
    </header>
  );
}
