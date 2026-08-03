// Persistence layer for Keylet accounts.
// Storage shape is intentionally unchanged from the original JS version
// so existing user data continues to load.

import type { Account, NewAccount } from "./types";

const STORAGE_KEY = "otp_accounts";

export async function loadAccounts(): Promise<Account[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY];
  return Array.isArray(raw) ? (raw as Account[]) : [];
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Append new accounts, deduping by lowercased issuer|label|uppercase secret. */
export async function addAccounts(
  incoming: NewAccount[],
): Promise<{ added: number; total: number }> {
  const existing = await loadAccounts();
  const key = (a: { issuer: string; label: string; secret: string }): string =>
    `${a.issuer.toLowerCase()}|${a.label.toLowerCase()}|${a.secret.toUpperCase()}`;

  const seen = new Set(existing.map(key));
  const merged: Account[] = [...existing];
  let added = 0;

  for (const a of incoming) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({ id: uid(), ...a });
    added++;
  }

  await saveAccounts(merged);
  return { added, total: merged.length };
}
