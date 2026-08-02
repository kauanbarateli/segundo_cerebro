/**
 * Client-side, zero-knowledge vault cryptography.
 *
 * Threat model: the server must never be able to read vault contents. So:
 *   1. A random 256-bit data key is generated in the browser.
 *   2. A key is DERIVED from the master password with Argon2id (memory-hard).
 *   3. The derived key WRAPS (AES-256-GCM) the data key. Only the wrapped data
 *      key + KDF params/salt are stored server-side.
 *   4. Each item is encrypted with the data key using AES-256-GCM + a unique IV.
 *   5. The master password is NEVER sent to or stored on the server.
 *
 * Nothing here logs plaintext. Callers must keep the derived/data keys in
 * volatile memory only and drop them on lock.
 */

import { argon2id } from "hash-wasm";

export interface KdfParameters {
  parallelism: number;
  iterations: number;
  memorySizeKb: number;
  hashLengthBytes: number;
}

// Argon2id parameters. Tuned for interactive browser unlock. Stored alongside
// the salt so future logins reproduce the exact derivation.
export const DEFAULT_KDF_PARAMETERS: KdfParameters = {
  parallelism: 1,
  iterations: 3,
  memorySizeKb: 65536, // 64 MiB
  hashLengthBytes: 32,
};

export const CRYPTO_VERSION = 1;

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto indisponível neste ambiente");
  return c.subtle;
}

/** Copies bytes into a fresh ArrayBuffer so WebCrypto's BufferSource typing is satisfied. */
function toBuf(u: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u.byteLength);
  new Uint8Array(b).set(u);
  return b;
}

// ---- base64 helpers (browser-safe) -----------------------------------------
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

// ---- key derivation ---------------------------------------------------------
async function deriveWrappingKey(
  masterPassword: string,
  salt: Uint8Array,
  params: KdfParameters,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password: masterPassword,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySizeKb,
    hashLength: params.hashLengthBytes,
    outputType: "binary",
  });
  return getSubtle().importKey("raw", toBuf(raw), { name: "AES-GCM" }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

// ---- vault lifecycle --------------------------------------------------------
export interface VaultMasterKeyMaterial {
  wrappedDataKeyB64: string;
  wrapIvB64: string;
  kdfSaltB64: string;
  kdfAlgorithm: "argon2id";
  kdfParameters: KdfParameters;
  cryptoVersion: number;
}

/** First-time setup: create a new data key and wrap it with the master password. */
export async function createVault(masterPassword: string): Promise<{
  material: VaultMasterKeyMaterial;
  dataKey: CryptoKey;
}> {
  const subtle = getSubtle();
  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey(masterPassword, salt, DEFAULT_KDF_PARAMETERS);

  const dataKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

  const wrapIv = randomBytes(12);
  const wrapped = await subtle.wrapKey("raw", dataKey, wrappingKey, {
    name: "AES-GCM",
    iv: toBuf(wrapIv),
  });

  return {
    material: {
      wrappedDataKeyB64: bytesToBase64(new Uint8Array(wrapped)),
      wrapIvB64: bytesToBase64(wrapIv),
      kdfSaltB64: bytesToBase64(salt),
      kdfAlgorithm: "argon2id",
      kdfParameters: DEFAULT_KDF_PARAMETERS,
      cryptoVersion: CRYPTO_VERSION,
    },
    dataKey,
  };
}

/** Unlock: reproduce the wrapping key from the master password and unwrap the data key. */
export async function unlockVault(
  masterPassword: string,
  material: VaultMasterKeyMaterial,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const salt = base64ToBytes(material.kdfSaltB64);
  const wrappingKey = await deriveWrappingKey(masterPassword, salt, material.kdfParameters);
  const wrapIv = base64ToBytes(material.wrapIvB64);
  const wrapped = base64ToBytes(material.wrappedDataKeyB64);

  // A wrong password makes unwrapKey throw (GCM auth failure).
  return subtle.unwrapKey(
    "raw",
    toBuf(wrapped),
    wrappingKey,
    { name: "AES-GCM", iv: toBuf(wrapIv) },
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

// ---- item encryption --------------------------------------------------------
export interface EncryptedField {
  ciphertextB64: string;
  ivB64: string;
}

export async function encryptItem(payload: unknown, dataKey: CryptoKey): Promise<EncryptedField> {
  const subtle = getSubtle();
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: toBuf(iv) }, dataKey, toBuf(plaintext));
  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv),
  };
}

export async function decryptItem<T = unknown>(
  field: EncryptedField,
  dataKey: CryptoKey,
): Promise<T> {
  const subtle = getSubtle();
  const iv = base64ToBytes(field.ivB64);
  const ciphertext = base64ToBytes(field.ciphertextB64);
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv: toBuf(iv) }, dataKey, toBuf(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ---- recovery kit -----------------------------------------------------------
/**
 * Export an encrypted recovery kit: the raw data key wrapped with a
 * high-entropy recovery code (shown to the user once). Losing BOTH the master
 * password AND this kit makes the data permanently unrecoverable.
 */
export async function exportRecoveryKit(dataKey: CryptoKey): Promise<{
  recoveryCode: string;
  kit: VaultMasterKeyMaterial;
}> {
  const recoveryBytes = randomBytes(24);
  const recoveryCode = bytesToBase64(recoveryBytes)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 28)
    .replace(/(.{4})/g, "$1-")
    .replace(/-$/, "");

  const salt = randomBytes(16);
  const wrappingKey = await deriveWrappingKey(recoveryCode, salt, DEFAULT_KDF_PARAMETERS);
  const wrapIv = randomBytes(12);
  const wrapped = await getSubtle().wrapKey("raw", dataKey, wrappingKey, {
    name: "AES-GCM",
    iv: toBuf(wrapIv),
  });

  return {
    recoveryCode,
    kit: {
      wrappedDataKeyB64: bytesToBase64(new Uint8Array(wrapped)),
      wrapIvB64: bytesToBase64(wrapIv),
      kdfSaltB64: bytesToBase64(salt),
      kdfAlgorithm: "argon2id",
      kdfParameters: DEFAULT_KDF_PARAMETERS,
      cryptoVersion: CRYPTO_VERSION,
    },
  };
}
