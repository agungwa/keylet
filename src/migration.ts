// Decoder for Google Authenticator's otpauth-migration://offline?data=... format.
//
// The `data` query parameter is a url-safe base64-encoded protobuf
// `MigrationPayload` (see schema below). We hand-roll a minimal protobuf
// reader to avoid pulling in the heavy protobufjs dependency.
//
// message MigrationPayload {
//   repeated OtpParameters otp_parameters = 1;
//   optional int32 version     = 2;
//   optional int32 batch_size  = 3;
//   optional int32 batch_index = 4;
//   optional int32 batch_id    = 5;
// }
// message OtpParameters {
//   bytes secret     = 1;
//   string name      = 2;
//   string issuer    = 3;
//   Algorithm algorithm = 4;   // 1=SHA1, 2=SHA256, 3=SHA512, 4=MD5
//   DigitCount digits  = 5;    // 1=SIX(6), 2=EIGHT(8)
//   OtpType type       = 6;    // 1=HOTP, 2=TOTP
//   int64 counter      = 7;
// }

import { bytesToBase32 } from "./base32";
import type { MultiParseResult, NewAccount, OtpType, TotpAlgorithm } from "./types";

const ALGO_MAP: Record<number, TotpAlgorithm> = {
  1: "SHA1",
  2: "SHA256",
  3: "SHA512",
  4: "MD5",
};

const DIGITS_MAP: Record<number, number> = {
  1: 6,
  2: 8,
};

const textDecoder = new TextDecoder("utf-8");

interface Field {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < bytes.length) {
    const b = bytes[i]!;
    result += (b & 0x7f) * Math.pow(2, shift);
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break; // safety against malformed input
  }
  return { value: result, nextOffset: i };
}

function parseMessage(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.nextOffset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;

    if (wireType === 0) {
      const v = readVarint(bytes, offset);
      offset = v.nextOffset;
      fields.push({ fieldNumber, wireType, value: v.value });
    } else if (wireType === 2) {
      const len = readVarint(bytes, offset);
      offset = len.nextOffset;
      const slice = bytes.slice(offset, offset + len.value);
      offset += len.value;
      fields.push({ fieldNumber, wireType, value: slice });
    } else if (wireType === 5) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
      fields.push({ fieldNumber, wireType, value: view.getUint32(0, true) });
      offset += 4;
    } else if (wireType === 1) {
      offset += 8; // 64-bit — unused by this schema
    } else {
      break; // unknown wire type — stop
    }
  }
  return fields;
}

function parseOtpParameters(bytes: Uint8Array): NewAccount {
  let secret: Uint8Array | null = null;
  let name = "";
  let issuer = "";
  let algorithm = 1;
  let digits = 0;
  let type = 0;

  for (const f of parseMessage(bytes)) {
    switch (f.fieldNumber) {
      case 1:
        if (f.value instanceof Uint8Array) secret = f.value;
        break;
      case 2:
        if (f.value instanceof Uint8Array) name = textDecoder.decode(f.value);
        break;
      case 3:
        if (f.value instanceof Uint8Array) issuer = textDecoder.decode(f.value);
        break;
      case 4:
        algorithm = typeof f.value === "number" ? f.value : 1;
        break;
      case 5:
        digits = typeof f.value === "number" ? f.value : 0;
        break;
      case 6:
        type = typeof f.value === "number" ? f.value : 0;
        break;
    }
  }

  // GA sometimes embeds "Issuer:Label" in the name when issuer field is empty.
  let finalIssuer = issuer;
  let finalLabel = name;
  if (!issuer && name.includes(":")) {
    const parts = name.split(":");
    finalIssuer = parts[0]!.trim();
    finalLabel = parts.slice(1).join(":").trim();
  }

  const otpType: OtpType = type === 1 ? "hotp" : "totp";

  return {
    secret: secret ? bytesToBase32(secret) : "",
    label: finalLabel,
    issuer: finalIssuer,
    algorithm: ALGO_MAP[algorithm] ?? "SHA1",
    digits: DIGITS_MAP[digits] ?? 6,
    period: 30,
    type: otpType,
  };
}

export function decodeMigration(dataBase64: string): MultiParseResult {
  try {
    const b64 = dataBase64.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const accounts: NewAccount[] = [];
    for (const f of parseMessage(bytes)) {
      if (f.fieldNumber === 1 && f.wireType === 2 && f.value instanceof Uint8Array) {
        accounts.push(parseOtpParameters(f.value));
      }
    }
    return { ok: true, accounts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
