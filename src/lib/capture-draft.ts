/**
 * Rascunho do compositor de capturas — onde ele mora, e por quê ali (SB-SEC-018).
 *
 * O rascunho é texto que a pessoa está escrevendo e ainda não enviou. Guardá-lo
 * é certo: recarregar a página no meio de uma ideia e perder o que foi digitado
 * é um defeito real. O problema era ONDE e SOB QUAL NOME.
 *
 * ============================================================================
 * OS TRÊS DEFEITOS DA VERSÃO ANTIGA
 * ============================================================================
 * `localStorage.setItem("sb-capture-draft", …)`:
 *
 *   1. `localStorage` é PERMANENTE. O texto sobrevive a fechar a aba, fechar o
 *      navegador, desligar a máquina. Um rascunho abandonado em 2026 continua
 *      legível em 2030, em claro, para qualquer pessoa que abra o navegador —
 *      ou para qualquer script que rode naquela origem.
 *   2. A CHAVE ERA GLOBAL. Duas contas no mesmo navegador compartilham o mesmo
 *      `localStorage`, então o rascunho de uma aparecia no compositor da outra.
 *      Com um usuário só isso é higiene; com dois é vazamento entre contas.
 *   3. NÃO ERA LIMPO NO LOGOUT. Sair da conta apagava a sessão e deixava o texto
 *      para trás — exatamente o oposto do que "sair" significa para quem clica.
 *
 * ============================================================================
 * O QUE MUDA
 * ============================================================================
 *   1. `sessionStorage`: o rascunho morre junto com a aba. Continua sobrevivendo
 *      a F5, que é o caso que o recurso existe para atender, e deixa de
 *      sobreviver a tudo o mais.
 *   2. Chave por usuário (`sb-capture-draft:<uuid>`). Cada conta lê a sua.
 *   3. `limparRascunhosDeCaptura()` roda no logout.
 *
 * ============================================================================
 * A LIMPEZA DO RESÍDUO — a parte que é fácil esquecer
 * ============================================================================
 * Parar de escrever em `localStorage` NÃO apaga o que já está lá. A chave antiga
 * continua no disco de quem usou a versão anterior, com o texto em claro e sem
 * nenhum código que a leia — invisível e permanente, o pior par possível.
 *
 * Por isso a limpeza varre `localStorage` também, e por isso ela roda na
 * montagem do compositor além do logout: a correção só vale para quem instalar
 * a versão nova E fizer logout algum dia. Varrer na montagem fecha isso na
 * primeira visita.
 */

const PREFIXO = "sb-capture-draft";

/** A chave global da versão antiga, mantida só para poder ser apagada. */
const CHAVE_LEGADA = PREFIXO;

export function chaveDoRascunho(userId: string): string {
  return `${PREFIXO}:${userId}`;
}

/**
 * `try/catch` em toda função deste arquivo, e não por superstição: acesso a
 * `Storage` LANÇA quando o navegador bloqueia armazenamento de terceiros ou
 * quando a cota estourou (Safari em navegação privada é o caso clássico). Uma
 * exceção aqui derrubaria a tela de captura inteira para salvar um rascunho —
 * trocar o recurso principal pelo acessório.
 */
function comStorage(qual: "session" | "local", acao: (s: Storage) => void): void {
  try {
    const s = qual === "session" ? window.sessionStorage : window.localStorage;
    if (s) acao(s);
  } catch {
    /* armazenamento indisponível — o rascunho é conveniência, não requisito */
  }
}

export function lerRascunho(userId: string): string | null {
  let valor: string | null = null;
  comStorage("session", (s) => {
    valor = s.getItem(chaveDoRascunho(userId));
  });
  return valor;
}

export function gravarRascunho(userId: string, conteudo: string): void {
  comStorage("session", (s) => s.setItem(chaveDoRascunho(userId), conteudo));
}

export function apagarRascunho(userId: string): void {
  comStorage("session", (s) => s.removeItem(chaveDoRascunho(userId)));
}

/**
 * Varre um storage e remove tudo que pertence a este recurso.
 *
 * A coleta de chaves acontece ANTES da remoção: `Storage.key(i)` é indexado por
 * posição e remover durante a varredura reindexa o que sobrou, fazendo o laço
 * pular entradas. É o mesmo motivo de não se remover de um array enquanto se
 * itera sobre ele.
 */
function varrer(qual: "session" | "local"): void {
  comStorage(qual, (s) => {
    const alvos: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const chave = s.key(i);
      if (chave === CHAVE_LEGADA || chave?.startsWith(`${PREFIXO}:`)) {
        alvos.push(chave);
      }
    }
    alvos.forEach((chave) => s.removeItem(chave));
  });
}

/**
 * Apaga o RESÍDUO PERMANENTE: tudo que este recurso deixou em `localStorage`.
 *
 * Roda na montagem do compositor, e é o que de fato remove o vazamento das
 * versões anteriores da máquina de quem já usou o aplicativo. `sessionStorage`
 * fica INTOCADO de propósito — é lá que mora o rascunho atual, que a montagem
 * está prestes a restaurar. Limpar os dois aqui apagaria o texto que o recurso
 * existe para preservar.
 */
export function limparResiduoLegado(): void {
  varrer("local");
}

/**
 * Apaga TODO rascunho de captura, dos dois storages e de todos os usuários.
 *
 * É a limpeza do LOGOUT: aí sim o rascunho da sessão corrente tem que sair
 * junto. Varre por prefixo em vez de apagar uma chave conhecida porque o alvo
 * inclui o que ficou de contas anteriores, cujos ids este código não tem como
 * saber.
 */
export function limparRascunhosDeCaptura(): void {
  varrer("session");
  varrer("local");
}
