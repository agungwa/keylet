// Shared types used across storage, parsing, and UI.

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512" | "MD5";

export type OtpType = "totp" | "hotp";

/** An account as persisted in chrome.storage.local. */
export interface Account {
  id: string;
  issuer: string;
  label: string;
  /** Base32-encoded secret (no padding, uppercase). */
  secret: string;
  digits: number;
  /** Token period in seconds (typically 30). */
  period: number;
  algorithm: TotpAlgorithm;
}

/** An account that has not yet been assigned an id (e.g. just parsed from a URI). */
export interface NewAccount {
  issuer: string;
  label: string;
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
  type: OtpType;
}

/** Minimal slice needed to compute a TOTP code. */
export type TotpInput = Pick<Account, "secret" | "period" | "digits" | "algorithm">;

/** Discriminated result for parsing a single account. */
export type ParseResult<T> =
  | { ok: true; account: T }
  | { ok: false; error: string };

/** Discriminated result for parsing one or more accounts (e.g. a migration QR). */
export type MultiParseResult =
  | { ok: true; accounts: NewAccount[] }
  | { ok: false; error: string };
