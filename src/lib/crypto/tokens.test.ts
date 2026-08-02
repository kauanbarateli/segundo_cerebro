import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// A 32-byte key (base64) must exist before importing the module under test.
beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption (AES-256-GCM)", () => {
  it("round-trips a refresh token", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await import("./tokens");
    const secret = "1//0gTESTrefreshTOKENvalue.-_example";
    const enc = encryptRefreshToken(secret);

    expect(enc.iv).toHaveLength(12);
    expect(enc.ciphertext.toString("utf8")).not.toContain(secret); // not plaintext
    expect(decryptRefreshToken(enc.ciphertext, enc.iv)).toBe(secret);
  });

  it("produces a different IV each time (non-deterministic)", async () => {
    const { encryptRefreshToken } = await import("./tokens");
    const a = encryptRefreshToken("same-input");
    const b = encryptRefreshToken("same-input");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails to decrypt if the ciphertext is tampered (GCM auth)", async () => {
    const { encryptRefreshToken, decryptRefreshToken } = await import("./tokens");
    const enc = encryptRefreshToken("integrity-protected");
    enc.ciphertext[0] ^= 0xff; // flip a bit
    expect(() => decryptRefreshToken(enc.ciphertext, enc.iv)).toThrow();
  });

  it("round-trips through the pg hex helpers", async () => {
    const { toPgHex, fromPgHex } = await import("./tokens");
    const buf = randomBytes(20);
    expect(fromPgHex(toPgHex(buf)).equals(buf)).toBe(true);
  });
});
