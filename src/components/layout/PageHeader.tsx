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
 *
 * ============================================================================
 * ⚠️ POR QUE AS AÇÕES GANHAM LINHA PRÓPRIA NO CELULAR
 * ============================================================================
 * O `flex-wrap` acima NÃO estava disparando, e a razão é sutil o bastante para
 * merecer o registro — ela custou uma investigação.
 *
 * Em 390px o `main` deixa ~350px. As ações medem ~226px (tema 44 + Capturar 138
 * + avatar 44), e são `shrink-0`. Sobram ~108px para o título. O flexbox
 * considera que ISSO COUBE: o bloco do título é `flex-1` (basis 0, encolhível),
 * então não há transbordo do ITEM e a quebra nunca acontece.
 *
 * Quem transborda é o CONTEÚDO do `h1`. "Configurações." mede ~277px em
 * `text-4xl` e é palavra única, sem ponto de quebra natural — ela estoura os
 * 108px, empurra o documento inteiro para além da viewport, e é isso que fazia
 * cards e campos aparecerem cortados nas outras telas. Eram sintomas, não
 * defeitos próprios.
 *
 * Duas correções, e as duas são necessárias:
 *
 *   1. As ações passam a ocupar a linha inteira abaixo de `sm`, devolvendo os
 *      226px ao título. `order-1` as põe ACIMA — a ordem do DOM continua título
 *      → ações, então a navegação por teclado não muda; só o desenho.
 *   2. `break-words` no `h1` como rede. O título nem sempre é literal: em
 *      `/configuracoes` ele carrega o `displayName`, que vem do banco e não tem
 *      limite de tamanho. Um nome de 40 caracteres sem espaço voltaria a
 *      estourar mesmo com a linha inteira disponível.
 *
 * ⚠️ NÃO existe `overflow-x-hidden` global aqui nem no shell, e a ausência é
 * deliberada: ele ESCONDERIA a próxima regressão desta mesma classe em vez de
 * deixá-la visível. O transbordo é a única evidência de que algo não coube.
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
        <div className="order-2 w-full min-w-0 sm:order-1 sm:w-auto sm:flex-1">
          <p className="eyebrow">{eyebrow}</p>
          {/* O título editorial fluido do DS (`text-display`, clamp de 52–80px)
              esteve aqui e FOI REVERTIDO junto do resto dos tamanhos — ver a
              nota na escala de tailwind.config.ts. O par `text-4xl sm:text-5xl`
              é o original: dois degraus e um ponto de quebra em `sm`. */}
          <h1 className="mt-2 break-words text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-corpo-forte text-ink-muted">{subtitle}</p>}
        </div>

        {busca && <div className="order-3 w-full lg:order-2 lg:w-80">{busca}</div>}

        <div className="order-1 flex w-full shrink-0 items-center justify-end gap-2 sm:order-2 sm:w-auto lg:order-3">
          <ThemeToggle />
          {/*
            Abaixo de `sm` o rótulo sai e sobra o ícone — ~78px devolvidos ao
            título, que é a maior parcela dos 226px das ações.

            O `aria-label` NÃO é redundância com o texto: ele é o que sustenta o
            nome acessível justamente quando o `<span>` está `hidden`, e
            `hidden` retira do leitor de tela também. Sem ele, o botão viraria
            um link sem nome no celular. Nos tamanhos maiores os dois dizem a
            mesma palavra, então o nome não muda com a largura.

            `w-11 justify-center` mantém o alvo em 44×44 quando é só ícone —
            abaixo disso o dedo erra, e este é o botão mais usado do app.
          */}
          <Link
            href="/capturar"
            aria-label="Capturar"
            className="flex h-11 w-11 items-center justify-center gap-2.5 rounded-md bg-accent text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 sm:w-auto sm:px-4"
          >
            <Icon.Capture width={18} height={18} aria-hidden />
            <span className="hidden sm:inline">Capturar</span>
          </Link>
          <Link href="/configuracoes" aria-label="Configurações do perfil">
            <Avatar name={user.name} url={user.avatarUrl} size={44} />
          </Link>
        </div>
      </div>
    </header>
  );
}
