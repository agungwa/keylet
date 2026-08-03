// Vault: high-level API over storage + crypto. Callers (popup, scan) talk only
// to this module — never to storage or crypto directly.
//
// Threat model:
// - Secrets on disk are AES-GCM encrypted under a key derived from a
//   user-chosen master password. Salt + verifier are stored; the password
//   and derived key are never persisted to disk.
// - The derived key is cached in chrome.storage.session (RAM-only, cleared
//   on browser close) so the popup doesn't prompt on every open. The cache
//   never touches disk.
// - lockNow() drops the session cache; the next popup open re-prompts.

import { base64ToBytes, bytesToBase64 } from "./base64";
import {
  PBKDF2_ITERATIONS,
  decryptString,
  deriveKey,
  encryptString,
  exportKeyJwk,
  importKeyJwk,
  isEncryptedSecret,
  makeVerifier,
  randomSalt,
  verifyKey,
  type KeyMeta,
} from "./crypto";
import { readRawAccounts, uid, writeRawAccounts } from "./storage";
import type { Account, NewAccount } from "./types";

const META_KEY = "key_meta";
const SESSION_KEY = "vault_key_jwk"; // chrome.storage.session — RAM only

let cachedMeta: KeyMeta | null = null;

// ===== Meta helpers =====
async function readMeta(): Promise<KeyMeta | null> {
  const data = await chrome.storage.local.get(META_KEY);
  const meta = data[META_KEY];
  return (meta as KeyMeta | undefined) ?? null;
}

async function writeMeta(meta: KeyMeta): Promise<void> {
  await chrome.storage.local.set({ [META_KEY]: meta });
  cachedMeta = meta;
}

// ===== Session key cache (RAM only) =====
async function cacheKey(key: CryptoKey): Promise<void> {
  try {
    const jwk = await exportKeyJwk(key);
    await chrome.storage.session.set({ [SESSION_KEY]: jwk });
  } catch {
    // If session storage rejects the JWK for some reason, we simply don't
    // cache — caller will re-prompt next time.
  }
}

async function loadCachedKey(): Promise<CryptoKey | null> {
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    const jwk = data[SESSION_KEY];
    if (!jwk) return null;
    return await importKeyJwk(jwk as JsonWebKey);
  } catch {
    return null;
  }
}

async function dropCachedKey(): Promise<void> {
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ===== Public state queries =====

export async function isConfigured(): Promise<boolean> {
  if (cachedMeta) return true;
  const meta = await readMeta();
  cachedMeta = meta;
  return meta !== null;
}

/** True if there's an existing key usable in this browser session. */
export async function isUnlocked(): Promise<boolean> {
  const key = await loadCachedKey();
  return key !== null;
}

/**
 * Count of accounts whose secrets are not yet encrypted. Drives the migration
 * prompt on first setup (0 = nothing to migrate).
 */
export async function countPlaintextAccounts(): Promise<number> {
  const raw = await readRawAccounts();
  return raw.filter((a) => !isEncryptedSecret(a.secret)).length;
}

// ===== Setup / unlock / lock =====

async function commitKey(key: CryptoKey, meta: KeyMeta): Promise<void> {
  await writeMeta(meta);
  await cacheKey(key);
}

/**
 * First-time setup (or migration): derive a key from `password`, encrypt any
 * existing plaintext accounts, persist salt + verifier.
 */
export async function setup(password: string): Promise<{ migrated: number }> {
  const salt = randomSalt();
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const verifier = await makeVerifier(key);

  // Encrypt any existing plaintext accounts (migration).
  const raw = await readRawAccounts();
  let migrated = 0;
  const out: Account[] = [];
  for (const a of raw) {
    if (isEncryptedSecret(a.secret)) {
      out.push(a); // already encrypted — leave alone
    } else {
      out.push({ ...a, secret: await encryptString(key, a.secret) });
      migrated++;
    }
  }
  await writeRawAccounts(out);

  const meta: KeyMeta = {
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    verifier,
  };
  await commitKey(key, meta);
  return { migrated };
}

/** Attempt to unlock with `password`. Returns false on wrong password. */
export async function unlock(password: string): Promise<boolean> {
  const meta = cachedMeta ?? (await readMeta());
  if (!meta) throw new Error("Vault is not configured");
  cachedMeta = meta;

  const salt = base64ToBytes(meta.salt);
  const key = await deriveKey(password, salt, meta.iterations);
  if (!(await verifyKey(key, meta.verifier))) return false;

  await cacheKey(key);
  return true;
}

export async function lockNow(): Promise<void> {
  await dropCachedKey();
}

/**
 * Change the master password: verify the old one, re-derive a new key, and
 * re-encrypt every stored secret. Returns false if the old password is wrong.
 */
export async function changePassword(oldPw: string, newPw: string): Promise<boolean> {
  const meta = cachedMeta ?? (await readMeta());
  if (!meta) throw new Error("Vault is not configured");

  const oldSalt = base64ToBytes(meta.salt);
  const oldKey = await deriveKey(oldPw, oldSalt, meta.iterations);
  if (!(await verifyKey(oldKey, meta.verifier))) return false;

  const raw = await readRawAccounts();
  const newSalt = randomSalt();
  const newKey = await deriveKey(newPw, newSalt, PBKDF2_ITERATIONS);

  const reencrypted: Account[] = [];
  for (const a of raw) {
    const plaintext = await decryptString(oldKey, a.secret);
    reencrypted.push({ ...a, secret: await encryptString(newKey, plaintext) });
  }
  await writeRawAccounts(reencrypted);

  const newMeta: KeyMeta = {
    salt: bytesToBase64(newSalt),
    iterations: PBKDF2_ITERATIONS,
    verifier: await makeVerifier(newKey),
  };
  await commitKey(newKey, newMeta);
  return true;
}

/** Wipe everything (for "forgot password"). */
export async function wipe(): Promise<void> {
  await dropCachedKey();
  cachedMeta = null;
  await chrome.storage.local.remove(["otp_accounts", META_KEY]);
}

// ===== Decrypted account I/O =====

async function requireKey(): Promise<CryptoKey> {
  const key = await loadCachedKey();
  if (!key) throw new Error("Vault is locked");
  return key;
}

/** Load all accounts, decrypting their secrets. Requires unlocked vault. */
export async function loadDecrypted(): Promise<Account[]> {
  const key = await requireKey();
  const raw = await readRawAccounts();
  const out: Account[] = [];
  for (const a of raw) {
    if (isEncryptedSecret(a.secret)) {
      out.push({ ...a, secret: await decryptString(key, a.secret) });
    } else {
      // Legacy plaintext — shouldn't normally happen post-setup, but tolerate it.
      out.push(a);
    }
  }
  return out;
}

/** Save (encrypting all secrets). Requires unlocked vault. */
export async function saveEncrypted(accs: Account[]): Promise<void> {
  const key = await requireKey();
  const out: Account[] = [];
  for (const a of accs) {
    out.push({ ...a, secret: await encryptString(key, a.secret) });
  }
  await writeRawAccounts(out);
}

/**
 * Append new (decrypted) accounts, deduping by lowercased issuer|label|uppercase secret.
 * - If the vault is configured, secrets are encrypted before writing.
 * - If the vault is NOT configured, secrets are written as plaintext (legacy
 *   mode) — they'll be migrated when the user sets up a master password.
 */
export async function addAccounts(
  incoming: NewAccount[],
): Promise<{ added: number; total: number }> {
  const key = await loadCachedKey();
  const raw = key ? await loadDecrypted() : await readRawAccounts();

  const dedupeKey = (a: { issuer: string; label: string; secret: string }): string =>
    `${a.issuer.toLowerCase()}|${a.label.toLowerCase()}|${a.secret.toUpperCase()}`;

  const seen = new Set(raw.map(dedupeKey));
  const merged: Account[] = [...raw];
  let added = 0;
  for (const a of incoming) {
    const k = dedupeKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({ id: uid(), ...a });
    added++;
  }

  if (key) {
    await saveEncrypted(merged);
  } else {
    await writeRawAccounts(merged);
  }
  return { added, total: merged.length };
}

export { uid };
