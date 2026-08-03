// Dispatcher: any otpauth* URI (single or GA migration) → array of NewAccount.

import { decodeMigration } from "./migration";
import { parseOtpauthMulti } from "./otpauth";
import type { MultiParseResult } from "./types";

export function parseOtpUri(uri: string): MultiParseResult {
  const trimmed = uri.trim();

  if (/^otpauth-migration:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const data = u.searchParams.get("data");
      if (!data) return { ok: false, error: "Migration URL missing data parameter" };
      return decodeMigration(data);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    return parseOtpauthMulti(trimmed);
  }

  return { ok: false, error: "Not an otpauth:// or otpauth-migration:// URL" };
}
