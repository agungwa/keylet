// Parser for single-account otpauth:// URIs (RFC 6287 / Google Auth style).

import type { MultiParseResult, NewAccount, ParseResult } from "./types";

/** Parse a single otpauth://totp/... URI into one new account. */
export function parseOtpauth(url: string): ParseResult<NewAccount> {
  try {
    const trimmed = url.trim();
    if (!/^otpauth:\/\/totp\//i.test(trimmed)) {
      throw new Error('Only otpauth://totp/ URIs are supported');
    }

    const u = new URL(trimmed);
    const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const params = u.searchParams;

    const secret = (params.get("secret") ?? "").replace(/\s/g, "");
    if (!secret) throw new Error("Missing secret");

    const issuer = params.get("issuer") ?? label.split(":")[0] ?? "";
    const accountLabel = label.includes(":")
      ? label.split(":").slice(1).join(":").trim()
      : label;

    const digits = parseInt(params.get("digits") ?? "6", 10) || 6;
    const period = parseInt(params.get("period") ?? "30", 10) || 30;
    const algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");

    return {
      ok: true,
      account: {
        issuer,
        label: accountLabel,
        secret: secret.toUpperCase(),
        digits,
        period,
        algorithm: algorithm as NewAccount["algorithm"],
        type: "totp",
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Convenience wrapper returning a multi-result for a single otpauth:// URI. */
export function parseOtpauthMulti(url: string): MultiParseResult {
  const r = parseOtpauth(url);
  if (!r.ok) return r;
  return { ok: true, accounts: [r.account] };
}
