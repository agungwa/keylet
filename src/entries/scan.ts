// Camera-scan entry point: opens in a tab, scans frames via BarcodeDetector,
// previews found accounts, and saves them on confirm.

import { addAccounts } from "../storage";
import { parseOtpUri } from "../otp-uri";
import { requireEl } from "../dom";
import type { NewAccount } from "../types";

const video = requireEl<HTMLVideoElement>("video");
const statusEl = requireEl("scanStatus");
const previewEl = requireEl<HTMLDivElement>("preview");
const noteEl = requireEl("scanNote");
const confirmBtn = requireEl<HTMLButtonElement>("confirmBtn");
const rescanBtn = requireEl<HTMLButtonElement>("rescanBtn");
const cancelBtn = requireEl<HTMLButtonElement>("cancelBtn");

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface DetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

interface BarcodeDetectorWindow {
  BarcodeDetector?: DetectorCtor;
}

let stream: MediaStream | null = null;
let detector: BarcodeDetectorLike | null = null;
let scanning = false;
let pendingAccounts: NewAccount[] = [];

function setStatus(msg: string, kind?: "success"): void {
  statusEl.textContent = msg;
  statusEl.classList.remove("success");
  if (kind) statusEl.classList.add(kind);
}

async function startCamera(): Promise<void> {
  const w = window as unknown as BarcodeDetectorWindow;
  const Ctor = w.BarcodeDetector;
  if (!Ctor) {
    setStatus("BarcodeDetector not supported. Update Chrome to a recent version.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API not available.");
    return;
  }

  detector = new Ctor({ formats: ["qr_code"] });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setStatus("Point camera at the QR code…");
    scanning = true;
    requestAnimationFrame(scanLoop);
  } catch (e) {
    setStatus("Camera error: " + (e instanceof Error ? e.message : String(e)));
  }
}

function stopCamera(): void {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function scanLoop(): Promise<void> {
  if (!scanning || !detector) return;
  try {
    const codes = await detector.detect(video);
    if (codes.length) {
      await handleDecoded(codes.map((c) => c.rawValue));
      return;
    }
  } catch {
    // transient per-frame error — keep going
  }
  requestAnimationFrame(() => void scanLoop());
}

async function handleDecoded(texts: string[]): Promise<void> {
  stopCamera();
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
    setStatus(
      "No TOTP accounts found in QR." + (errors.length ? " " + errors.join("; ") : ""),
    );
    return;
  }

  pendingAccounts = totp;
  renderPreview(totp, skippedHotp);
}

function renderPreview(accs: NewAccount[], skippedHotp: number): void {
  setStatus(`Found ${accs.length} account${accs.length === 1 ? "" : "s"}`, "success");
  previewEl.innerHTML = "";

  if (skippedHotp > 0) {
    noteEl.textContent = `${skippedHotp} HOTP entr${skippedHotp === 1 ? "y" : "ies"} skipped (not supported).`;
    noteEl.classList.remove("hidden");
  } else {
    noteEl.classList.add("hidden");
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
    previewEl.appendChild(row);
  }
  previewEl.classList.remove("hidden");

  confirmBtn.classList.remove("hidden");
  confirmBtn.textContent = `Import ${accs.length} account${accs.length === 1 ? "" : "s"}`;
  rescanBtn.classList.remove("hidden");
}

function setupHandlers(): void {
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    const res = await addAccounts(pendingAccounts);
    setStatus(
      `Imported ${res.added} new account${res.added === 1 ? "" : "s"} (${res.total} total).`,
      "success",
    );
    confirmBtn.classList.add("hidden");
    previewEl.classList.add("hidden");
    rescanBtn.classList.remove("hidden");
    rescanBtn.textContent = "Done";
    rescanBtn.onclick = (): void => window.close();
    setTimeout(() => window.close(), 1800);
  });

  rescanBtn.addEventListener("click", () => {
    previewEl.classList.add("hidden");
    confirmBtn.classList.add("hidden");
    rescanBtn.classList.add("hidden");
    noteEl.classList.add("hidden");
    pendingAccounts = [];
    void startCamera();
  });

  cancelBtn.addEventListener("click", () => {
    stopCamera();
    window.close();
  });

  window.addEventListener("beforeunload", stopCamera);
}

// ===== Init =====
setupHandlers();
void startCamera();
