// Low-level raw storage I/O. The vault layer wraps these to handle encryption.

import type { Account } from "./types";

const ACCOUNTS_KEY = "otp_accounts";

/** Read accounts exactly as stored (secrets may be encrypted "v1:..." or legacy plaintext). */
export async function readRawAccounts(): Promise<Account[]> {
  const data = await chrome.storage.local.get(ACCOUNTS_KEY);
  const raw = data[ACCOUNTS_KEY];
  return Array.isArray(raw) ? (raw as Account[]) : [];
}

/** Write accounts as-is (no transformation). */
export async function writeRawAccounts(accounts: Account[]): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
