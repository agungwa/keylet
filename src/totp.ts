// TOTP (RFC 6238) implementation backed by Web Crypto HMAC.

import { base32ToBytes } from "./base32";
import type { TotpAlgorithm, TotpInput } from "./types";

function hashNameFor(algorithm: TotpAlgorithm): "SHA-1" | "SHA-256" | "SHA-512" {
  switch (algorithm) {
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    case "SHA1":
    case "MD5":
    default:
      // Web Crypto has no MD5 HMAC — fall back to SHA-1, the TOTP default.
      return "SHA-1";
  }
}

/**
 * Copy a Uint8Array into a fresh ArrayBuffer. Web Crypto's BufferSource rejects
 * the SharedArrayBuffer side of TS 5.7's `Uint8Array<ArrayBufferLike>`,
 * so we hand it a concrete ArrayBuffer.
 */
function toArrayBuffer(src: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(src.byteLength);
  new Uint8Array(out).set(src);
  return out;
}

async function hmac(
  keyBytes: Uint8Array,
  messageBytes: Uint8Array,
  algorithm: TotpAlgorithm,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: hashNameFor(algorithm) },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(messageBytes));
  return new Uint8Array(sig);
}

export async function generateTotp(account: TotpInput, timeSeconds: number): Promise<string> {
  const period = account.period || 30;
  const counter = Math.floor(timeSeconds / period);

  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, counter >>> 0);

  const keyBytes = base32ToBytes(account.secret);
  const hm = await hmac(keyBytes, new Uint8Array(buf), account.algorithm || "SHA1");

  const offset = hm[hm.length - 1]! & 0x0f;
  const binary =
    ((hm[offset]! & 0x7f) << 24) |
    ((hm[offset + 1]! & 0xff) << 16) |
    ((hm[offset + 2]! & 0xff) << 8) |
    (hm[offset + 3]! & 0xff);

  const digits = account.digits || 6;
  const token = binary % Math.pow(10, digits);
  return token.toString().padStart(digits, "0");
}
