/**
 * Limite de taxa POR USUÁRIO, em memória do processo (plano v3, §M8-P0).
 *
 * ============================================================================
 * O PROBLEMA
 * ============================================================================
 * Toda Server Action é um ENDPOINT HTTP público. O `"use server"` não é uma
 * fronteira de confiança: o Next publica um id para cada função exportada, e
 * qualquer um com esse id manda POST direto, sem passar pelo formulário, pela
 * validação do cliente ou pelo botão desabilitado. Autenticação resolve "quem
 * é", não resolve "quantas vezes" — um `for` de dez mil iterações com a sessão
 * legítima do dono enche a tabela `captures` (ou `finance_transactions`, que é
 * pior: é dinheiro) em segundos.
 *
 * ============================================================================
 * SEJA HONESTO SOBRE O QUE ISTO É — memória de PROCESSO
 * ============================================================================
 * O Map abaixo vive na instância do servidor. Na Vercel, cada função
 * serverless é um processo que nasce, atende algumas requisições e morre, e
 * várias existem em paralelo. Consequências, sem enfeite:
 *
 *   - O limite é POR INSTÂNCIA, não global. Com 4 instâncias quentes e um
 *     limite de 30/min, o teto real é ~120/min para quem espalhar as
 *     requisições — o balanceador faz isso de graça, sem o atacante pedir.
 *   - Um cold start ZERA a contagem. Quem esperar a instância reciclar começa
 *     do zero.
 *
 * Portanto: isto FREIA O LAÇO INGÊNUO (o script de uma linha, o botão preso, o
 * retry maluco de um cliente com bug) e NÃO PARA UM ATACANTE DETERMINADO. É
 * uma redução de dano barata, não uma defesa.
 *
 * O PASSO SEGUINTE, já escolhido pelo plano: Upstash Redis (free tier), que dá
 * contador COMPARTILHADO entre instâncias e sobrevive a cold start. NÃO está
 * implementado aqui, de propósito — depende de conta, variável de ambiente e
 * uma ida de rede a mais por escrita. Quando entrar, o formato de `verificarLimite`
 * (chave, limite, relógio) é o mesmo; só a leitura/escrita do estado muda de
 * Map para Redis, e este arquivo vira o adaptador.
 *
 * ============================================================================
 * POR QUE NÃO EXISTE setInterval AQUI (o vazamento e a armadilha do conserto)
 * ============================================================================
 * Um Map que só cresce é um vazamento de memória: cada chave nova (usuário ×
 * ação) fica para sempre, mesmo depois da janela expirar. O conserto ÓBVIO é
 * um `setInterval` em nível de módulo varrendo o Map — e ele é uma armadilha:
 *
 *   - o timer roda para sempre, inclusive quando ninguém está usando a
 *     aplicação, e segura o event loop: um processo Node com timer ativo não
 *     encerra sozinho (em teste, `vitest` fica pendurado no fim da suíte);
 *   - em ambiente serverless ele é pior que inútil — o processo é congelado
 *     entre requisições, então o timer dispara em momentos arbitrários ou não
 *     dispara nunca, e ainda assim conta como trabalho agendado;
 *   - e o módulo passa a ter EFEITO COLATERAL só de ser importado, o que
 *     transforma qualquer `import` num compromisso com um timer.
 *
 * A limpeza aqui é PREGUIÇOSA, feita dentro da própria chamada:
 *   1. a chave consultada sempre é podada (marcas fora da janela caem fora);
 *   2. a cada `VARREDURA_A_CADA` chamadas — ou assim que o Map passar de
 *      `TETO_DE_CHAVES` — varre-se o Map inteiro apagando as chaves cuja
 *      janela já expirou por completo.
 * O passo 2 é amortizado: o custo de varrer N chaves é diluído em N chamadas,
 * então nenhuma requisição paga a limpeza inteira. Sem trabalho de fundo,
 * sem timer, e o processo continua encerrando sozinho.
 */

/** Configuração de um limite: quantas operações cabem em quanto tempo. */
export interface Limite {
  /** Máximo de operações PERMITIDAS dentro da janela. */
  maximo: number;
  /** Tamanho da janela deslizante, em milissegundos. */
  janelaMs: number;
}

export interface ResultadoDeLimite {
  permitido: boolean;
  /** Quantas operações ainda cabem na janela (0 quando bloqueado). */
  restantes: number;
  /**
   * Quanto falta, em ms, para a operação mais antiga sair da janela e abrir
   * uma vaga. Zero quando permitido — é o número que vira "tente em Ns".
   */
  esperarMs: number;
}

/**
 * Teto padrão das escritas de formulário: 30 por minuto por usuário e por ação.
 *
 * A escolha do número: um humano preenchendo formulário não passa de uns 5 por
 * minuto nem no dia mais agitado, e 30 dá folga de 6× para uso legítimo em
 * rajada (colar uma lista de capturas, lançar as despesas do mês de uma vez)
 * sem deixar de cortar o laço automatizado, que faz centenas por segundo. Um
 * teto apertado demais é pior que teto nenhum: vira um "erro aleatório" que o
 * dono aprende a ignorar clicando de novo.
 */
export const LIMITE_DE_ESCRITA: Limite = { maximo: 30, janelaMs: 60_000 };

interface Registro {
  /** Instantes (ms) das operações PERMITIDAS ainda dentro da janela. */
  marcas: number[];
  /** Guardado junto porque a varredura global não sabe qual limite gerou a chave. */
  janelaMs: number;
}

const registros = new Map<string, Registro>();

/**
 * Gatilhos da varredura global. 256 é arbitrário e o valor não é crítico:
 * grande o bastante para a varredura ser rara, pequeno o bastante para o Map
 * não engordar entre duas varreduras. O teto por tamanho existe para o caso
 * patológico (muitas chaves distintas em poucas chamadas), em que contar
 * chamadas demoraria a reagir.
 */
const VARREDURA_A_CADA = 256;
/** Exportado para o teste derivar o gatilho em vez de repetir o número. */
export const TETO_DE_CHAVES = 1_000;
let chamadasDesdeAVarredura = 0;

/** Descarta as marcas que já saíram da janela. Devolve as que ficaram. */
function podar(marcas: number[], janelaMs: number, agora: number): number[] {
  const corte = agora - janelaMs;
  // `>` e não `>=`: uma marca exatamente na borda já cumpriu a janela inteira.
  return marcas.filter((marca) => marca > corte);
}

/**
 * Varredura global amortizada — ver o cabeçalho do arquivo.
 *
 * Apaga a chave inteira quando NENHUMA marca sobrou: uma chave sem marcas é
 * indistinguível de uma chave que nunca existiu, então guardá-la é só ocupar
 * memória com o nome de um usuário que passou por aqui uma vez.
 */
function varrerSePreciso(agora: number): void {
  chamadasDesdeAVarredura += 1;
  if (chamadasDesdeAVarredura < VARREDURA_A_CADA && registros.size <= TETO_DE_CHAVES) {
    return;
  }
  chamadasDesdeAVarredura = 0;

  for (const [chave, registro] of registros) {
    const restantes = podar(registro.marcas, registro.janelaMs, agora);
    if (restantes.length === 0) registros.delete(chave);
    else registro.marcas = restantes;
  }
}

/**
 * Pergunta se a operação pode acontecer AGORA e, quando pode, já a contabiliza.
 *
 * É deliberadamente "consultar e consumir" numa chamada só: separar em duas
 * (`podeFazer()` + `registrei()`) abriria uma janela entre as duas em que duas
 * requisições concorrentes veriam a mesma vaga livre. Em Node isso não é
 * teórico — as actions são assíncronas e o `await` entre as duas chamadas
 * entregaria o controle para a outra requisição.
 *
 * O RELÓGIO É PARÂMETRO (`agora`), e não `Date.now()` lido lá dentro, por dois
 * motivos. O primeiro é o teste: com relógio injetado, "a janela expirou" é uma
 * soma, e não um `await sleep(60000)` que tornaria a suíte lenta e instável. O
 * segundo é honestidade de projeto: uma função que lê o relógio escondida é uma
 * função que não dá para raciocinar sobre.
 *
 * REQUISIÇÃO BLOQUEADA NÃO É REGISTRADA. Se fosse, um laço rodando sem parar
 * empurraria a janela para frente a cada tentativa e o usuário legítimo ficaria
 * preso para SEMPRE, mesmo depois de o laço morrer. Contando só o que passou, o
 * bloqueio dura no máximo uma janela.
 */
export function verificarLimite(
  chave: string,
  limite: Limite = LIMITE_DE_ESCRITA,
  agora: number = Date.now(),
): ResultadoDeLimite {
  varrerSePreciso(agora);

  const registro = registros.get(chave);
  const marcas = registro ? podar(registro.marcas, limite.janelaMs, agora) : [];

  if (marcas.length >= limite.maximo) {
    // As marcas estão em ordem de chegada, então a primeira é a que sai antes.
    // `Math.max(1, ...)` para nunca devolver 0 num resultado bloqueado — um
    // "tente de novo em 0s" convida à retentativa imediata, que só gasta banco.
    const esperarMs = Math.max(1, marcas[0]! + limite.janelaMs - agora);
    // Guarda a versão podada para a próxima chamada não repodar o mesmo lixo.
    registros.set(chave, { marcas, janelaMs: limite.janelaMs });
    return { permitido: false, restantes: 0, esperarMs };
  }

  marcas.push(agora);
  registros.set(chave, { marcas, janelaMs: limite.janelaMs });
  return { permitido: true, restantes: limite.maximo - marcas.length, esperarMs: 0 };
}

/**
 * Chave de limite. O `userId` vem SEMPRE de `auth.getUser()` no servidor,
 * nunca de campo do formulário — senão o atacante escolhe a própria chave e
 * cada requisição vira um usuário novo, sem limite nenhum.
 *
 * A ação entra na chave para que os módulos não disputem cota entre si: uma
 * rajada de lançamentos financeiros não pode bloquear a criação de tarefas.
 */
export function chaveDeUsuario(acao: string, userId: string): string {
  return `${acao}:${userId}`;
}

/**
 * Atalho para as Server Actions: devolve `null` quando pode seguir, ou já o
 * objeto de erro pronto quando estourou.
 *
 * O formato `{ ok: false, error }` é o mesmo de `ActionResult`, `CaptureResult`
 * e `SocialResult` — os três são estruturalmente idênticos —, então este
 * retorno serve às cinco actions sem conversão.
 *
 * A mensagem diz QUANTO esperar. "Tente mais tarde" faz o usuário clicar de
 * novo na hora, o que gasta requisição e não resolve; com o número, ele espera.
 * Arredonda para cima para nunca prometer uma janela que ainda não abriu.
 */
export function bloqueioPorLimite(
  acao: string,
  userId: string,
  limite: Limite = LIMITE_DE_ESCRITA,
  agora: number = Date.now(),
): { ok: false; error: string } | null {
  const resultado = verificarLimite(chaveDeUsuario(acao, userId), limite, agora);
  if (resultado.permitido) return null;
  const segundos = Math.ceil(resultado.esperarMs / 1000);
  return {
    ok: false,
    error: `Muitas operações seguidas. Tente de novo em ${segundos}s.`,
  };
}

/**
 * Apaga TODO o estado. Existe para os testes começarem limpos — sem isso, a
 * ordem dos casos passaria a importar, que é o começo de uma suíte que falha
 * só na integração contínua.
 */
export function zerarLimites(): void {
  registros.clear();
  chamadasDesdeAVarredura = 0;
}

/**
 * Quantas chaves estão ocupando memória agora. Serve ao teste que prova que a
 * limpeza preguiçosa realmente limpa — a alternativa seria confiar que limpa.
 */
export function chavesEmMemoria(): number {
  return registros.size;
}
