import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";

/**
 * Cifragem dos refresh tokens do Google — E9 / SB-SEC-016.
 *
 * As chaves são lidas de `process.env` a cada chamada (`serverEnv()` não guarda
 * nada em módulo), então dá para trocar a configuração entre casos. É isso que
 * permite testar rotação de verdade: cifrar sob uma configuração e decifrar sob
 * outra, como aconteceria entre dois deploys.
 */

const CONTA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OUTRA_CONTA = "11111111-2222-4333-8444-555555555555";

const chaveA = randomBytes(32).toString("base64");
const chaveB = randomBytes(32).toString("base64");

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;
const ORIGINAL_KEYS = process.env.TOKEN_ENCRYPTION_KEYS;

function configurar({ chave, chaves }: { chave?: string; chaves?: string }) {
  if (chave === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = chave;
  if (chaves === undefined) delete process.env.TOKEN_ENCRYPTION_KEYS;
  else process.env.TOKEN_ENCRYPTION_KEYS = chaves;
}

beforeEach(() => configurar({ chaves: `v2:${chaveB},v1:${chaveA}` }));

afterEach(() => {
  configurar({ chave: ORIGINAL_KEY, chaves: ORIGINAL_KEYS });
});

const tokens = () => import("./tokens");

describe("cifragem e integridade", () => {
  it("ida e volta de um refresh token", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await tokens();
    const segredo = "1//0gTESTrefreshTOKENvalue.-_example";
    const enc = encryptRefreshToken(segredo, CONTA);

    expect(enc.iv).toHaveLength(12);
    expect(enc.ciphertext.toString("utf8")).not.toContain(segredo);
    expect(enc.cryptoVersion).toBe(2);
    expect(enc.keyId).toBe("v2"); // a PRIMEIRA da lista é a ativa

    expect(
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: enc.cryptoVersion,
        keyId: enc.keyId,
        calendarAccountId: CONTA,
      }),
    ).toBe(segredo);
  });

  it("IV diferente a cada cifragem", async () => {
    const { encryptRefreshToken } = await tokens();
    const a = encryptRefreshToken("igual", CONTA);
    const b = encryptRefreshToken("igual", CONTA);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("ciphertext adulterado é recusado", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await tokens();
    const enc = encryptRefreshToken("protegido", CONTA);
    enc.ciphertext[0] ^= 0xff;
    expect(() =>
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: enc.cryptoVersion,
        keyId: enc.keyId,
        calendarAccountId: CONTA,
      }),
    ).toThrow();
  });

  it("ida e volta pelos helpers de hex do Postgres", async () => {
    const { toPgHex, fromPgHex } = await tokens();
    const buf = randomBytes(20);
    expect(fromPgHex(toPgHex(buf)).equals(buf)).toBe(true);
  });
});

describe("AAD — o ciphertext fica amarrado à conta", () => {
  it("a linha de uma conta NÃO decifra na linha de outra", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await tokens();
    const enc = encryptRefreshToken("token-da-conta-A", CONTA);

    // É exatamente o que acontece se alguém com escrita no banco copiar o
    // ciphertext de uma linha para outra: antes da E9 isto decifrava perfeito.
    expect(() =>
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: enc.cryptoVersion,
        keyId: enc.keyId,
        calendarAccountId: OUTRA_CONTA,
      }),
    ).toThrow();
  });

  it("versão errada também falha — o AAD inclui a versão", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await tokens();
    const enc = encryptRefreshToken("x", CONTA);
    expect(() =>
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: 3,
        keyId: enc.keyId,
        calendarAccountId: CONTA,
      }),
    ).toThrow();
  });
});

describe("compatibilidade com o formato legado (v1)", () => {
  /** Reproduz o que a versão anterior gravava: sem AAD, chave única. */
  function cifrarComoV1(texto: string, chaveBase64: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(chaveBase64, "base64"), iv);
    const dados = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
    return { ciphertext: Buffer.concat([dados, cipher.getAuthTag()]), iv };
  }

  it("linha antiga (crypto_version 1, key_id nulo) continua legível", async () => {
    // Cenário real do banco hoje: gravado antes da 0015.
    configurar({ chave: chaveA });
    const { decryptRefreshToken } = await tokens();
    const v1 = cifrarComoV1("token-antigo", chaveA);

    expect(
      decryptRefreshToken({
        ...v1,
        cryptoVersion: 1,
        keyId: null,
        calendarAccountId: CONTA,
      }),
    ).toBe("token-antigo");
  });

  it("crypto_version nulo é tratado como legado", async () => {
    configurar({ chave: chaveA });
    const { decryptRefreshToken } = await tokens();
    const v1 = cifrarComoV1("sem-versao", chaveA);

    expect(
      decryptRefreshToken({ ...v1, cryptoVersion: null, keyId: null, calendarAccountId: CONTA }),
    ).toBe("sem-versao");
  });

  it("a linha legada continua legível DEPOIS de a lista de chaves entrar", async () => {
    // O momento da migração: o ambiente já tem TOKEN_ENCRYPTION_KEYS, mas as
    // linhas antigas ainda estão em v1 sob a chave A. Se isto falhar, publicar
    // a rotação derruba a sincronização de todas as contas existentes.
    const v1 = cifrarComoV1("token-de-antes", chaveA);
    configurar({ chaves: `v2:${chaveB},v1:${chaveA}` });
    const { decryptRefreshToken } = await tokens();

    expect(
      decryptRefreshToken({ ...v1, cryptoVersion: 1, keyId: null, calendarAccountId: CONTA }),
    ).toBe("token-de-antes");
  });
});

describe("rotação de chave", () => {
  it("o que foi cifrado com a chave antiga continua legível com a nova na frente", async () => {
    // Deploy 1: só a chave A existe, e ela é a ativa.
    configurar({ chaves: `v1:${chaveA}` });
    const { encryptRefreshToken } = await tokens();
    const antigo = encryptRefreshToken("token-do-deploy-1", CONTA);
    expect(antigo.keyId).toBe("v1");

    // Deploy 2: chave nova entra NA FRENTE, antiga permanece atrás.
    configurar({ chaves: `v2:${chaveB},v1:${chaveA}` });
    const { decryptRefreshToken, encryptRefreshToken: cifrar2 } = await tokens();

    expect(
      decryptRefreshToken({
        ciphertext: antigo.ciphertext,
        iv: antigo.iv,
        cryptoVersion: antigo.cryptoVersion,
        keyId: antigo.keyId,
        calendarAccountId: CONTA,
      }),
    ).toBe("token-do-deploy-1");

    // E o que é gravado a partir de agora usa a chave nova.
    expect(cifrar2("token-do-deploy-2", CONTA).keyId).toBe("v2");
  });

  it("acha a chave certa mesmo com key_id desconhecido — a rede de segurança", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await tokens();
    const enc = encryptRefreshToken("token", CONTA);

    // Linha restaurada de um backup em que o id da chave se chamava outra coisa.
    expect(
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: enc.cryptoVersion,
        keyId: "nome-que-nao-existe-mais",
        calendarAccountId: CONTA,
      }),
    ).toBe("token");
  });

  it("remover a chave antiga cedo demais torna a linha ilegível, com mensagem acionável", async () => {
    configurar({ chaves: `v1:${chaveA}` });
    const { encryptRefreshToken } = await tokens();
    const enc = encryptRefreshToken("token", CONTA);

    // Deploy que tirou v1 da lista antes de todas as contas migrarem.
    configurar({ chaves: `v2:${chaveB}` });
    const { decryptRefreshToken } = await tokens();

    expect(() =>
      decryptRefreshToken({
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        cryptoVersion: enc.cryptoVersion,
        keyId: enc.keyId,
        calendarAccountId: CONTA,
      }),
    ).toThrow(/TOKEN_ENCRYPTION_KEYS/);
  });
});

describe("configuração das chaves", () => {
  it("a variável antiga sozinha continua funcionando, sob o id 'legado'", async () => {
    configurar({ chave: chaveA });
    const { encryptRefreshToken, chavesDeToken, ID_DA_CHAVE_LEGADA } = await tokens();
    expect(chavesDeToken()).toHaveLength(1);
    expect(encryptRefreshToken("x", CONTA).keyId).toBe(ID_DA_CHAVE_LEGADA);
  });

  it("a lista tem precedência sobre a variável antiga", async () => {
    configurar({ chave: chaveA, chaves: `v9:${chaveB}` });
    const { chavesDeToken } = await tokens();
    const chaves = chavesDeToken();
    expect(chaves).toHaveLength(1);
    expect(chaves[0]!.id).toBe("v9");
  });

  it("recusa configuração malformada em vez de falhar na hora de decifrar", async () => {
    const { chavesDeToken } = await tokens();

    configurar({ chaves: `${chaveB}` }); // sem "id:"
    expect(() => chavesDeToken()).toThrow(/formato/i);

    configurar({ chaves: `v1:${chaveA},v1:${chaveB}` }); // ids repetidos
    expect(() => chavesDeToken()).toThrow(/repetidos/i);

    configurar({ chaves: `v1:${randomBytes(16).toString("base64")}` }); // 16 bytes
    expect(() => chavesDeToken()).toThrow(/32 bytes/);

    configurar({});
    expect(() => chavesDeToken()).toThrow(/TOKEN_ENCRYPTION_KEYS/);
  });
});
