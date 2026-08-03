// RFC 4648 Base32 decode/encode (no padding required on input).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32ToBytes(base32: string): Uint8Array {
  const cleaned = base32.replace(/[\s=]/g, "").toUpperCase();
  const lookup: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) lookup[ALPHABET[i]!] = i;

  let bits = "";
  for (const ch of cleaned) {
    const v = lookup[ch];
    if (v === undefined) continue;
    bits += v.toString(2).padStart(5, "0");
  }

  const byteCount = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]!;
  }
  return output;
}
