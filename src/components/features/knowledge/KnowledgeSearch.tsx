"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icons";
import { CLASSE_DO_CAMPO_DE_BUSCA } from "@/components/ui/estilos";

/**
 * CAMPO DE BUSCA do módulo Conhecimento.
 *
 * MORA NO CABEÇALHO desde que a barra decorativa do `PageHeader` foi removida.
 * Antes as duas apareciam juntas nesta rota — a falsa em cima, esta logo abaixo
 * —, e era o defeito de interface mais visível do aplicativo.
 *
 * A contagem (`aria-live`) veio JUNTO, e não ficou no corpo da página. A
 * separação exigiria levantar o estado de "buscando" para um contexto de
 * cliente envolvendo cabeçalho e resultados; o que se ganharia são 18 px de
 * altura no cabeçalho. E a contagem logo abaixo do campo em que se acabou de
 * digitar é onde o olho já está.
 *
 * O TERMO MORA NA URL, e não em estado deste componente. É o que faz o resultado
 * ser compartilhável, voltar com o botão "voltar" do navegador e — detalhe que
 * some se a busca virar estado local — continuar funcionando com JavaScript
 * desligado, porque o `<form method="get">` embaixo é um formulário de verdade.
 * Quem executa a busca é `searchKnowledge` no servidor; este arquivo só decide
 * QUANDO trocar a URL.
 *
 * DEBOUNCE: cada tecla trocaria a URL, e trocar a URL aqui significa uma volta
 * ao servidor (a página é dinâmica). Digitar "postgres" viraria oito buscas, das
 * quais sete são jogadas fora — e, pior, elas podem voltar fora de ordem e
 * pintar o resultado de "postgr" depois do de "postgres".
 */

/**
 * 350 ms.
 *
 * Abaixo disso a rajada volta em quem digita rápido; acima, a lista parece
 * travada. É maior que o atraso do autosave do editor (800 ms é para gravação,
 * onde o custo de errar é escrever demais) porque aqui o usuário está ESPERANDO
 * a resposta: o atraso é percebido diretamente.
 */
const ATRASO_MS = 350;

export function KnowledgeSearch({
  termo: termoDaUrl,
  cadernoAtivoId,
  total,
}: {
  /** O `q` que a URL tem AGORA — a fonte da verdade, não o valor digitado. */
  termo: string;
  cadernoAtivoId: string | null;
  /** Quantidade de resultados da busca atual; `null` quando não há busca. */
  total: number | null;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(termoDaUrl);
  const [pendente, iniciar] = useTransition();
  /**
   * Último termo que ESTE componente mandou para a URL.
   *
   * Serve para separar "a URL mudou porque eu naveguei" de "a URL mudou por
   * fora" (voltar, avançar, um link). Sem essa distinção, a chegada da própria
   * navegação sobrescreveria o campo com um valor antigo: entre disparar a busca
   * de "pos" e ela voltar, a pessoa já digitou "postg", e o campo voltaria
   * sozinho para "pos" — apagando duas letras enquanto ela escreve.
   */
  const ultimoEnviadoRef = useRef(termoDaUrl);

  const navegar = useCallback(
    (valor: string) => {
      const params = new URLSearchParams();
      // O caderno permanece na URL durante a busca: a barra lateral continua
      // mostrando a árvore de onde a pessoa estava, e limpar o campo devolve
      // exatamente a tela anterior em vez de jogar para o primeiro caderno.
      if (cadernoAtivoId) params.set("caderno", cadernoAtivoId);
      const limpo = valor.trim();
      if (limpo) params.set("q", limpo);
      const consulta = params.toString();
      ultimoEnviadoRef.current = limpo;

      /**
       * `replace` e NÃO `push`.
       *
       * Com `push`, cada parada de digitação vira uma entrada no histórico:
       * quem busca "postgres" e aperta "voltar" passa por "postgre", "postgr",
       * "postg"… antes de sair da busca. O estado anterior à busca é o que a
       * pessoa quer de volta, e ele continua sendo a entrada anterior aqui.
       */
      iniciar(() => {
        router.replace(consulta ? `/conhecimento?${consulta}` : "/conhecimento", {
          scroll: false,
        });
      });
    },
    [cadernoAtivoId, router],
  );

  /**
   * O debounce em si.
   *
   * A comparação com `termoDaUrl` é a condição de parada: sem ela, a navegação
   * atualiza a prop, o efeito roda de novo e dispara a MESMA navegação para
   * sempre. Ela também cobre o caminho de volta — ao usar o botão "voltar" do
   * navegador, a URL muda sozinha e o campo precisa acompanhar sem tentar
   * navegar de novo.
   */
  useEffect(() => {
    if (texto.trim() === termoDaUrl) return;
    const timer = setTimeout(() => navegar(texto), ATRASO_MS);
    return () => clearTimeout(timer);
  }, [texto, termoDaUrl, navegar]);

  // Sincroniza o campo quando a URL muda POR FORA (voltar, avançar, clique num
  // caderno). Navegação própria não passa daqui — ver `ultimoEnviadoRef`.
  useEffect(() => {
    if (termoDaUrl === ultimoEnviadoRef.current) return;
    ultimoEnviadoRef.current = termoDaUrl;
    setTexto(termoDaUrl);
  }, [termoDaUrl]);

  const buscando = pendente || texto.trim() !== termoDaUrl;

  return (
    <div className="space-y-2">
      <form
        action="/conhecimento"
        method="get"
        onSubmit={(evento) => {
          // Com JavaScript, o Enter não recarrega a página inteira: só antecipa
          // a navegação que o debounce faria. Sem JavaScript, este handler não
          // existe e o `action` acima leva o formulário ao servidor.
          evento.preventDefault();
          navegar(texto);
        }}
        className="flex gap-2"
        role="search"
      >
        {cadernoAtivoId && <input type="hidden" name="caderno" value={cadernoAtivoId} />}
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar nas páginas</span>
          <Icon.Search
            aria-hidden="true"
            width={16}
            height={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <input
            type="search"
            name="q"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar nos cadernos"
            maxLength={200}
            className={CLASSE_DO_CAMPO_DE_BUSCA}
          />
        </label>
        {/* O botão fica SEMPRE na tela, e não dentro de um `<noscript>`.
            Dois motivos: `<noscript>` com elementos dentro é o caso em que o
            navegador com script ligado guarda o conteúdo como TEXTO, não como
            DOM, e a hidratação do React diverge do que veio do servidor — erro
            em produção por causa de um botão. E, com script, ele continua útil:
            adianta a busca que o debounce faria, para quem aperta em vez de
            esperar. */}
        <button
          type="submit"
          aria-label="Buscar"
          title="Buscar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-strong text-ink hover:bg-surface-muted"
        >
          {/* Só o ícone desde a mudança para o cabeçalho: ali a largura é do
              tamanho de um campo, não de uma coluna, e "Buscar" escrito ao lado
              de um campo que já diz "Buscar nos cadernos" gastava um terço do
              espaço para repetir a palavra. O `aria-label` mantém o botão
              nomeado para quem não vê o ícone. */}
          <Icon.Search aria-hidden="true" width={16} height={16} />
        </button>
      </form>

      {/* Região viva SEMPRE presente no DOM, mesmo vazia.
          Um `aria-live` que só é montado junto com o resultado costuma não ser
          anunciado: o leitor de tela precisa ter visto a região antes para
          perceber a mudança. Como a contagem é o único retorno de uma busca que
          não recarrega a página, ela é a informação que não pode se perder. */}
      <p role="status" aria-live="polite" className="min-h-[18px] text-legenda text-ink-subtle">
        {buscando
          ? "Buscando…"
          : total === null
            ? ""
            : total === 0
              ? `Nenhum resultado para “${termoDaUrl}”.`
              : `${total} ${total === 1 ? "resultado" : "resultados"} para “${termoDaUrl}”.`}
      </p>
    </div>
  );
}
