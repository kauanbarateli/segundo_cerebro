import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Cifragem dos refresh tokens do Google — AES-256-GCM, só no servidor.
 *
 * =============================================================================
 * O QUE MUDOU NA E9 (SB-SEC-016), E POR QUÊ
 * =============================================================================
 * A versão anterior tinha UMA chave global, sem identificação e sem AAD.
 * `crypto_version` era gravado e nunca lido. Três consequências:
 *
 *   1. A CHAVE ERA IRROTACIONÁVEL. Trocar `TOKEN_ENCRYPTION_KEY` tornava todos
 *      os tokens ilegíveis de uma vez, e a recuperação era reconectar cada
 *      conta do Google à mão. Isso torna caro justamente o que precisa ser
 *      barato: no dia em que a chave vaza, rotacionar vira uma escolha entre
 *      segurança e serviço no ar.
 *   2. O CIFRADO NÃO ERA AMARRADO À LINHA. Sem AAD, o ciphertext da conta A,
 *      copiado para a linha da conta B, decifra perfeitamente. Quem tivesse
 *      escrita no banco (service_role, um backup restaurado por engano, um bug
 *      de upsert) trocava tokens entre contas sem que nada acusasse.
 *   3. O FORMATO NÃO PODIA EVOLUIR. Sem consultar a versão na leitura, qualquer
 *      mudança de esquema quebraria as linhas antigas.
 *
 * =============================================================================
 * AS DUAS VERSÕES QUE CONVIVEM
 * =============================================================================
 *   v1 (legado) — sem AAD, chave única de `TOKEN_ENCRYPTION_KEY`, `key_id` nulo.
 *                 É o que está gravado hoje. Continua sendo LIDO para sempre;
 *                 só não é mais escrito.
 *   v2 (atual)  — AAD = "<calendar_account_id>:<versao>", chave escolhida por
 *                 `key_id`.
 *
 * A leitura ORIENTA-SE pela `crypto_version` da linha. É isso que faz o número
 * deixar de ser decorativo.
 *
 * =============================================================================
 * O QUE O AAD RESOLVE, E O QUE ELE NÃO RESOLVE
 * =============================================================================
 * O AAD entra no cálculo da tag de autenticação do GCM mas NÃO é cifrado nem
 * armazenado — é recalculado na leitura a partir da própria linha. Se o
 * ciphertext for movido para outra conta, o AAD recalculado passa a ser outro e
 * a verificação da tag falha. O token não vaza para a linha errada; ele
 * simplesmente para de decifrar, que é o modo de falha correto.
 *
 * O AAD NÃO protege contra quem tem a chave: com a chave, refaz-se a cifragem
 * com o AAD que se quiser. Ele fecha a movimentação de dados, não o roubo de
 * chave — para isso serve a rotação.
 */

/** Formato legado: sem AAD, chave única. Ainda lido; nunca mais escrito. */
const CRYPTO_VERSION_LEGADO = 1;

/** Formato atual: AAD + chave identificada. */
export const CRYPTO_VERSION_ATUAL = 2;

const IV_BYTES = 12; // nonce padrão do GCM
const AUTH_TAG_BYTES = 16;

export interface ChaveDeToken {
  id: string;
  bytes: Buffer;
}

function decodificarChave(id: string, base64: string): ChaveDeToken {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== 32) {
    throw new Error(
      `A chave "${id}" precisa decodificar para exatamente 32 bytes (base64 de 32 bytes)`,
    );
  }
  return { id, bytes };
}

/**
 * Chaves configuradas, da ATIVA para a mais antiga.
 *
 * Duas variáveis de ambiente, e as duas continuam valendo:
 *
 *   TOKEN_ENCRYPTION_KEYS="v2:<base64>,v1:<base64>"
 *       Lista ordenada. A PRIMEIRA cifra o que entra; todas decifram o que já
 *       existe. É assim que a rotação acontece sem parada: publica-se a chave
 *       nova na frente, e cada conta migra sozinha na próxima renovação de
 *       token. Quando nenhuma linha citar mais a chave velha, ela sai da lista.
 *
 *   TOKEN_ENCRYPTION_KEY="<base64>"
 *       A variável antiga, de chave única. Continua funcionando e é o que está
 *       no ambiente hoje — por isso ela NÃO foi renomeada. Sem a lista, ela é a
 *       chave ativa, sob o id "legado".
 *
 * A ordem importa e é a da string: quem escreve a variável decide qual chave é
 * a ativa. Ordenar aqui por qualquer critério inventado (alfabético, por
 * exemplo) tiraria essa decisão de quem opera e a esconderia no código.
 */
export function chavesDeToken(): ChaveDeToken[] {
  const { tokenEncryptionKeys, tokenEncryptionKey } = serverEnv();

  if (tokenEncryptionKeys) {
    const chaves = tokenEncryptionKeys
      .split(",")
      .map((par) => par.trim())
      .filter((par) => par.length > 0)
      .map((par) => {
        const separador = par.indexOf(":");
        if (separador <= 0) {
          throw new Error(
            'TOKEN_ENCRYPTION_KEYS usa o formato "id:base64,id:base64" (a primeira é a ativa)',
          );
        }
        return decodificarChave(par.slice(0, separador).trim(), par.slice(separador + 1).trim());
      });

    if (chaves.length === 0) throw new Error("TOKEN_ENCRYPTION_KEYS está vazia");

    const ids = new Set(chaves.map((c) => c.id));
    if (ids.size !== chaves.length) {
      // Ids repetidos tornariam a busca por key_id ambígua, e o erro só
      // apareceria na hora de decifrar — muito longe da causa.
      throw new Error("TOKEN_ENCRYPTION_KEYS tem ids repetidos");
    }
    return chaves;
  }

  if (!tokenEncryptionKey) {
    throw new Error("Configure TOKEN_ENCRYPTION_KEYS (ou TOKEN_ENCRYPTION_KEY)");
  }
  return [decodificarChave(ID_DA_CHAVE_LEGADA, tokenEncryptionKey)];
}

/** Id atribuído à chave que vem da variável antiga, de valor único. */
export const ID_DA_CHAVE_LEGADA = "legado";

/* =========================================================================
 * OS AAD — um namespace por integração
 * =========================================================================
 * Cada integração monta o seu AAD, e é a diferença entre eles que impede um
 * segredo de uma migrar para a tabela da outra.
 *
 * A ALTERNATIVA QUE FOI RECUSADA: passar o id do ClickUp em
 * `encryptRefreshToken(plaintext, calendarAccountId)`. Funcionaria hoje e
 * criaria dois problemas — o nome do parâmetro passaria a mentir, num arquivo
 * de criptografia onde a leitura precisa ser literal; e as duas integrações
 * passariam a compartilhar o mesmo espaço de AAD, que é exatamente o que o AAD
 * existe para separar. Um ciphertext do Google gravado na linha do ClickUp com
 * o mesmo id decifraria.
 */

/**
 * Google Agenda — formato INALTERADO desde a 0015: `<id>:<versao>`, sem
 * prefixo.
 *
 * ⚠️ NÃO ACRESCENTE PREFIXO AQUI. Existe refresh token gravado em produção com
 * este AAD exato; mudá-lo torna todos ilegíveis de uma vez, e a recuperação é
 * reconectar cada conta do Google à mão. A ausência de prefixo é dívida
 * histórica, não descuido — e é barata: `clickup:` não pode colidir com um
 * uuid, porque uuid não contém dois-pontos.
 */
function aadCalendario(calendarAccountId: string, versao: number): Buffer {
  return Buffer.from(`${calendarAccountId}:${versao}`, "utf8");
}

/** ClickUp — namespace próprio desde a primeira linha gravada. */
function aadClickUp(clickupAccountId: string, versao: number): Buffer {
  return Buffer.from(`clickup:${clickupAccountId}:${versao}`, "utf8");
}

/** O que sai de uma cifragem, sem saber de que integração veio. */
export interface SegredoCifrado {
  ciphertext: Buffer; // ciphertext || authTag
  iv: Buffer;
  cryptoVersion: number;
  keyId: string;
}

/** Nome histórico, mantido para os chamadores do Google. */
export type EncryptedToken = SegredoCifrado;

/* =========================================================================
 * O NÚCLEO — genérico, recebe o AAD pronto
 * ========================================================================= */

/**
 * Cifra no formato ATUAL, com a PRIMEIRA chave da lista.
 *
 * `aadPronto` é obrigatório e não tem default: um AAD omitido produziria um
 * ciphertext que decifra em qualquer linha de qualquer integração — exatamente
 * o defeito que a v2 existe para fechar. Sem default, o compilador cobra.
 */
export function cifrar(plaintext: string, aadPronto: Buffer): SegredoCifrado {
  const [ativa] = chavesDeToken();
  if (!ativa) throw new Error("Nenhuma chave de cifragem configurada");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ativa.bytes, iv);
  cipher.setAAD(aadPronto);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]),
    iv,
    cryptoVersion: CRYPTO_VERSION_ATUAL,
    keyId: ativa.id,
  };
}

/**
 * Cifra o refresh token do Google. Invólucro fino sobre `cifrar`.
 *
 * A assinatura é a MESMA de antes da extração, de propósito: nenhum chamador do
 * Google muda de forma, então o refactor não pode ter invalidado dado nenhum.
 */
export function encryptRefreshToken(
  plaintext: string,
  calendarAccountId: string,
): EncryptedToken {
  return cifrar(plaintext, aadCalendario(calendarAccountId, CRYPTO_VERSION_ATUAL));
}

/** Cifra o token pessoal do ClickUp (0016). */
export function cifrarTokenClickUp(token: string, clickupAccountId: string): SegredoCifrado {
  return cifrar(token, aadClickUp(clickupAccountId, CRYPTO_VERSION_ATUAL));
}

function tentarDecifrar(
  chave: ChaveDeToken,
  ciphertext: Buffer,
  iv: Buffer,
  associado: Buffer | null,
): string | null {
  try {
    const dados = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES);
    const tag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", chave.bytes, iv);
    if (associado) decipher.setAAD(associado);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(dados), decipher.final()]).toString("utf8");
  } catch {
    // Chave errada, AAD errado ou dado adulterado — o GCM não distingue os três,
    // e não deve mesmo. `null` significa "esta chave não abre".
    return null;
  }
}

/** Material cifrado vindo do banco, sem saber de que integração é. */
export interface MaterialCifrado {
  ciphertext: Buffer;
  iv: Buffer;
  /** Da coluna `crypto_version`. Ausente é tratado como legado. */
  cryptoVersion: number | null;
  /** Da coluna `key_id`. Nulo nas linhas anteriores à 0015. */
  keyId: string | null;
}

export interface LinhaCifrada extends MaterialCifrado {
  /** Dono da linha — o AAD da v2 é derivado dele. */
  calendarAccountId: string;
}

/**
 * Decifra tentando as chaves configuradas, com o AAD que o chamador entregar.
 *
 * A ordem das tentativas é: a chave apontada por `key_id` primeiro, as demais
 * depois. A segunda parte é a rede de segurança da rotação — se `key_id` vier
 * nulo, desconhecido ou errado (linha restaurada de um backup antigo, id
 * renomeado no ambiente), a leitura ainda encontra a chave certa em vez de
 * falhar.
 *
 * TENTAR VÁRIAS CHAVES É SEGURO, e vale dizer por quê: a tag de autenticação do
 * GCM é verificada em cada tentativa, e a chance de uma chave errada produzir
 * uma tag válida é 2^-128. Não existe "quase decifrou" — ou a tag bate e o
 * texto é o original, ou a tentativa é rejeitada. O custo é uma operação
 * simétrica por chave, sobre alguns bytes.
 *
 * `aadPronto = null` significa formato LEGADO (v1, sem AAD). Quem decide isso é
 * o invólucro da integração, porque só ele conhece a própria história — o
 * ClickUp, por exemplo, nasceu na v2 e nunca passa `null`.
 */
export function decifrar(material: MaterialCifrado, aadPronto: Buffer | null): string {
  const chaves = chavesDeToken();
  const preferida = material.keyId ? chaves.filter((c) => c.id === material.keyId) : [];
  const restantes = chaves.filter((c) => c.id !== material.keyId);

  for (const chave of [...preferida, ...restantes]) {
    const texto = tentarDecifrar(chave, material.ciphertext, material.iv, aadPronto);
    if (texto !== null) return texto;
  }

  throw new Error(
    "Não foi possível decifrar o segredo: nenhuma chave configurada abre esta linha. " +
      "Confira TOKEN_ENCRYPTION_KEYS — se a chave antiga foi removida antes de todas as " +
      "linhas migrarem, é preciso reconectar a integração.",
  );
}

/**
 * Decifra o refresh token do Google, ORIENTANDO-SE pela versão gravada na linha.
 *
 * v1 (legado) não tem AAD; v2 tem. É aqui que essa decisão mora, e não no
 * núcleo: só este invólucro sabe que existiu um formato anterior no Google.
 */
export function decryptRefreshToken(linha: LinhaCifrada): string {
  const versao = linha.cryptoVersion ?? CRYPTO_VERSION_LEGADO;
  const associado =
    versao >= CRYPTO_VERSION_ATUAL ? aadCalendario(linha.calendarAccountId, versao) : null;
  return decifrar(linha, associado);
}

/**
 * Decifra o token do ClickUp.
 *
 * NUNCA passa `null`: a tabela `clickup_credentials` nasceu depois da 0015, com
 * `crypto_version` default 2, então não existe linha em formato legado. Aceitar
 * `null` aqui abriria um caminho para decifrar sem AAD que nenhum dado precisa
 * — e um caminho sem AAD é um caminho onde o ciphertext de outra linha serve.
 */
export function decifrarTokenClickUp(
  material: MaterialCifrado,
  clickupAccountId: string,
): string {
  const versao = material.cryptoVersion ?? CRYPTO_VERSION_ATUAL;
  return decifrar(material, aadClickUp(clickupAccountId, versao));
}

/** Supabase bytea columns round-trip as `\x...` hex strings via the JS SDK. */
export function toPgHex(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

export function fromPgHex(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}
