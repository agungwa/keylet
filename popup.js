// ===== State =====
let accounts = []; // [{id, issuer, label, secret, digits, period, algorithm}]
let editingId = null;
const ticker = { handle: null };

const STORAGE_KEY = "otp_accounts";

// ===== Storage =====
async function loadAccounts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  accounts = data[STORAGE_KEY] || [];
  return accounts;
}

async function saveAccounts() {
  await chrome.storage.local.set({ [STORAGE_KEY]: accounts });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== otpauth:// parser =====
function parseOtpauth(url) {
  try {
    url = url.trim();
    if (!url.startsWith("otpauth://")) throw new Error("Must start with otpauth://");
    const u = new URL(url);
    const type = u.host.toLowerCase(); // totp / hotp
    if (type !== "totp") throw new Error('Only "totp" is supported');

    // label = pathname without leading "/"
    const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const params = u.searchParams;
    const secret = (params.get("secret") || "").replace(/\s/g, "");
    if (!secret) throw new Error("Missing secret in URL");

    const issuer = params.get("issuer") || label.split(":")[0] || "";
    const accountLabel = label.includes(":") ? label.split(":").slice(1).join(":").trim() : label;

    const digits = parseInt(params.get("digits") || "6", 10);
    const period = parseInt(params.get("period") || "30", 10);
    const algorithm = (params.get("algorithm") || "SHA1").toUpperCase().replace("-", "");

    return { issuer, label: accountLabel, secret, digits, period, algorithm };
  } catch (e) {
    return { error: e.message };
  }
}

// ===== TOTP =====
function base32ToBytes(base32) {
  const cleaned = base32.replace(/[\s=]/g, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const lookup = {};
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet[i]] = i;

  let bits = "";
  for (const ch of cleaned) {
    if (ch in lookup) bits += lookup[ch].toString(2).padStart(5, "0");
  }
  const byteCount = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) out[i] = parseInt(bits.substr(i * 8, 8), 2);
  return out;
}

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

// ===== UI rendering =====
const listView = document.getElementById("listView");
const formView = document.getElementById("formView");
const accountListEl = document.getElementById("accountList");
const emptyState = document.getElementById("emptyState");

function showList() {
  formView.classList.add("hidden");
  listView.classList.remove("hidden");
  renderList();
}

function showForm(account = null) {
  editingId = account ? account.id : null;
  document.getElementById("formTitle").textContent = account ? "Edit account" : "Add account";
  document.getElementById("otpauthInput").value = account ? "" : "";
  document.getElementById("issuerInput").value = account?.issuer || "";
  document.getElementById("labelInput").value = account?.label || "";
  document.getElementById("secretInput").value = account?.secret || "";
  document.getElementById("digitsInput").value = String(account?.digits || 6);
  document.getElementById("periodInput").value = String(account?.period || 30);
  hideError();
  listView.classList.add("hidden");
  formView.classList.remove("hidden");
}

function renderList() {
  accountListEl.innerHTML = "";
  if (accounts.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  for (const acc of accounts) {
    const row = document.createElement("div");
    row.className = "account";
    row.dataset.id = acc.id;
    row.innerHTML = `
      <div class="account-head">
        <div class="account-info">
          <div class="account-issuer"></div>
          <div class="account-label"></div>
        </div>
        <div class="account-actions">
          <button class="mini-btn edit" title="Edit">✎</button>
          <button class="mini-btn del" title="Delete">✕</button>
        </div>
      </div>
      <div class="account-code" title="Click to copy">------</div>
      <div class="account-meta">
        <div class="progress"><div class="progress-bar"></div></div>
        <div class="expires">30s</div>
        <div class="copied-toast">Copied!</div>
      </div>
    `;
    row.querySelector(".account-issuer").textContent = acc.issuer || "(no issuer)";
    row.querySelector(".account-label").textContent = acc.label || "";
    row.querySelector(".edit").addEventListener("click", () => showForm(acc));
    row.querySelector(".del").addEventListener("click", () => deleteAccount(acc.id));
    row.querySelector(".account-code").addEventListener("click", () => copyCode(acc.id));
    accountListEl.appendChild(row);
  }
}

async function refreshCodes() {
  const now = Math.floor(Date.now() / 1000);
  for (const acc of accounts) {
    const row = accountListEl.querySelector(`.account[data-id="${acc.id}"]`);
    if (!row) continue;
    try {
      const code = await generateTotp(acc, now);
      row.querySelector(".account-code").textContent = code;
    } catch {
      row.querySelector(".account-code").textContent = "ERROR";
    }
    const period = acc.period || 30;
    const remaining = period - (now % period);
    row.querySelector(".expires").textContent = remaining + "s";
    const bar = row.querySelector(".progress-bar");
    bar.style.width = (remaining / period) * 100 + "%";
    bar.style.background =
      remaining <= 5
        ? "linear-gradient(90deg, #f38ba8, #fab387)"
        : "linear-gradient(90deg, #a6e3a1, #f9e2af)";
  }
}

async function copyCode(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;
  const now = Math.floor(Date.now() / 1000);
  const code = await generateTotp(acc, now);
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const row = accountListEl.querySelector(`.account[data-id="${id}"]`);
  if (row) {
    const toast = row.querySelector(".copied-toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1200);
  }
}

async function deleteAccount(id) {
  if (!confirm("Delete this account?")) return;
  accounts = accounts.filter((a) => a.id !== id);
  await saveAccounts();
  renderList();
  refreshCodes();
}

// ===== Form handlers =====
function showError(msg) {
  const el = document.getElementById("formError");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideError() {
  document.getElementById("formError").classList.add("hidden");
}

document.getElementById("parseBtn").addEventListener("click", () => {
  const url = document.getElementById("otpauthInput").value;
  if (!url.trim()) {
    showError("Paste an otpauth:// URL first.");
    return;
  }
  const parsed = parseOtpauth(url);
  if (parsed.error) {
    showError(parsed.error);
    return;
  }
  document.getElementById("issuerInput").value = parsed.issuer;
  document.getElementById("labelInput").value = parsed.label;
  document.getElementById("secretInput").value = parsed.secret;
  document.getElementById("digitsInput").value = String(parsed.digits);
  document.getElementById("periodInput").value = String(parsed.period);
  hideError();
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  hideError();
  const issuer = document.getElementById("issuerInput").value.trim();
  const label = document.getElementById("labelInput").value.trim();
  const secret = document.getElementById("secretInput").value.trim().replace(/\s/g, "");
  const digits = parseInt(document.getElementById("digitsInput").value, 10) || 6;
  const period = parseInt(document.getElementById("periodInput").value, 10) || 30;

  if (!secret) {
    showError("Secret is required.");
    return;
  }
  if (!/^[A-Z2-7]+$/i.test(secret)) {
    showError("Secret must be valid Base32 (A–Z, 2–7).");
    return;
  }

  const account = {
    id: editingId || uid(),
    issuer,
    label,
    secret: secret.toUpperCase(),
    digits,
    period,
    algorithm: "SHA1",
  };

  if (editingId) {
    const idx = accounts.findIndex((a) => a.id === editingId);
    if (idx >= 0) accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  await saveAccounts();
  editingId = null;
  showList();
  refreshCodes();
});

document.getElementById("addBtn").addEventListener("click", () => showForm());
document.getElementById("emptyAddBtn").addEventListener("click", () => showForm());
document.getElementById("backBtn").addEventListener("click", () => showList());

// ===== Init =====
(async function init() {
  await loadAccounts();
  showList();
  await refreshCodes();
  ticker.handle = setInterval(refreshCodes, 1000);
})();
