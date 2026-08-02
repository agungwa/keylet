// ===== State =====
let accounts = [];
let editingId = null;
let pendingImport = []; // accounts awaiting confirmation
const ticker = { handle: null };

const K = window.Keylet;

// ===== UI elements =====
const listView = document.getElementById("listView");
const formView = document.getElementById("formView");
const importView = document.getElementById("importView");
const accountListEl = document.getElementById("accountList");
const emptyState = document.getElementById("emptyState");

// ===== View switching =====
function showList() {
  formView.classList.add("hidden");
  importView.classList.add("hidden");
  listView.classList.remove("hidden");
  renderList();
}

function showForm(account = null) {
  editingId = account ? account.id : null;
  document.getElementById("formTitle").textContent = account ? "Edit account" : "Add account";
  document.getElementById("otpauthInput").value = "";
  document.getElementById("issuerInput").value = account?.issuer || "";
  document.getElementById("labelInput").value = account?.label || "";
  document.getElementById("secretInput").value = account?.secret || "";
  document.getElementById("digitsInput").value = String(account?.digits || 6);
  document.getElementById("periodInput").value = String(account?.period || 30);
  hideError();
  listView.classList.add("hidden");
  importView.classList.add("hidden");
  formView.classList.remove("hidden");
}

function showImport() {
  listView.classList.add("hidden");
  formView.classList.add("hidden");
  importView.classList.remove("hidden");
  resetImportView();
}

// ===== List rendering =====
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
      const code = await K.generateTotp(acc, now);
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
  const code = await K.generateTotp(acc, now);
  try {
    await navigator.clipboard.writeText(code);
  } catch {
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
  await K.saveAccounts(accounts);
  renderList();
  refreshCodes();
}

// ===== Add/Edit form =====
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
  const parsed = K.parseOtpauth(url);
  if (!parsed.ok) {
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
    id: editingId || K.uid(),
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
  await K.saveAccounts(accounts);
  editingId = null;
  showList();
  refreshCodes();
});

// ===== Import flow =====
const fileInput = document.getElementById("fileInput");
const importStatus = document.getElementById("importStatus");
const importNote = document.getElementById("importNote");
const importPreview = document.getElementById("importPreview");
const confirmImportBtn = document.getElementById("confirmImportBtn");

function resetImportView() {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importNote.classList.add("hidden");
  importNote.textContent = "";
  importPreview.innerHTML = "";
  confirmImportBtn.classList.add("hidden");
  pendingImport = [];
}

function showImportError(msg) {
  importStatus.textContent = msg;
  importStatus.classList.remove("hidden");
}

async function processDecodedTexts(texts) {
  const all = [];
  const errors = [];
  for (const t of texts) {
    const r = K.parseOtpUri(t);
    if (r.ok) all.push(...r.accounts);
    else errors.push(r.error);
  }
  const totp = all.filter((a) => a.type !== "hotp");
  const skippedHotp = all.length - totp.length;

  if (!totp.length) {
    showImportError(
      "No TOTP accounts found in QR." + (errors.length ? " " + errors.join("; ") : "")
    );
    return;
  }

  pendingImport = totp;
  renderImportPreview(totp, skippedHotp);
}

function renderImportPreview(accs, skippedHotp) {
  importStatus.classList.add("hidden");
  importPreview.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "preview-heading";
  heading.textContent = `Found ${accs.length} account${accs.length === 1 ? "" : "s"}`;
  importPreview.appendChild(heading);

  if (skippedHotp > 0) {
    importNote.textContent = `${skippedHotp} HOTP entr${skippedHotp === 1 ? "y" : "ies"} skipped (not supported).`;
    importNote.classList.remove("hidden");
  } else {
    importNote.classList.add("hidden");
  }

  for (const a of accs) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const issuer = document.createElement("div");
    issuer.className = "pr-issuer";
    issuer.textContent = a.issuer || "(no issuer)";
    const label = document.createElement("div");
    label.className = "pr-label";
    label.textContent = a.label;
    row.appendChild(issuer);
    row.appendChild(label);
    importPreview.appendChild(row);
  }

  confirmImportBtn.classList.remove("hidden");
  confirmImportBtn.textContent = `Import ${accs.length} account${accs.length === 1 ? "" : "s"}`;
}

document.getElementById("uploadBtn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  try {
    const texts = await K.decodeImageQrs(file);
    await processDecodedTexts(texts);
  } catch (e) {
    showImportError(e.message || String(e));
  } finally {
    fileInput.value = ""; // allow re-selecting the same file
  }
});

document.getElementById("scanBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("scan.html") });
  window.close();
});

confirmImportBtn.addEventListener("click", async () => {
  confirmImportBtn.disabled = true;
  const res = await K.addAccounts(pendingImport);
  accounts = await K.loadAccounts();
  confirmImportBtn.disabled = false;
  showList();
  refreshCodes();
  // brief feedback before returning to list (list re-renders immediately)
  console.log(`Keylet: imported ${res.added} new (${res.total} total)`);
});

// ===== Navigation =====
document.getElementById("addBtn").addEventListener("click", () => showForm());
document.getElementById("importBtn").addEventListener("click", () => showImport());
document.getElementById("emptyAddBtn").addEventListener("click", () => showForm());
document.getElementById("backBtn").addEventListener("click", () => showList());
document.getElementById("importBackBtn").addEventListener("click", () => showList());

// ===== Init =====
(async function init() {
  accounts = await K.loadAccounts();
  showList();
  await refreshCodes();
  ticker.handle = setInterval(refreshCodes, 1000);
})();
