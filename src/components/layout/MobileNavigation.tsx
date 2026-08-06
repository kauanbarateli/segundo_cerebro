"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import type { ModuleDef } from "@/lib/modules";

/**
 * Barra inferior do mobile. Cabem ~5 itens confortavelmente; o excedente abre
 * numa folha ao tocar em "Mais".
 *
 * ============================================================================
 * ⚠️ O DEFEITO QUE ESTA FOLHA CORRIGE
 * ============================================================================
 * "Mais" era um `<Link href="/configuracoes">`. O excedente do array de módulos
 * não aparecia em lugar nenhum no celular — nem numa lista, nem atrás de um
 * menu. Ficava INALCANÇÁVEL, e sem erro, sem aviso e sem teste falhando: a
 * única forma de chegar a um módulo excedente era digitar a URL.
 *
 * Com dez módulos e `MAX_VISIBLE = 5`, isso valia para metade da aplicação —
 * Conhecimento, Hábitos, Projetos, Financeiro e Cofre. E a conclusão razoável de
 * quem não achasse o módulo novo seria que ele não foi feito.
 *
 * A folha custa poucas linhas e devolve o acesso. É melhor do que a alternativa
 * discutida (escolher quais módulos "merecem" os cinco lugares), porque aquela
 * decisão precisaria ser revista a cada módulo novo.
 *
 * ============================================================================
 * POR QUE NÃO `DropdownMenu` NEM `Modal` DE ui/
 * ============================================================================
 * `DropdownMenu` só aceita `items` de `{ label, onClick }` e desenha `<button>`:
 * navegação vira `router.push` à mão, e a barra perderia o `<a href>` — que é o
 * que dá abrir em nova aba, pré-carregamento do Next e link copiável. Ele também
 * se posiciona por coordenadas do gatilho e FECHA AO ROLAR, comportamento certo
 * para um menu de linha de tabela e errado para uma gaveta que ocupa a largura
 * da tela.
 *
 * `Modal` é diálogo centralizado com armadilha de foco e trava de rolagem — peso
 * de diálogo modal para o que é uma extensão da barra de navegação, e ainda
 * cobriria justamente a barra de onde o toque saiu.
 *
 * O que se reaproveita deles é o que importa: o padrão do véu como <div> com
 * clique (igual ao de `DropdownMenu`), o Esc, a devolução do foco ao gatilho e a
 * animação `animate-toast-in` — que é literalmente "nasce no rodapé e sobe", a
 * descrição desta gaveta (ver tailwind.config.ts).
 */
const MAX_VISIBLE = 5;

/** Ligado ao `aria-controls` do botão "Mais". */
const ID_FOLHA = "menu-mais-modulos";

export function MobileNavigation({ items }: { items: ModuleDef[] }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const folhaRef = useRef<HTMLDivElement>(null);

  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.slice(MAX_VISIBLE);

  // Navegar FECHA a folha. Sem isto, tocar num item leva à rota certa e deixa a
  // folha por cima dela — a tela nova chega escondida. Aqui NÃO se devolve o
  // foco ao gatilho: a pessoa já saiu para outra página.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  // `useCallback` com lista vazia: o efeito do Esc depende desta função, e uma
  // função recriada a cada render faria o ouvinte de teclado ser removido e
  // registrado de novo em toda passada. Só usa `setAberto` e um ref — ambos
  // estáveis —, então a lista vazia é honesta.
  const fechar = useCallback(() => {
    setAberto(false);
    // Sem esta devolução, fechar pelo Esc ou pelo véu deixa o foco no <body> e o
    // próximo Tab recomeça do topo da página.
    gatilhoRef.current?.focus();
  }, []);

  // Esc fecha. A gaveta é aberta com o dedo na maioria das vezes, mas ela
  // continua existindo quando a janela é estreita num computador — e aí não ter
  // Esc deixa quem navega por teclado preso dentro dela.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") fechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, fechar]);

  // Abrir leva o foco para dentro. Sem isto o Tab seguinte continuaria de onde
  // estava — do lado de fora de um painel que acabou de aparecer.
  useEffect(() => {
    if (!aberto) return;
    folhaRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }, [aberto]);

  const ativo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const itemDaFolha = (href: string) =>
    cn(
      // py-3 + 20px de linha = 44px de alvo, o piso de toque do projeto.
      "flex items-center gap-3 rounded-md px-3 py-3 text-legenda font-medium",
      ativo(href) ? "bg-surface-hover text-ink" : "text-ink-muted",
    );

  return (
    <>
      {/* Véu: <div> com clique, como em `DropdownMenu`. Não é um <button> de
          tela cheia porque um controle invisível do tamanho da janela entra na
          ordem do Tab e é anunciado antes de qualquer item da gaveta; quem usa
          teclado fecha pelo Esc, que está logo acima. */}
      {aberto && (
        <div
          className="fixed inset-0 z-40 animate-overlay-in bg-black/30 md:hidden"
          onClick={fechar}
        />
      )}

      {/*
        Gaveta e barra no MESMO contêiner fixo, empilhados na ordem natural.

        Antes a gaveta era `fixed bottom-[56px]` — a altura da barra escrita à
        mão. Qualquer mudança de padding, de tamanho de ícone ou uma quebra de
        rótulo em duas linhas mudaria essa altura e abriria uma fresta (ou uma
        sobreposição) que ninguém ligaria à causa. Empilhadas, a gaveta se apoia
        na barra e o número mágico deixa de existir.
      */}
      <div className="fixed inset-x-0 bottom-0 z-50 md:hidden">
        {aberto && (
          <div
            ref={folhaRef}
            id={ID_FOLHA}
            className="max-h-[60vh] animate-toast-in overflow-y-auto border-t border-line bg-surface p-2"
          >
            {/* <nav> com links, e não `role="menu"`: `menu`/`menuitem` prometem
                ao leitor de tela a navegação por setas de um menu de aplicação,
                que não implementamos aqui. Uma lista de links dentro de uma
                região nomeada é o que isto realmente é, e funciona com o gesto
                de exploração que a pessoa já usa no resto da página. */}
            {/* "Mais opções" e não "Mais módulos": além do excedente de módulos,
                a gaveta guarda Configurações e Ajuda. */}
            <nav aria-label="Mais opções">
              {overflow.map((item) => {
                const Glyph = Icon[item.icon];
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={ativo(item.href) ? "page" : undefined}
                    className={itemDaFolha(item.href)}
                  >
                    <Glyph width={20} height={20} className="shrink-0" />
                    {item.label}
                  </Link>
                );
              })}

              {/* Configurações e Ajuda repetem aqui o rodapé da barra lateral:
                  no celular não existe rodapé de barra nenhum, e esta gaveta é o
                  único lugar da navegação onde eles cabem. */}
              <Link href="/configuracoes" className={itemDaFolha("/configuracoes")}>
                <Icon.Settings width={20} height={20} className="shrink-0" />
                Configurações
              </Link>
              <Link href="/ajuda" className={itemDaFolha("/ajuda")}>
                <Icon.Help width={20} height={20} className="shrink-0" />
                Ajuda e atalhos
              </Link>
            </nav>
          </div>
        )}

        <nav
          aria-label="Navegação principal"
          className="flex items-stretch border-t border-line bg-surface/95 backdrop-blur"
        >
          {visible.map((item) => {
            const Glyph = Icon[item.icon];
            return (
              /*
                `aria-label` explícito porque o rótulo visível é TRUNCADO: com
                seis fatias num aparelho de 320px sobram ~53px por item, e
                "Calendário" a 12px não cabe. Sem `truncate` o rótulo quebraria
                em duas linhas, e como a barra é `items-stretch` isso deixaria
                TODAS as fatias mais altas por causa de uma. O texto encurta na
                tela, o nome inteiro continua sendo anunciado.
              */
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo(item.href) ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium transition-colors",
                  ativo(item.href) ? "text-ink" : "text-ink-muted",
                )}
              >
                <Glyph width={20} height={20} className="shrink-0" />
                <span className="w-full truncate px-1 text-center">{item.label}</span>
              </Link>
            );
          })}

          {overflow.length > 0 && (
            <button
              ref={gatilhoRef}
              type="button"
              onClick={() => (aberto ? fechar() : setAberto(true))}
              aria-expanded={aberto}
              aria-controls={ID_FOLHA}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium transition-colors",
                // Fica marcado quando a rota atual é um dos escondidos — senão a
                // barra inteira pareceria "em lugar nenhum" dentro deles.
                aberto || overflow.some((i) => ativo(i.href)) ? "text-ink" : "text-ink-muted",
              )}
            >
              <Icon.Dots width={20} height={20} className="shrink-0" />
              <span className="w-full truncate px-1 text-center">Mais</span>
            </button>
          )}
        </nav>
      </div>
    </>
  );
}
