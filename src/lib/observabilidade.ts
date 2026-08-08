/**
 * A REGRA DE PRIVACIDADE DA TELEMETRIA — compartilhada pelos três ambientes.
 *
 * ============================================================================
 * ⚠️ ESTE É O ARQUIVO MAIS PERIGOSO DA INTEGRAÇÃO COM O SENTRY
 * ============================================================================
 * Um relatório de erro carrega, por padrão, muito mais do que a mensagem: URL
 * completa, corpo de requisição, estado de componente, respiração de rede,
 * e-mail do usuário. Num aplicativo comum isso é inconveniente. Aqui é
 * inaceitável — este produto guarda um COFRE cifrado de ponta a ponta, tokens
 * de ClickUp e Google, e notas pessoais. Vazar qualquer um deles para um
 * terceiro anularia, de uma vez, a garantia que o resto do projeto passou
 * bastante trabalho para construir.
 *
 * ============================================================================
 * POR QUE ALLOWLIST, E NUNCA DENYLIST
 * ============================================================================
 * A tentação é listar o que remover ("tira senha, tira token, tira conteúdo").
 * Denylist erra sempre para o lado do vazamento: ela protege contra os campos
 * que alguém LEMBROU de listar, e o campo novo — o que a próxima funcionalidade
 * inventar — entra por padrão. O erro é silencioso e só aparece depois de já
 * ter sido enviado.
 *
 * A allowlist erra para o lado oposto: um campo novo é descartado, e o pior que
 * acontece é um relatório mais pobre até alguém decidir incluí-lo
 * explicitamente. Perder contexto de depuração é recuperável; enviar o cofre
 * de alguém não é.
 *
 * O que passa é só isto, e nada mais:
 *   - tipo e mensagem do erro, com a mensagem TRUNCADA;
 *   - a pilha (nomes de função e arquivos do próprio pacote);
 *   - o CAMINHO da rota, sem query string e sem fragmento;
 *   - o id do usuário — nunca o e-mail (ver abaixo).
 */

/** Tipo estrutural mínimo do evento, para não acoplar ao `@sentry/types`. */
interface EventoLike {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: unknown;
  environment?: string;
  release?: string;
  exception?: unknown;
  message?: unknown;
  transaction?: string;
  request?: { url?: string; [k: string]: unknown };
  user?: { id?: string; [k: string]: unknown };
  contexts?: { trace?: unknown; [k: string]: unknown };
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Teto da mensagem de erro.
 *
 * A mensagem é o único campo de texto livre que sobrevive à allowlist, e texto
 * livre é justamente por onde o dado sensível costuma escapar: um erro de
 * validação que ecoa o valor recusado, uma exceção do Postgres que devolve a
 * linha inteira. 300 caracteres bastam para identificar o defeito e não bastam
 * para carregar um documento.
 */
const TETO_DA_MENSAGEM = 300;

function truncar(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  return valor.length > TETO_DA_MENSAGEM ? `${valor.slice(0, TETO_DA_MENSAGEM)}…` : valor;
}

/**
 * Devolve só o CAMINHO da URL. Query string e fragmento são descartados.
 *
 * Não é excesso de zelo: o app usa parâmetro de rota em vários lugares
 * (`?tarefa=<id>`, termo de busca do Conhecimento em `?q=`), e o termo de busca
 * de um segundo cérebro é conteúdo — "onde guardei a senha do banco" diz mais
 * sobre a pessoa do que o erro que ela encontrou.
 */
function soOCaminho(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    // URL relativa ou malformada: corta na primeira `?` ou `#` na mão.
    return url.split(/[?#]/)[0];
  }
}

/**
 * Aplica a allowlist. Devolve `null` para DESCARTAR o evento inteiro.
 *
 * Exportada e pura de propósito: é o que permite `observabilidade.test.ts`
 * montar um evento com conteúdo de cofre dentro e AFIRMAR que ele não sai —
 * uma verificação que não teria como existir se a regra morasse dentro do
 * arquivo de configuração do SDK.
 */
export function filtrarEvento(evento: EventoLike): EventoLike | null {
  if (!evento) return null;

  const limpo: EventoLike = {
    // Metadados do próprio Sentry: não vêm do aplicativo, não carregam dado.
    event_id: evento.event_id,
    timestamp: evento.timestamp,
    platform: evento.platform,
    level: evento.level,
    environment: evento.environment,
    release: evento.release,

    // O erro em si.
    exception: evento.exception,

    // `transaction` é o padrão da rota ("/projetos/[projectId]"), não a URL
    // preenchida — ele já vem sem valor de parâmetro.
    transaction: evento.transaction,
  };

  const mensagem = truncar(evento.message);
  if (mensagem) limpo.message = mensagem;

  const caminho = soOCaminho(evento.request?.url);
  if (caminho) limpo.request = { url: caminho };

  /*
    ⚠️ ID, NUNCA E-MAIL.

    E-mail é dado pessoal por qualquer definição, e o Sentry o usaria para
    montar um perfil identificável no painel — inclusive gerando gravatar. O id
    responde à única pergunta que a depuração precisa fazer ("é sempre a mesma
    pessoa?") sem identificar ninguém. `ip_address` também fica de fora: o SDK
    o coleta sozinho quando não é barrado.
  */
  if (evento.user?.id) limpo.user = { id: evento.user.id };

  // Rastro distribuído: só ids de correlação, sem carga.
  if (evento.contexts?.trace) limpo.contexts = { trace: evento.contexts.trace };

  return limpo;
}

/**
 * Limpa a trilha de navegação (breadcrumbs).
 *
 * A trilha é útil ("clicou aqui, navegou ali, e aí quebrou") e é também o lugar
 * mais fácil de vazar sem perceber: o SDK registra o corpo de cada `fetch`, o
 * texto de elementos clicados e — pior de tudo — TUDO que passou pelo
 * `console.log`. Num app com cofre, um `console.log` de depuração esquecido
 * viraria exportação de segredo.
 *
 * Categorias permitidas: navegação (só o caminho) e o esqueleto de requisições
 * HTTP (método e status, sem corpo). `console` e `ui.input` ficam de fora.
 */
export function filtrarTrilha(trilha: {
  category?: string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
} | null): typeof trilha {
  if (!trilha) return null;

  const categoria = trilha.category ?? "";

  if (categoria === "console" || categoria.startsWith("ui.")) return null;

  if (categoria === "navigation") {
    return {
      ...trilha,
      data: {
        from: soOCaminho(trilha.data?.from),
        to: soOCaminho(trilha.data?.to),
      },
    };
  }

  if (categoria === "fetch" || categoria === "xhr") {
    return {
      ...trilha,
      data: {
        method: trilha.data?.method,
        status_code: trilha.data?.status_code,
        url: soOCaminho(trilha.data?.url),
      },
    };
  }

  return { ...trilha, data: undefined };
}

/**
 * Taxa de amostragem de desempenho.
 *
 * Erro vai 100% (é o que se quer ver); traço de desempenho é amostrado, porque
 * ele é volumoso e a cota do Sentry acaba justamente no dia de pico — que é o
 * dia em que se precisa dela. 10% descreve bem a distribuição de latência de um
 * app com poucos usuários.
 */
export const AMOSTRAGEM_DE_TRACO = 0.1;

/** O DSN, ou `undefined`. Sem ele o SDK não inicializa — e isso é previsto. */
export const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
