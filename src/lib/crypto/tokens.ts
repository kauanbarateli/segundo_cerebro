import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Server-side AES-256-GCM encryption for Google refresh tokens.
 *
 * The key comes from TOKEN_ENCRYPTION_KEY (32 bytes, base64) and exists only in
 * the server environment. Refresh tokens are NEVER stored in plaintext and this
 * module is never imported by client code (`server-only` guard above).
 */

const CRYPTO_VERSION = 1;
const IV_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_BYTES = 16;

function getKey(): Buffer {
  const { tokenEncryptionKey } = serverEnv();
  if (!tokenEncryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }
  const key = Buffer.from(tokenEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 bytes)");
  }
  return key;
}

export interface EncryptedToken {
  ciphertext: Buffer; // ciphertext || authTag
  iv: Buffer;
  cryptoVersion: number;
}

export function encryptRefreshToken(plaintext: string): EncryptedToken {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, authTag]),
    iv,
    cryptoVersion: CRYPTO_VERSION,
  };
}

export function decryptRefreshToken(ciphertext: Buffer, iv: Buffer): string {
  const key = getKey();
  const data = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Supabase bytea columns round-trip as `\x...` hex strings via the JS SDK. */
export function toPgHex(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

export function fromPgHex(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}
