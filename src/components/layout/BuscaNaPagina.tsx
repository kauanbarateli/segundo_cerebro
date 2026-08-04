"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CLASSE_DO_CAMPO_DE_BUSCA } from "@/components/ui/estilos";
import { Icon } from "@/components/ui/Icons";

/**
 * BUSCA QUE NÃO VAI AO SERVIDOR.
 *
 * ============================================================================
 * POR QUE NÃO PÔR O TERMO NA URL, COMO EM `/conhecimento`
 * ============================================================================
 * Em `/conhecimento` a ida ao servidor **é** a busca: quem procura é o Postgres,
 * com `textSearch` sobre o texto inteiro das páginas. O termo na URL é ganho
 * puro — resultado compartilhável, reversível pelo botão "voltar" e funcional
 * sem JavaScript.
 *
 * Em `/tarefas` seria o contrário. Aquela página roda um `Promise.all` de SEIS
 * leituras, e nenhuma delas muda em função do termo. Um `router.replace` a cada
 * parada do debounce re-executaria as seis para devolver exatamente os mesmos
 * dados — trabalho de servidor cujo resultado é jogado fora. Some-se que
 * `getTasks` faz `select("*")` sem paginação (a lista inteira JÁ ESTÁ no
 * cliente) e que busca no banco exigiria migration nova, coluna gerada e índice
 * GIN para um volume de aplicativo pessoal: o servidor não tem nada a oferecer
 * aqui.
 *
 * ============================================================================
 * POR QUE UM CONTEXTO, E NÃO UM CAMPO DENTRO DA PRÓPRIA LISTA
 * ============================================================================
 * Porque o pedido era a barra DO CABEÇALHO. O campo e a lista são IRMÃOS dentro
 * de um Componente de Servidor — não há como passar estado de um para o outro
 * por props. O contexto é a única ponte que não envolve o servidor, e custa
 * este arquivo.
 *
 * ⚠️ `aplicavel` é o que impede a repetição do erro que as pills cometiam.
 * Quem consome DECLARA se a busca faz sentido para o que está na tela agora, e
 * o campo some quando não faz. Ver o uso em `TasksView` para a aba do ClickUp.
 */

interface Contexto {
  termo: string;
  definirTermo: (v: string) => void;
  aplicavel: boolean;
  definirAplicavel: (v: boolean) => void;
}

const Ctx = createContext<Contexto | null>(null);

export function BuscaNaPagina({ children }: { children: ReactNode }) {
  const [termo, definirTermo] = useState("");
  // Começa aplicável: uma página que envolve o provedor tem busca por padrão, e
  // só quem tem uma visão SEM busca precisa dizer.
  const [aplicavel, definirAplicavel] = useState(true);

  const valor = useMemo(
    () => ({ termo, definirTermo, aplicavel, definirAplicavel }),
    [termo, aplicavel],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * Lança fora do provedor em vez de devolver um objeto vazio.
 *
 * Um padrão silencioso aqui significaria um campo de busca que aceita texto e
 * não filtra nada — o mesmo defeito que este trabalho inteiro veio corrigir, só
 * que escondido atrás de um `useContext` que "funciona".
 */
function useContexto(): Contexto {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("Use <BuscaNaPagina> em volta de quem chama esta busca.");
  }
  return ctx;
}

/** O termo digitado. Para quem FILTRA. */
export function useTermoDeBusca(): string {
  return useContexto().termo;
}

/**
 * Declara se a busca se aplica à visão atual. Para quem FILTRA.
 *
 * Efeito e não valor de render porque quem sabe disso é o consumidor, que
 * renderiza depois do campo — escrever no estado do provedor durante o render
 * do filho seria atualizar um componente já renderizado neste mesmo passe.
 */
export function useBuscaAplicavel(aplicavel: boolean): void {
  const { definirAplicavel } = useContexto();
  useEffect(() => {
    definirAplicavel(aplicavel);
  }, [aplicavel, definirAplicavel]);
}

/** O campo em si. Vai no slot `busca` do `PageHeader`. */
export function CampoDeBusca({ placeholder, rotulo }: { placeholder: string; rotulo: string }) {
  const { termo, definirTermo, aplicavel } = useContexto();

  if (!aplicavel) return null;

  return (
    <label className="relative block">
      <span className="sr-only">{rotulo}</span>
      <Icon.Search
        aria-hidden="true"
        width={16}
        height={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="search"
        value={termo}
        onChange={(e) => definirTermo(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        /* Sem debounce, de propósito: aqui não há ida ao servidor para adiar.
           Filtrar um array que já está em memória custa uma passada, e esperar
           350 ms para fazê-la só deixaria a digitação parecendo atrasada. */
        className={CLASSE_DO_CAMPO_DE_BUSCA}
      />
    </label>
  );
}
