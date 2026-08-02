import { describe, expect, it } from "vitest";
import { createVault, unlockVault, encryptItem, decryptItem, exportRecoveryKit } from "./vault";

// Node 20+ exposes WebCrypto at globalThis.crypto; hash-wasm runs Argon2id in WASM.
describe("vault crypto (Argon2id + AES-256-GCM)", () => {
  it("creates a vault and unlocks it with the correct password", async () => {
    const { material, dataKey } = await createVault("correct horse battery");
    expect(material.kdfAlgorithm).toBe("argon2id");
    const key = await unlockVault("correct horse battery", material);
    expect(key).toBeDefined();
    void dataKey;
  });

  it("rejects the wrong master password", async () => {
    const { material } = await createVault("right-password");
    await expect(unlockVault("wrong-password", material)).rejects.toBeTruthy();
  });

  it("round-trips an item payload through encrypt/decrypt", async () => {
    const { dataKey } = await createVault("pw-123456");
    const payload = { name: "Nubank", username: "kauan", password: "s3cr3t", url: "https://nubank.com.br" };
    const enc = await encryptItem(payload, dataKey);
    expect(enc.ciphertextB64).not.toContain("s3cr3t");
    const back = await decryptItem<typeof payload>(enc, dataKey);
    expect(back).toEqual(payload);
  });

  it("exports a recovery kit that can unwrap the same data key", async () => {
    const { dataKey } = await createVault("master-pw");
    const payload = { name: "Item" };
    const enc = await encryptItem(payload, dataKey);

    const { recoveryCode, kit } = await exportRecoveryKit(dataKey);
    expect(recoveryCode.length).toBeGreaterThan(10);

    const recovered = await unlockVault(recoveryCode, kit);
    expect(await decryptItem(enc, recovered)).toEqual(payload);
  });
}, 30_000);
