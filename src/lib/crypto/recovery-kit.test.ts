import { describe, expect, it } from "vitest";
import {
  createVault,
  decryptItem,
  encryptItem,
  exportRecoveryKit,
  formatRecoveryCode,
  rewrapDataKey,
  unlockVault,
} from "./vault";
import {
  parseRecoveryKit,
  RECOVERY_KIT_FORMAT,
  RECOVERY_KIT_FORMAT_VERSION,
  RecoveryKitError,
  recoveryKitFilename,
  restoreDataKeyFromKit,
  serializeRecoveryKit,
  verifyRecoveryKitArtifact,
} from "./recovery-kit";

const CRIADO_EM = new Date("2026-08-02T13:45:00.000Z");

/**
 * O teste que define o recurso.
 *
 * A regra do cenário é a mesma do critério de pronto do plano: depois da linha
 * marcada, o código só pode tocar em DUAS strings — o texto do arquivo e o
 * código de recuperação. Nada de `dataKey`, nada de `material`, nada de
 * variável viva do trecho anterior. É a tradução, em teste automatizado, de
 * "navegador limpo": um processo que nunca viu este cofre, com o artefato na
 * mão e mais nada.
 *
 * Isso NÃO substitui abrir o navegador — a leitura do arquivo pelo `<input
 * type="file">`, o download via Blob e a gravação no banco ficam de fora. O que
 * este teste garante é que o artefato é criptograficamente auto-suficiente, que
 * era exatamente a parte quebrada.
 */
describe("kit de recuperação — ciclo completo", () => {
  it("recupera o cofre a partir de arquivo + código, sem nenhum outro estado", async () => {
    // --- sessão original -----------------------------------------------------
    const { material, dataKey } = await createVault("senha-mestra-original");
    const segredo = { name: "Nubank", username: "kauan", password: "s3nh4-do-banco" };
    const itemCifrado = await encryptItem(segredo, dataKey);

    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);
    const arquivo = serializeRecoveryKit(kit, CRIADO_EM);

    // O que o servidor guarda do cofre original, para provar depois que a
    // senha mestra antiga realmente deixou de ser a única porta.
    const materialOriginal = material;

    // === FRONTEIRA ===========================================================
    // Daqui para baixo, só `arquivo`, `recoveryCode` e `itemCifrado` (que é o
    // ciphertext que já mora no banco). Nenhuma chave em memória.
    // =========================================================================

    const lido = parseRecoveryKit(arquivo);
    const chaveRecuperada = await restoreDataKeyFromKit(recoveryCode, lido);

    // O item que estava no banco volta a ser legível.
    expect(await decryptItem(itemCifrado, chaveRecuperada)).toEqual(segredo);

    // E a recuperação termina definindo uma senha mestra NOVA, que passa a abrir
    // o mesmo cofre — é isso que fecha o ciclo, não só ler os itens uma vez.
    const materialNovo = await rewrapDataKey("senha-mestra-nova", chaveRecuperada);
    const aposReset = await unlockVault("senha-mestra-nova", materialNovo);
    expect(await decryptItem(itemCifrado, aposReset)).toEqual(segredo);

    // A senha antiga não abre o material novo, e a nova não abre o antigo:
    // são embrulhos independentes da mesma chave de dados.
    await expect(unlockVault("senha-mestra-original", materialNovo)).rejects.toBeTruthy();
    await expect(unlockVault("senha-mestra-nova", materialOriginal)).rejects.toBeTruthy();
  });

  it("o arquivo sozinho não abre o cofre — e o código sozinho também não", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);
    const arquivo = serializeRecoveryKit(kit, CRIADO_EM);

    // O código NÃO pode estar dentro do arquivo: se estivesse, um backup
    // automático da pasta Downloads seria uma cópia utilizável do cofre.
    expect(arquivo).not.toContain(recoveryCode);
    expect(arquivo).not.toContain(recoveryCode.replace(/-/g, ""));

    // Arquivo + código errado não abre.
    await expect(
      restoreDataKeyFromKit("aaaa-bbbb-cccc-dddd-eeee-ffff-gggg", parseRecoveryKit(arquivo)),
    ).rejects.toBeInstanceOf(RecoveryKitError);
  });

  it("aceita o código digitado sem hífen, com espaços ou com quebra de linha", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);

    const variacoes = [
      recoveryCode.replace(/-/g, ""),
      recoveryCode.replace(/-/g, " "),
      `  ${recoveryCode}\n`,
      recoveryCode.replace(/-/g, "\n"),
    ];

    for (const variacao of variacoes) {
      expect(formatRecoveryCode(variacao)).toBe(recoveryCode);
      await expect(restoreDataKeyFromKit(variacao, kit)).resolves.toBeDefined();
    }
  });

  it("NÃO normaliza maiúsculas e minúsculas (o alfabeto é base64)", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);

    // Só faz sentido testar se o código sorteado tem letras de ambos os casos.
    const temMaiuscula = /[A-Z]/.test(recoveryCode);
    const temMinuscula = /[a-z]/.test(recoveryCode);
    if (temMaiuscula && temMinuscula) {
      await expect(restoreDataKeyFromKit(recoveryCode.toLowerCase(), kit)).rejects.toBeInstanceOf(
        RecoveryKitError,
      );
    }
  });

  it("verifica o artefato contra a chave viva e rejeita kit de outro cofre", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);
    const arquivo = serializeRecoveryKit(kit, CRIADO_EM);

    await expect(
      verifyRecoveryKitArtifact({ artifactText: arquivo, recoveryCode, dataKey }),
    ).resolves.toBeUndefined();

    // Kit de OUTRO cofre: o unwrap funciona (o código bate com o arquivo), mas a
    // chave é outra. Sem a comparação de bytes isto passaria por recuperação
    // válida e todos os itens falhariam ao decifrar depois.
    const outro = await createVault("pw-do-outro-cofre");
    const kitAlheio = await exportRecoveryKit(outro.dataKey);
    await expect(
      verifyRecoveryKitArtifact({
        artifactText: serializeRecoveryKit(kitAlheio.kit, CRIADO_EM),
        recoveryCode: kitAlheio.recoveryCode,
        dataKey,
      }),
    ).rejects.toBeInstanceOf(RecoveryKitError);
  });
}, 60_000);

describe("kit de recuperação — formato do arquivo", () => {
  it("grava um envelope versionado e legível", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { kit } = await exportRecoveryKit(dataKey);
    const arquivo = serializeRecoveryKit(kit, CRIADO_EM);

    const json = JSON.parse(arquivo);
    expect(json.format).toBe(RECOVERY_KIT_FORMAT);
    expect(json.formatVersion).toBe(RECOVERY_KIT_FORMAT_VERSION);
    expect(json.createdAt).toBe(CRIADO_EM.toISOString());
    expect(json.material.kdfAlgorithm).toBe("argon2id");
    expect(arquivo).toContain("\n  "); // indentado, não uma linha só
  });

  it("nomeia o arquivo por data", () => {
    expect(recoveryKitFilename(CRIADO_EM)).toBe("cofre-kit-de-recuperacao-2026-08-02.json");
  });

  it("recusa um formato mais novo em vez de tentar interpretar", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { kit } = await exportRecoveryKit(dataKey);
    const json = JSON.parse(serializeRecoveryKit(kit, CRIADO_EM));
    json.formatVersion = RECOVERY_KIT_FORMAT_VERSION + 1;

    expect(() => parseRecoveryKit(JSON.stringify(json))).toThrow(/versão mais nova/i);
  });

  it("distingue arquivo errado, arquivo corrompido e campo faltando", async () => {
    const { dataKey } = await createVault("pw-abcdefgh");
    const { kit } = await exportRecoveryKit(dataKey);
    const base = JSON.parse(serializeRecoveryKit(kit, CRIADO_EM));

    expect(() => parseRecoveryKit("não é json")).toThrow(/não é JSON válido/i);
    expect(() => parseRecoveryKit(JSON.stringify({ hello: "world" }))).toThrow(
      /não é um kit de recuperação do Cofre/i,
    );

    const semCampo = structuredClone(base);
    delete semCampo.material.wrapIvB64;
    expect(() => parseRecoveryKit(JSON.stringify(semCampo))).toThrow(/incompleto/i);

    const corrompido = structuredClone(base);
    corrompido.material.kdfSaltB64 = "«»não-é-base64«»";
    expect(() => parseRecoveryKit(JSON.stringify(corrompido))).toThrow(/corrompido/i);

    const semParametros = structuredClone(base);
    semParametros.material.kdfParameters.iterations = 0;
    expect(() => parseRecoveryKit(JSON.stringify(semParametros))).toThrow(/iterations/i);

    const outroAlgoritmo = structuredClone(base);
    outroAlgoritmo.material.kdfAlgorithm = "scrypt";
    expect(() => parseRecoveryKit(JSON.stringify(outroAlgoritmo))).toThrow(/desconhecido/i);
  });

  it("um kit antigo continua válido depois de trocar a senha mestra", async () => {
    // Consequência de segurança que a tela precisa declarar: o kit embrulha a
    // CHAVE DE DADOS, não a senha. Trocar a senha mestra não revoga kit nenhum.
    const { dataKey } = await createVault("senha-antiga");
    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);

    const materialNovo = await rewrapDataKey("senha-nova", dataKey);
    const aposTroca = await unlockVault("senha-nova", materialNovo);

    const viaKit = await restoreDataKeyFromKit(recoveryCode, kit);
    const item = await encryptItem({ name: "x" }, aposTroca);
    expect(await decryptItem(item, viaKit)).toEqual({ name: "x" });
  });
}, 60_000);
