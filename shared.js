// Shared logic used by both popup.js and scan.js.
// Exposes a single global: window.Keylet
window.Keylet = (function () {
  const STORAGE_KEY = "otp_accounts";

  // ===== Storage =====
  async function loadAccounts() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
  }

  async function saveAccounts(accs) {
    await chrome.storage.local.set({ [STORAGE_KEY]: accs });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Append with dedupe by (issuer|label|secret)
  async function addAccounts(newAccs) {
    const existing = await loadAccounts();
    const key = (a) =>
      `${(a.issuer || "").toLowerCase()}|${(a.label || "").toLowerCase()}|${(a.secret || "").toUpperCase()}`;
    const seen = new Set(existing.map(key));
    const merged = [...existing];
    let added = 0;
    for (const a of newAccs) {
      const k = key(a);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push({ id: uid(), ...a });
      added++;
    }
    await saveAccounts(merged);
    return { added, total: merged.length };
  }

  // ===== Base32 =====
  const B32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  function base32ToBytes(base32) {
    const cleaned = String(base32).replace(/[\s=]/g, "").toUpperCase();
    const lookup = {};
    for (let i = 0; i < B32_ALPHA.length; i++) lookup[B32_ALPHA[i]] = i;
    let bits = "";
    for (const ch of cleaned) {
      if (ch in lookup) bits += lookup[ch].toString(2).padStart(5, "0");
    }
    const out = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.substr(i, 8), 2));
    return new Uint8Array(out);
  }

  function bytesToBase32(bytes) {
    let bits = 0, value = 0, output = "";
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        output += B32_ALPHA[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += B32_ALPHA[(value << (5 - bits)) & 31];
    return output;
  }

  // ===== HMAC + TOTP =====
  async function hmac(keyBytes, messageBytes, algorithm) {
    const hashName =
      algorithm === "SHA256" ? "SHA-256" :
      algorithm === "SHA512" ? "SHA-512" : "SHA-1";
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: hashName },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, messageBytes);
    return new Uint8Array(sig);
  }

  async function generateTotp(account, timeSeconds) {
    const counter = Math.floor(timeSeconds / (account.period || 30));
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(4, counter);
    const keyBytes = base32ToBytes(account.secret);
    const hm = await hmac(keyBytes, new Uint8Array(buf), account.algorithm || "SHA1");
    const offset = hm[hm.length - 1] & 0x0f;
    const binary =
      ((hm[offset] & 0x7f) << 24) |
      ((hm[offset + 1] & 0xff) << 16) |
      ((hm[offset + 2] & 0xff) << 8) |
      (hm[offset + 3] & 0xff);
    const digits = account.digits || 6;
    return (binary % Math.pow(10, digits)).toString().padStart(digits, "0");
  }

  // ===== otpauth:// parser (single account) =====
  function parseOtpauth(url) {
    try {
      url = url.trim();
      if (!/^otpauth:\/\/totp\//i.test(url)) throw new Error("Only otpauth://totp/ is supported");
      const u = new URL(url);
      const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
      const params = u.searchParams;
      const secret = (params.get("secret") || "").replace(/\s/g, "");
      if (!secret) throw new Error("Missing secret");
      const issuer = params.get("issuer") || label.split(":")[0] || "";
      const accountLabel = label.includes(":")
        ? label.split(":").slice(1).join(":").trim()
        : label;
      const digits = parseInt(params.get("digits") || "6", 10) || 6;
      const period = parseInt(params.get("period") || "30", 10) || 30;
      const algorithm = (params.get("algorithm") || "SHA1").toUpperCase().replace("-", "");
      return {
        ok: true,
        issuer,
        label: accountLabel,
        secret: secret.toUpperCase(),
        digits,
        period,
        algorithm,
        type: "totp",
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Minimal protobuf decoder (for GA migration payload) =====
  function readVarint(bytes, offset) {
    let result = 0, shift = 0;
    while (offset < bytes.length) {
      const b = bytes[offset++];
      result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) break;
    }
    return { value: result, nextOffset: offset };
  }

  function parseMessage(bytes) {
    const fields = [];
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
        fields.push({ fieldNumber, wireType, value: bytes.slice(offset, offset + len.value) });
        offset += len.value;
      } else if (wireType === 5) {
        fields.push({
          fieldNumber,
          wireType,
          value: new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true),
        });
        offset += 4;
      } else if (wireType === 1) {
        offset += 8;
      } else {
        break;
      }
    }
    return fields;
  }

  const ALGO_MAP = { 1: "SHA1", 2: "SHA256", 3: "SHA512", 4: "MD5" };
  const DIGITS_MAP = { 1: 6, 2: 8 };
  const textDecoder = new TextDecoder("utf-8");

  function parseOtpParameters(bytes) {
    const fields = parseMessage(bytes);
    let secret = null, name = "", issuer = "", algorithm = 1, digits = 0, type = 0;
    for (const f of fields) {
      if (f.fieldNumber === 1) secret = f.value;
      else if (f.fieldNumber === 2) name = textDecoder.decode(f.value);
      else if (f.fieldNumber === 3) issuer = textDecoder.decode(f.value);
      else if (f.fieldNumber === 4) algorithm = f.value;
      else if (f.fieldNumber === 5) digits = f.value;
      else if (f.fieldNumber === 6) type = f.value;
    }
    let finalIssuer = issuer, finalLabel = name;
    if (!issuer && name.includes(":")) {
      const parts = name.split(":");
      finalIssuer = parts[0].trim();
      finalLabel = parts.slice(1).join(":").trim();
    }
    return {
      secret: secret ? bytesToBase32(secret) : "",
      label: finalLabel,
      issuer: finalIssuer,
      algorithm: ALGO_MAP[algorithm] || "SHA1",
      digits: DIGITS_MAP[digits] || 6,
      period: 30,
      type: type === 1 ? "hotp" : "totp",
    };
  }

  function decodeMigration(dataBase64) {
    try {
      const b64 = dataBase64.replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const fields = parseMessage(bytes);
      const accounts = [];
      for (const f of fields) {
        if (f.fieldNumber === 1 && f.wireType === 2) accounts.push(parseOtpParameters(f.value));
      }
      return { ok: true, accounts };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ===== Dispatcher: any otpauth* URI → array of accounts =====
  function parseOtpUri(uri) {
    uri = uri.trim();
    if (/^otpauth-migration:\/\//i.test(uri)) {
      try {
        const u = new URL(uri);
        const data = u.searchParams.get("data");
        if (!data) return { ok: false, error: "Migration URL missing data parameter" };
        return decodeMigration(data);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    if (/^otpauth:\/\//i.test(uri)) {
      const r = parseOtpauth(uri);
      if (!r.ok) return r;
      const acc = {
        secret: r.secret,
        label: r.label,
        issuer: r.issuer,
        algorithm: r.algorithm,
        digits: r.digits,
        period: r.period,
        type: r.type,
      };
      return { ok: true, accounts: [acc] };
    }
    return { ok: false, error: "Not an otpauth:// or otpauth-migration:// URL" };
  }

  // ===== Image QR decode (BarcodeDetector) =====
  async function decodeImageQrs(file) {
    if (!("BarcodeDetector" in window)) {
      throw new Error("BarcodeDetector not supported. Update Chrome.");
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const bitmap = await createImageBitmap(file);
    try {
      const codes = await detector.detect(bitmap);
      if (!codes.length) throw new Error("No QR code found in image");
      return codes.map((c) => c.rawValue);
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }

  return {
    STORAGE_KEY,
    loadAccounts,
    saveAccounts,
    addAccounts,
    uid,
    base32ToBytes,
    bytesToBase32,
    generateTotp,
    parseOtpauth,
    parseOtpUri,
    decodeMigration,
    decodeImageQrs,
  };
})();
