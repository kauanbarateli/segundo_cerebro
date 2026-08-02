import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Autenticação das chamadas AGENDADAS (cron) — plano v3, §M8-P0.
 *
 * `CRON_SECRET` já era lido por src/lib/env.ts e citado num comentário da rota
 * de sync ("um job futuro usaria este segredo"), mas NADA validava coisa
 * alguma: a rota aceitava só sessão de usuário e o segredo era decoração. Este
 * arquivo é o que faz o segredo existir de verdade.
 *
 * ============================================================================
 * ARMADILHA 1 — COMPARAR SEGREDO COM `===` VAZA TEMPO
 * ============================================================================
 * A comparação de strings do JavaScript sai no PRIMEIRO caractere diferente.
 * O tempo de resposta, então, é função de QUANTOS caracteres iniciais o
 * palpite acertou — e quem mede o tempo de muitas tentativas descobre o
 * segredo caractere a caractere, em tentativas proporcionais ao TAMANHO do
 * segredo em vez de ao número de combinações. É a diferença entre "inviável"
 * e "um fim de semana".
 *
 * O conserto é `timingSafeEqual`, que compara os bytes TODOS sempre. Só que
 * ele tem uma condição: se os buffers têm tamanhos diferentes, ele LANÇA
 * EXCEÇÃO em vez de devolver false — e uma exceção não tratada aqui viraria
 * 500 em vez de 401, além de, ela própria, revelar o comprimento do segredo.
 *
 * A saída usada aqui: comparar o SHA-256 dos dois lados. Digest de SHA-256
 * tem sempre 32 bytes, venha de uma string vazia ou de um segredo de 4 KB,
 * então os tamanhos são iguais POR CONSTRUÇÃO e não existe o caso de exceção.
 * Comparar hashes é seguro para esta finalidade: descobrir o segredo a partir
 * do digest exigiria inverter o SHA-256, e um palpite só passa se o digest
 * bater — o que exige acertar a entrada inteira.
 *
 * ============================================================================
 * ARMADILHA 2 — SEGREDO VAZIO NÃO PODE SIGNIFICAR "ROTA ABERTA"
 * ============================================================================
 * Este é o caso REAL do projeto hoje: `CRON_SECRET` está vazio (existe no
 * .env.example, não foi preenchido). A implementação ingênua —
 * `if (cabecalho === segredo)` — daria TRUE comparando "" com "", ou seja, o
 * ambiente sem segredo configurado seria justamente o ambiente onde qualquer
 * requisição sem cabeçalho nenhum entra como cron autorizado. O modo de falha
 * mais perigoso possível: a proteção some exatamente quando não foi
 * configurada, e nada no comportamento denuncia isso.
 *
 * Por isso o segredo vazio é tratado como ROTA FECHADA: sem `CRON_SECRET`
 * configurado, NENHUMA credencial de cron é aceita. Falhar fechado é o único
 * padrão defensável — o custo de errar para o lado fechado é um job que não
 * roda (visível, chato, consertável); para o lado aberto é um endpoint público.
 */

/**
 * Três respostas, e a diferença entre elas é o que a rota precisa saber:
 *
 *   "ausente"  — a requisição não apresentou credencial de cron nenhuma. NÃO é
 *                erro: é o caminho normal do usuário logado clicando
 *                "Sincronizar agora". Cabe à rota seguir com a sessão.
 *   "valida"   — credencial apresentada e correta.
 *   "invalida" — credencial apresentada e ERRADA (ou `CRON_SECRET` vazio).
 *                A rota deve recusar com 401 na hora, SEM cair no caminho da
 *                sessão: quem apresenta credencial está dizendo que é um robô,
 *                e deixá-lo tentar outra porta só serviria para sondar.
 */
export type ResultadoDeCron = "ausente" | "valida" | "invalida";

/**
 * De onde a credencial pode vir, nesta ordem:
 *
 *   1. `Authorization: Bearer <segredo>` — é o formato que o Vercel Cron manda
 *      sozinho, sem configuração, usando a variável `CRON_SECRET` do projeto.
 *      Suportar isto é o que permite trocar de agendador sem mexer no código.
 *   2. `x-cron-secret: <segredo>` — para chamada manual (curl, um agendador
 *      externo) sem precisar imitar o formato Bearer.
 *
 * A query string (`?secret=...`) é DELIBERADAMENTE não aceita: URL vai parar
 * em log de acesso, em histórico e em `Referer`. Segredo em URL é segredo
 * vazado com atraso.
 */
function credencialApresentada(request: Request): string | null {
  const autorizacao = request.headers.get("authorization");
  if (autorizacao) {
    const [esquema, ...resto] = autorizacao.split(" ");
    if (esquema?.toLowerCase() === "bearer" && resto.length > 0) {
      return resto.join(" ").trim();
    }
    // Cabeçalho Authorization com outro esquema (Basic, por exemplo) não é
    // credencial de cron. Devolver null aqui deixaria a requisição cair no
    // caminho da sessão; devolver string vazia a faz ser recusada. Recusar é
    // mais previsível: quem mandou Authorization queria autenticar por
    // cabeçalho, e falhar em silêncio esconderia um agendador mal configurado.
    return "";
  }

  const cabecalho = request.headers.get("x-cron-secret");
  return cabecalho === null ? null : cabecalho.trim();
}

/** Comparação em tempo constante — ver ARMADILHA 1 no topo do arquivo. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  // Os dois têm exatamente 32 bytes, então `timingSafeEqual` nunca lança.
  return timingSafeEqual(digestA, digestB);
}

export function verificarSegredoDeCron(request: Request): ResultadoDeCron {
  const apresentada = credencialApresentada(request);
  if (apresentada === null) return "ausente";

  const { cronSecret } = serverEnv();
  // ARMADILHA 2. Este `return` vem ANTES da comparação de propósito: nenhum
  // caminho de código pode comparar contra um segredo vazio.
  if (!cronSecret) return "invalida";

  return iguaisEmTempoConstante(apresentada, cronSecret) ? "valida" : "invalida";
}
