"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Avatar } from "@/components/ui/Avatar";
import { Logotipo } from "@/components/ui/Logotipo";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";
import { limparRascunhosDeCaptura } from "@/lib/capture-draft";
import type { ModuleDef } from "@/lib/modules";
import {
  AO_RECOLHER_OCULTA,
  AO_RECOLHER_SO_ICONE,
  aplicarRecolhidaNoDocumento,
  guardarPreferenciaRecolhida,
  lerPreferenciaRecolhida,
} from "./sidebar-preferencia";

/** Ligado ao `aria-controls` do botão de alternância. Só existe uma barra. */
const ID_BARRA = "barra-lateral";

/**
 * Estado do recolhimento — para as ETIQUETAS, não para a largura.
 *
 * A largura é decidida por CSS a partir do `data-sidebar` no `<html>`, escrito
 * antes da pintura pelo script de `sidebar-preferencia.tsx`. Este estado do React
 * existe só para o que CSS não sabe escrever: o `aria-expanded`, o `aria-label`
 * do botão e o `title` dos ícones.
 *
 * POR QUE NÃO LER O localStorage NO INICIALIZADOR DO useState: o servidor
 * renderiza `aria-expanded="true"` (não há armazenamento lá) e o cliente
 * renderizaria `false` na mesma passada de hidratação — divergência de atributo,
 * que o React 19 registra como erro de hidratação e corrige na marra. O efeito
 * abaixo sincroniza no quadro seguinte à hidratação, e como nada disso é visível
 * (só atributos de acessibilidade), não há salto na tela. O que era visível — a
 * largura — já saiu do caminho do React justamente por isso.
 *
 * O efeito lê o ARMAZENAMENTO, não o atributo que já está no <html>, e reaplica.
 * No caminho normal isso é redundante (o script de inicialização chegou primeiro
 * e escreveu a mesma coisa). Ele existe para o caminho em que o script NÃO
 * rodou: montagem desta barra numa navegação do lado do cliente — quem entra
 * pelo /login e é redirecionado para dentro de (app) sem recarregar a página.
 * Lendo o atributo, essa pessoa veria a barra expandida e a preferência dela
 * ignorada até o próximo F5.
 */
function useSidebarRecolhida() {
  const [recolhida, setRecolhida] = useState(false);

  useEffect(() => {
    const guardada = lerPreferenciaRecolhida();
    setRecolhida(guardada);
    aplicarRecolhidaNoDocumento(guardada);
  }, []);

  function alternar() {
    const proxima = !recolhida;
    setRecolhida(proxima);
    aplicarRecolhidaNoDocumento(proxima);
    guardarPreferenciaRecolhida(proxima);
  }

  return { recolhida, alternar };
}

export function AppSidebar({
  items,
  displayName,
  email,
  avatarUrl,
  organizedPercent,
  organizedDone,
  organizedTotal,
}: {
  items: ModuleDef[];
  displayName: string;
  email: string;
  avatarUrl: string | null;
  organizedPercent: number;
  organizedDone: number;
  organizedTotal: number;
}) {
  const pathname = usePathname();
  const { recolhida, alternar } = useSidebarRecolhida();

  /**
   * Nome acessível do medidor. Recolhido, o círculo com "62%" é a única coisa
   * que sobra do bloco — e "62%" sozinho não diz de quê. Vale nos dois estados:
   * expandido ele apenas repete, com mais contexto, o texto que está ao lado.
   */
  const resumoOrdem = `Cérebro em ordem: ${organizedPercent}% — ${organizedDone} de ${organizedTotal} concluídas`;

  return (
    // sticky + h-dvh: a barra acompanha a rolagem da página e nunca "sobe"
    // quando o conteúdo principal é mais alto que a viewport.
    //
    // `overflow-x-hidden` entra junto do estado recolhido: durante os 150ms da
    // transição a largura já encolheu mas o conteúdo ainda não terminou de
    // recolher, e sem isso aparece uma barra de rolagem horizontal piscando.
    //
    // A transição é só de `width` — nunca `transition-all`, que arrastaria
    // junto as cores do tema e faria a troca claro/escuro esmaecer. 150ms é o
    // teto do que ainda lê como resposta direta ao clique; sob
    // `prefers-reduced-motion` o bloco de globals.css zera a duração e a barra
    // troca de largura em corte seco, que é o comportamento correto.
    //
    // LARGURA: 16rem até 1535px, 20rem a partir de 1536px (`2xl`).
    //
    // O DS §5 pede 320px de barra no desktop e 256px no tablet, com o corte em
    // 1024px. Os 320px foram adotados; o CORTE não — e o desvio é consciente.
    // O corte de 1024px do design system foi pensado para separar tablet de
    // desktop, mas a maioria dos notebooks tem 1366 ou 1440px de largura, e ali
    // a barra de 320px sai direto da área de conteúdo: 104px a menos de espaço
    // útil (~9%) para exibir exatamente a mesma navegação que 256px já exibe.
    // Em 1536px ou mais, o conteúdo já bate no próprio teto e a barra maior sai
    // de graça — é onde ela vale a pena.
    //
    // ⚠️ Mudar este `2xl` obriga a refazer a aritmética do `max-w` recolhido em
    // (app)/layout.tsx, que tem um teto para CADA regime. Os dois números são o
    // mesmo cálculo visto de dois lados.
    <aside
      id={ID_BARRA}
      className={cn(
        "sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-line bg-surface md:flex 2xl:w-80",
        "transition-[width] duration-150 ease-out",
        // Sem par `2xl:` aqui de propósito: o seletor de atributo dá a esta
        // regra especificidade (0,2,0) contra os (0,1,0) do `2xl:w-80`, então
        // ela vence em qualquer largura. Recolhida é 4rem nos dois regimes.
        "[[data-sidebar=recolhida]_&]:w-16",
      )}
    >
      {/* A MARCA, no lugar onde estava a foto do usuário.

          A foto identificava a CONTA num ponto onde a pergunta é "que produto é
          este" — e a conta já é identificada duas vezes na mesma tela: no rodapé
          desta barra (nome + e-mail) e no avatar do cabeçalho da página. O
          símbolo aqui é o único lugar do aplicativo, fora do login, em que a
          marca aparece.

          Recolhida, a linha vira coluna: o símbolo em cima, o botão de
          alternância embaixo. Manter os dois lado a lado em 4rem espremeria os
          dois. O símbolo fica em 32px — acima do mínimo de 24px do kit da marca —
          e é a única coisa que sobra do bloco, o que é justamente o caso de uso
          para o qual o símbolo isolado existe. */}
      <div
        className={cn(
          "flex items-center gap-3 px-5 pt-6 pb-5",
          "[[data-sidebar=recolhida]_&]:flex-col [[data-sidebar=recolhida]_&]:gap-2 [[data-sidebar=recolhida]_&]:px-2 [[data-sidebar=recolhida]_&]:pt-4 [[data-sidebar=recolhida]_&]:pb-3",
        )}
      >
        <Logotipo variante="simbolo" size={32} />
        <div className={cn("leading-tight", AO_RECOLHER_OCULTA)}>
          <p className="text-corpo-forte font-bold tracking-tight text-ink">Segundo</p>
          <p className="text-corpo text-ink-muted">Cérebro</p>
        </div>

        {/*
          `ml-auto` empurra o botão para a direita enquanto a linha é linha; na
          coluna do estado recolhido ele precisa voltar a zero, senão a margem
          automática desloca o botão dentro dos 4rem.

          O rótulo diz o que o clique FAZ, não em que estado a barra está — é o
          que o leitor de tela anuncia junto com o `aria-expanded`, que já
          informa o estado. Anunciar o estado duas vezes ("recolhida, recolher")
          é confuso; anunciar só o estado deixa a pessoa sem saber o que o botão
          faz.
        */}
        <button
          type="button"
          onClick={alternar}
          aria-expanded={!recolhida}
          aria-controls={ID_BARRA}
          aria-label={recolhida ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={recolhida ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink",
            "[[data-sidebar=recolhida]_&]:ml-0",
          )}
        >
          {/* Um ícone só, girado por CSS. Trocar de ícone conforme o estado
              dependeria do React e voltaria a piscar na hidratação — a seta gira
              junto com a largura porque lê o mesmo atributo do <html>. Aponta
              para onde a barra VAI: para a esquerda quando há o que recolher. */}
          <Icon.ChevronRight className="rotate-180 transition-transform duration-150 ease-out [[data-sidebar=recolhida]_&]:rotate-0" />
        </button>
      </div>

      <p className={cn("eyebrow px-5 pb-2", AO_RECOLHER_OCULTA)}>Espaço pessoal</p>

      <nav
        aria-label="Módulos"
        className={cn("flex flex-1 flex-col gap-1 px-3", "[[data-sidebar=recolhida]_&]:px-2")}
      >
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Glyph = Icon[item.icon];
          return (
            /*
              `aria-label` é INCONDICIONAL de propósito. Recolhido, o rótulo
              visível sai do DOM e sobra um <a> com um <svg> dentro — um link
              mudo, que o leitor de tela anuncia como "link" e mais nada.
              Depender do estado do React para pôr o nome de volta significaria
              que, entre a pintura e a hidratação, os dez links da barra não têm
              nome. Repetir o texto visível quando expandido não custa nada: o
              rótulo e o `aria-label` são a mesma palavra, então o comando de voz
              "clicar Tarefas" continua funcionando.

              O `title` (a dica nativa do navegador) é o oposto: só faz sentido
              quando o nome NÃO está na tela. Expandido ele seria uma tarja
              amarela repetindo o que já se lê ao lado do ícone.
            */
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              title={recolhida ? item.label : undefined}
              /* 52px de altura (py-4 + 20px de entrelinha), o número do DS §7.
                 Eram 40px. Além de ser o alvo de toque confortável, a altura
                 maior é o que faz a barra parecer navegação em vez de lista:
                 dez itens colados a 40px leem como um índice. */
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-4 text-sm font-medium transition-colors",
                AO_RECOLHER_SO_ICONE,
                active
                  ? "bg-accent text-accent-ink"
                  : "text-ink-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              <Glyph className="shrink-0" />
              <span className={AO_RECOLHER_OCULTA}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Recolhido, o cartão perde moldura, fundo e recheio e sobra o círculo do
          percentual: 12px de padding + 36px de círculo + 12px não cabem em 4rem,
          e um cartão espremido em volta de um círculo não acrescenta informação
          nenhuma ao círculo. */}
      <div
        className={cn(
          "mx-3 mb-3 mt-2 rounded-md border border-line bg-surface-muted p-3",
          "[[data-sidebar=recolhida]_&]:mx-2 [[data-sidebar=recolhida]_&]:border-0 [[data-sidebar=recolhida]_&]:bg-transparent [[data-sidebar=recolhida]_&]:p-0",
        )}
      >
        <div
          className={cn("flex items-center gap-3", "[[data-sidebar=recolhida]_&]:justify-center")}
        >
          {/* `role="img"` é o que faz o `aria-label` de uma <div> ser lido: sem
              papel declarado, o nome acessível é ignorado e o leitor anuncia
              apenas o texto "62%". */}
          <div
            role="img"
            aria-label={resumoOrdem}
            title={resumoOrdem}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong text-meta font-semibold text-ink"
          >
            {organizedPercent}%
          </div>
          <div className={cn("leading-tight", AO_RECOLHER_OCULTA)}>
            <p className="text-corpo font-medium text-ink">Cérebro em ordem</p>
            <p className="text-legenda text-ink-subtle">
              {organizedDone} de {organizedTotal} concluídas
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col gap-0.5 border-t border-line px-3 py-3",
          "[[data-sidebar=recolhida]_&]:px-2",
        )}
      >
        <Link
          href="/configuracoes"
          aria-label="Configurações"
          title={recolhida ? "Configurações" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-3 text-corpo text-ink-muted hover:bg-surface-hover hover:text-ink",
            AO_RECOLHER_SO_ICONE,
          )}
        >
          <Icon.Settings width={18} height={18} className="shrink-0" />
          <span className={AO_RECOLHER_OCULTA}>Configurações</span>
        </Link>
        <Link
          href="/ajuda"
          aria-label="Ajuda e atalhos"
          title={recolhida ? "Ajuda e atalhos" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-3 text-corpo text-ink-muted hover:bg-surface-hover hover:text-ink",
            AO_RECOLHER_SO_ICONE,
          )}
        >
          <Icon.Help width={18} height={18} className="shrink-0" />
          <span className={AO_RECOLHER_OCULTA}>Ajuda e atalhos</span>
        </Link>

        {/* A FOTO VOLTOU PARA CÁ — e o motivo é o inverso do que estava escrito
            aqui antes.

            Enquanto a foto ficava no TOPO, fazendo as vezes de logotipo, repeti-la
            no rodapé seria a mesma imagem duas vezes na mesma coluna, a poucos
            centímetros de distância. Com a marca ocupando o topo, o rodapé passou
            a ser o único ponto da barra que responde "qual conta está aberta" — e
            um nome com um e-mail, sem rosto, é justamente o bloco que o olho pula.

            RECOLHIDA, o rodapé fica só com o botão de sair: nome, e-mail e foto
            não cabem em 4rem, e o avatar do cabeçalho da página continua na tela
            respondendo a mesma pergunta. */}
        <div
          className={cn(
            "mt-1 flex items-center gap-3 rounded-md px-3 py-2",
            "[[data-sidebar=recolhida]_&]:justify-center [[data-sidebar=recolhida]_&]:px-0",
          )}
        >
          <Avatar
            name={displayName}
            url={avatarUrl}
            size={36}
            className={AO_RECOLHER_OCULTA}
          />
          <div className={cn("min-w-0 flex-1 leading-tight", AO_RECOLHER_OCULTA)}>
            <p className="truncate text-corpo font-medium text-ink">{displayName}</p>
            <p className="truncate text-legenda text-ink-muted">{email}</p>
          </div>
          {/*
            `onSubmit` limpa o que é do NAVEGADOR antes de a Server Action
            limpar o que é do servidor.

            Precisa ser aqui e não dentro de `signOut`: a action roda no
            servidor e não tem acesso nenhum ao `sessionStorage` da aba. Sem
            esta linha, sair da conta apagava a sessão e deixava o rascunho de
            captura para trás — o oposto do que "sair" significa para quem
            clica. Ver src/lib/capture-draft.ts.

            Não chama `preventDefault`, então a submissão segue normalmente e a
            Server Action executa logo depois.
          */}
          <form action={signOut} onSubmit={() => limparRascunhosDeCaptura()}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className={cn(
                // 44×44 REAIS, e não os 32 de antes. Este era o pior alvo do
                // produto: um botão de sair de 32px, encostado na borda inferior
                // da barra, do tamanho de metade de um polegar. O DS §9 põe o
                // piso em 44, e aqui não há razão de densidade para negociá-lo —
                // o rodapé tem espaço de sobra.
                "flex h-11 w-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink",
              )}
            >
              <Icon.Logout width={18} height={18} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
