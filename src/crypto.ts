// Crypto primitives for the Keylet vault.
//
// - Key derivation: PBKDF2-SHA256, 600,000 iterations (OWASP 2023 recommendation)
// - Encryption: AES-GCM 256-bit, fresh 12-byte IV per record
// - Ciphertext format on disk: "v1:<base64iv>:<base64ciphertext>"
//
// The verifier is a constant string encrypted under the derived key. Decrypting
// it successfully proves the password is correct without storing the password
// or a password-equivalent hash anywhere.

import { base64ToBytes, bytesToBase64 } from "./base64";

export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERIFIER_TEXT = "keylet-vault-v1";

export interface KeyMeta {
  /** Base64-encoded PBKDF2 salt. */
  salt: string;
  /** Iteration count used during derivation. */
  iterations: number;
  /** Encrypted VERIFIER_TEXT — used to verify a password without storing it. */
  verifier: string;
}

/**
 * Copy a Uint8Array into a concrete ArrayBuffer. Web Crypto's BufferSource
 * rejects the SharedArrayBuffer side of TS 5.7's `Uint8Array<ArrayBufferLike>`.
 */
function toBuffer(src: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(src.byteLength);
  new Uint8Array(out).set(src);
  return out;
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Derive an AES-GCM CryptoKey from a password + salt. */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(new TextEncoder().encode(password)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toBuffer(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can JWK-cache it in session storage
    ["encrypt", "decrypt"],
  );
}

/** Encrypt UTF-8 plaintext → "v1:<base64iv>:<base64ct>". */
export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv) },
    key,
    toBuffer(new TextEncoder().encode(plaintext)),
  );
  return "v1:" + bytesToBase64(iv) + ":" + bytesToBase64(new Uint8Array(ct));
}

/** Decrypt "v1:<base64iv>:<base64ct>" → plaintext. Throws on wrong key. */
export async function decryptString(key: CryptoKey, stored: string): Promise<string> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Invalid ciphertext format");
  }
  const iv = base64ToBytes(parts[1]!);
  const ct = base64ToBytes(parts[2]!);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBuffer(iv) }, key, toBuffer(ct));
  return new TextDecoder().decode(pt);
}

export function makeVerifier(key: CryptoKey): Promise<string> {
  return encryptString(key, VERIFIER_TEXT);
}

export async function verifyKey(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return (await decryptString(key, verifier)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

/** True if a stored secret looks like our encrypted format (vs. legacy plaintext). */
export function isEncryptedSecret(secret: string): boolean {
  return secret.startsWith("v1:");
}

// ===== Session-cache helpers (JWK form so structured-clone is reliable) =====

export async function exportKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey("jwk", key);
}

export async function importKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}
