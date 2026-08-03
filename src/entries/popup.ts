// Popup entry point: vault-gated list + add/edit form + import-from-QR view.

import * as vault from "../vault";
import { generateTotp } from "../totp";
import { parseOtpauth } from "../otpauth";
import { parseOtpUri } from "../otp-uri";
import { decodeImageQrs } from "../qr";
import { requireEl } from "../dom";
import type { Account, NewAccount } from "../types";

// ===== State =====
let accounts: Account[] = [];
let editingId: string | null = null;
let pendingImport: NewAccount[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;
type LockMode = "setup" | "unlock";
let lockMode: LockMode = "unlock";

// ===== View elements =====
const lockView = requireEl("lockView");
const listView = requireEl("listView");
const formView = requireEl("formView");
const importView = requireEl("importView");
const settingsView = requireEl("settingsView");
const accountListEl = requireEl<HTMLDivElement>("accountList");
const emptyState = requireEl<HTMLDivElement>("emptyState");

// Lock-view elements
const lockIcon = requireEl("lockIcon");
const lockTitle = requireEl<HTMLHeadingElement>("lockTitle");
const lockSubtitle = requireEl("lockSubtitle");
const lockPassword = requireEl<HTMLInputElement>("lockPassword");
const lockPasswordConfirm = requireEl<HTMLInputElement>("lockPasswordConfirm");
const lockError = requireEl("lockError");
const lockSubmitBtn = requireEl<HTMLButtonElement>("lockSubmitBtn");
const lockResetBtn = requireEl<HTMLButtonElement>("lockResetBtn");

// ===== App view switching =====
function hideAllAppViews(): void {
  listView.classList.add("hidden");
  formView.classList.add("hidden");
  importView.classList.add("hidden");
  settingsView.classList.add("hidden");
}

function showLock(): void {
  hideAllAppViews();
  stopTicker();
  lockView.classList.remove("hidden");
  lockPassword.value = "";
  lockPasswordConfirm.value = "";
  hideLockError();
  lockPassword.focus();
}

function showLockForSetup(migratingCount: number): void {
  lockMode = "setup";
  lockIcon.textContent = "🔐";
  lockTitle.textContent = "Set a master password";
  lockSubtitle.textContent =
    migratingCount > 0
      ? `This encrypts your ${migratingCount} existing account${migratingCount === 1 ? "" : "s"}. There is no recovery — remember it.`
      : "Your secrets will be encrypted on disk. There is no recovery — remember it.";
  lockPasswordConfirm.classList.remove("hidden");
  lockPassword.placeholder = "Master password";
  lockSubmitBtn.textContent = "Set password";
  lockResetBtn.classList.add("hidden");
  showLock();
}

function showLockForUnlock(): void {
  lockMode = "unlock";
  lockIcon.textContent = "🔒";
  lockTitle.textContent = "Unlock Keylet";
  lockSubtitle.textContent = "Enter your master password";
  lockPasswordConfirm.classList.add("hidden");
  lockPassword.placeholder = "Master password";
  lockSubmitBtn.textContent = "Unlock";
  lockResetBtn.classList.remove("hidden");
  showLock();
}

function showApp(): void {
  lockView.classList.add("hidden");
  listView.classList.remove("hidden");
}

function showList(): void {
  formView.classList.add("hidden");
  importView.classList.add("hidden");
  listView.classList.remove("hidden");
  renderList();
}

function showForm(account?: Account): void {
  editingId = account?.id ?? null;
  document.getElementById("formTitle")!.textContent = account ? "Edit account" : "Add account";

  const set = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    id: string,
    value: string,
  ): void => {
    (document.getElementById(id) as T).value = value;
  };

  set<HTMLTextAreaElement>("otpauthInput", "");
  set<HTMLInputElement>("issuerInput", account?.issuer ?? "");
  set<HTMLInputElement>("labelInput", account?.label ?? "");
  set<HTMLInputElement>("secretInput", account?.secret ?? "");
  set<HTMLSelectElement>("digitsInput", String(account?.digits ?? 6));
  set<HTMLInputElement>("periodInput", String(account?.period ?? 30));

  hideError();
  listView.classList.add("hidden");
  importView.classList.add("hidden");
  formView.classList.remove("hidden");
}

function showImport(): void {
  listView.classList.add("hidden");
  formView.classList.add("hidden");
  importView.classList.remove("hidden");
  resetImportView();
}

function showSettings(): void {
  listView.classList.add("hidden");
  formView.classList.add("hidden");
  importView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  requireEl("changePwMsg").classList.add("hidden");
}

// ===== Ticker =====
function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => void refreshCodes(), 1000);
}
function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

// ===== List rendering =====
function renderList(): void {
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
    row.querySelector(".account-issuer")!.textContent = acc.issuer || "(no issuer)";
    row.querySelector(".account-label")!.textContent = acc.label;
    row.querySelector(".edit")!.addEventListener("click", () => showForm(acc));
    row.querySelector(".del")!.addEventListener("click", () => deleteAccount(acc.id));
    row.querySelector(".account-code")!.addEventListener("click", () => copyCode(acc.id));
    accountListEl.appendChild(row);
  }
}

async function refreshCodes(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const acc of accounts) {
    const row = accountListEl.querySelector<HTMLElement>(`.account[data-id="${acc.id}"]`);
    if (!row) continue;
    const codeEl = row.querySelector<HTMLElement>(".account-code")!;
    try {
      codeEl.textContent = await generateTotp(acc, now);
    } catch {
      codeEl.textContent = "ERROR";
    }
    const period = acc.period || 30;
    const remaining = period - (now % period);
    row.querySelector(".expires")!.textContent = remaining + "s";
    const bar = row.querySelector<HTMLElement>(".progress-bar")!;
    bar.style.width = (remaining / period) * 100 + "%";
    bar.style.background =
      remaining <= 5
        ? "linear-gradient(90deg, #f38ba8, #fab387)"
        : "linear-gradient(90deg, #a6e3a1, #f9e2af)";
  }
}

async function copyCode(id: string): Promise<void> {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;
  const now = Math.floor(Date.now() / 1000);
  const code = await generateTotp(acc, now);
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
  const row = accountListEl.querySelector<HTMLElement>(`.account[data-id="${id}"]`);
  if (row) {
    const toast = row.querySelector<HTMLElement>(".copied-toast")!;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1200);
  }
}

async function deleteAccount(id: string): Promise<void> {
  if (!confirm("Delete this account?")) return;
  accounts = accounts.filter((a) => a.id !== id);
  await vault.saveEncrypted(accounts);
  renderList();
  void refreshCodes();
}

// ===== Add/Edit form =====
function showError(msg: string): void {
  const e = requireEl("formError");
  e.textContent = msg;
  e.classList.remove("hidden");
}
function hideError(): void {
  requireEl("formError").classList.add("hidden");
}

function hideLockError(): void {
  lockError.classList.add("hidden");
  lockError.textContent = "";
}
function showLockError(msg: string): void {
  lockError.textContent = msg;
  lockError.classList.remove("hidden");
}

function setupFormHandlers(): void {
  requireEl<HTMLButtonElement>("parseBtn").addEventListener("click", () => {
    const url = requireEl<HTMLTextAreaElement>("otpauthInput").value;
    if (!url.trim()) {
      showError("Paste an otpauth:// URL first.");
      return;
    }
    const parsed = parseOtpauth(url);
    if (!parsed.ok) {
      showError(parsed.error);
      return;
    }
    const a = parsed.account;
    requireEl<HTMLInputElement>("issuerInput").value = a.issuer;
    requireEl<HTMLInputElement>("labelInput").value = a.label;
    requireEl<HTMLInputElement>("secretInput").value = a.secret;
    requireEl<HTMLSelectElement>("digitsInput").value = String(a.digits);
    requireEl<HTMLInputElement>("periodInput").value = String(a.period);
    hideError();
  });

  requireEl<HTMLButtonElement>("saveBtn").addEventListener("click", async () => {
    hideError();
    const issuer = requireEl<HTMLInputElement>("issuerInput").value.trim();
    const label = requireEl<HTMLInputElement>("labelInput").value.trim();
    const secret = requireEl<HTMLInputElement>("secretInput").value.trim().replace(/\s/g, "");
    const digits = parseInt(requireEl<HTMLSelectElement>("digitsInput").value, 10) || 6;
    const period = parseInt(requireEl<HTMLInputElement>("periodInput").value, 10) || 30;

    if (!secret) {
      showError("Secret is required.");
      return;
    }
    if (!/^[A-Z2-7]+$/i.test(secret)) {
      showError("Secret must be valid Base32 (A–Z, 2–7).");
      return;
    }

    const account: Account = {
      id: editingId ?? vault.uid(),
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
    await vault.saveEncrypted(accounts);
    editingId = null;
    showList();
    void refreshCodes();
  });
}

// ===== Import flow =====
const fileInput = requireEl<HTMLInputElement>("fileInput");
const importStatus = requireEl("importStatus");
const importNote = requireEl("importNote");
const importPreview = requireEl<HTMLDivElement>("importPreview");
const confirmImportBtn = requireEl<HTMLButtonElement>("confirmImportBtn");

function resetImportView(): void {
  importStatus.classList.add("hidden");
  importStatus.textContent = "";
  importNote.classList.add("hidden");
  importNote.textContent = "";
  importPreview.innerHTML = "";
  confirmImportBtn.classList.add("hidden");
  pendingImport = [];
}

function showImportError(msg: string): void {
  importStatus.textContent = msg;
  importStatus.classList.remove("hidden");
}

async function processDecodedTexts(texts: string[]): Promise<void> {
  const all: NewAccount[] = [];
  const errors: string[] = [];
  for (const t of texts) {
    const r = parseOtpUri(t);
    if (r.ok) all.push(...r.accounts);
    else errors.push(r.error);
  }
  const totp = all.filter((a) => a.type !== "hotp");
  const skippedHotp = all.length - totp.length;

  if (!totp.length) {
    showImportError(
      "No TOTP accounts found in QR." + (errors.length ? " " + errors.join("; ") : ""),
    );
    return;
  }

  pendingImport = totp;
  renderImportPreview(totp, skippedHotp);
}

function renderImportPreview(accs: NewAccount[], skippedHotp: number): void {
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

    row.append(issuer, label);
    importPreview.appendChild(row);
  }

  confirmImportBtn.classList.remove("hidden");
  confirmImportBtn.textContent = `Import ${accs.length} account${accs.length === 1 ? "" : "s"}`;
}

function setupImportHandlers(): void {
  requireEl<HTMLButtonElement>("uploadBtn").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const texts = await decodeImageQrs(file);
      await processDecodedTexts(texts);
    } catch (e) {
      showImportError(e instanceof Error ? e.message : String(e));
    } finally {
      fileInput.value = ""; // allow re-selecting the same file
    }
  });

  requireEl<HTMLButtonElement>("scanBtn").addEventListener("click", () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("scan.html") });
    window.close();
  });

  confirmImportBtn.addEventListener("click", async () => {
    confirmImportBtn.disabled = true;
    await vault.addAccounts(pendingImport);
    accounts = await vault.loadDecrypted();
    confirmImportBtn.disabled = false;
    showList();
    void refreshCodes();
  });
}

// ===== Vault (lock/setup/change-pw/reset) handlers =====
function setupVaultHandlers(): void {
  lockSubmitBtn.addEventListener("click", async () => {
    hideLockError();
    const pw = lockPassword.value;
    if (!pw) {
      showLockError("Enter a password.");
      return;
    }
    if (lockMode === "setup") {
      if (pw.length < 4) {
        showLockError("Password must be at least 4 characters.");
        return;
      }
      if (pw !== lockPasswordConfirm.value) {
        showLockError("Passwords don't match.");
        return;
      }
      try {
        await vault.setup(pw);
      } catch (e) {
        showLockError(e instanceof Error ? e.message : String(e));
        return;
      }
      await enterApp();
    } else {
      let ok: boolean;
      try {
        ok = await vault.unlock(pw);
      } catch (e) {
        showLockError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!ok) {
        showLockError("Wrong password.");
        lockPassword.value = "";
        lockPassword.focus();
        return;
      }
      await enterApp();
    }
  });

  lockPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lockSubmitBtn.click();
  });
  lockPasswordConfirm.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lockSubmitBtn.click();
  });

  lockResetBtn.addEventListener("click", () => void triggerWipe());

  // Lock-now button in topbar
  requireEl<HTMLButtonElement>("lockBtn").addEventListener("click", () => void triggerLock());

  // Settings handlers
  requireEl<HTMLButtonElement>("settingsBtn").addEventListener("click", () => showSettings());
  requireEl<HTMLButtonElement>("settingsBackBtn").addEventListener("click", () => showList());
  requireEl<HTMLButtonElement>("settingsLockBtn").addEventListener("click", () => void triggerLock());
  requireEl<HTMLButtonElement>("settingsWipeBtn").addEventListener("click", () => void triggerWipe());

  // Change password (in settings view)
  requireEl<HTMLButtonElement>("changePwBtn").addEventListener("click", async () => {
    const oldPw = requireEl<HTMLInputElement>("changeOldPw").value;
    const newPw = requireEl<HTMLInputElement>("changeNewPw").value;
    const msgEl = requireEl("changePwMsg");
    if (!oldPw || !newPw) {
      msgEl.textContent = "Fill in both fields.";
      msgEl.classList.remove("hidden");
      return;
    }
    if (newPw.length < 4) {
      msgEl.textContent = "New password must be at least 4 characters.";
      msgEl.classList.remove("hidden");
      return;
    }
    const ok = await vault.changePassword(oldPw, newPw);
    if (!ok) {
      msgEl.textContent = "Current password is incorrect.";
      msgEl.classList.remove("hidden");
      return;
    }
    msgEl.textContent = "Password updated.";
    msgEl.classList.remove("hidden");
    requireEl<HTMLInputElement>("changeOldPw").value = "";
    requireEl<HTMLInputElement>("changeNewPw").value = "";
  });
}

async function triggerLock(): Promise<void> {
  await vault.lockNow();
  accounts = [];
  stopTicker();
  showLockForUnlock();
}

async function triggerWipe(): Promise<void> {
  if (!confirm("This permanently deletes ALL accounts and the master password. Continue?")) {
    return;
  }
  if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
  await vault.wipe();
  accounts = [];
  stopTicker();
  showLockForSetup(0);
}

// ===== Navigation =====
function setupNavHandlers(): void {
  requireEl<HTMLButtonElement>("addBtn").addEventListener("click", () => showForm());
  requireEl<HTMLButtonElement>("importBtn").addEventListener("click", () => showImport());
  requireEl<HTMLButtonElement>("emptyAddBtn").addEventListener("click", () => showForm());
  requireEl<HTMLButtonElement>("backBtn").addEventListener("click", () => showList());
  requireEl<HTMLButtonElement>("importBackBtn").addEventListener("click", () => showList());
}

// ===== Boot =====
async function enterApp(): Promise<void> {
  accounts = await vault.loadDecrypted();
  showApp();
  showList();
  await refreshCodes();
  startTicker();
}

(async function init(): Promise<void> {
  setupFormHandlers();
  setupImportHandlers();
  setupVaultHandlers();
  setupNavHandlers();

  if (!(await vault.isConfigured())) {
    const migrating = await vault.countPlaintextAccounts();
    showLockForSetup(migrating);
    return;
  }
  if (!(await vault.isUnlocked())) {
    showLockForUnlock();
    return;
  }
  await enterApp();
})();
