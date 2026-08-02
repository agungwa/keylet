const K = window.Keylet;

const video = document.getElementById("video");
const statusEl = document.getElementById("scanStatus");
const previewEl = document.getElementById("preview");
const noteEl = document.getElementById("scanNote");
const confirmBtn = document.getElementById("confirmBtn");
const rescanBtn = document.getElementById("rescanBtn");
const cancelBtn = document.getElementById("cancelBtn");

let stream = null;
let detector = null;
let scanning = false;
let pendingAccounts = [];

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.classList.remove("success");
  if (kind) statusEl.classList.add(kind);
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) {
    setStatus("BarcodeDetector not supported. Update Chrome to a recent version.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Camera API not available.");
    return;
  }
  detector = new BarcodeDetector({ formats: ["qr_code"] });
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
    setStatus("Camera error: " + (e.message || e.name));
  }
}

function stopCamera() {
  scanning = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function scanLoop() {
  if (!scanning) return;
  try {
    const codes = await detector.detect(video);
    if (codes && codes.length) {
      await handleDecoded(codes.map((c) => c.rawValue));
      return;
    }
  } catch {
    // transient per-frame error — keep going
  }
  requestAnimationFrame(scanLoop);
}

async function handleDecoded(texts) {
  stopCamera();
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
    setStatus(
      "No TOTP accounts found in QR." + (errors.length ? " " + errors.join("; ") : "")
    );
    return;
  }

  pendingAccounts = totp;
  renderPreview(totp, skippedHotp);
}

function renderPreview(accs, skippedHotp) {
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
    row.appendChild(issuer);
    row.appendChild(label);
    previewEl.appendChild(row);
  }
  previewEl.classList.remove("hidden");

  confirmBtn.classList.remove("hidden");
  confirmBtn.textContent = `Import ${accs.length} account${accs.length === 1 ? "" : "s"}`;
  rescanBtn.classList.remove("hidden");
}

confirmBtn.addEventListener("click", async () => {
  confirmBtn.disabled = true;
  const res = await K.addAccounts(pendingAccounts);
  setStatus(`Imported ${res.added} new account${res.added === 1 ? "" : "s"} (${res.total} total).`, "success");
  confirmBtn.classList.add("hidden");
  previewEl.classList.add("hidden");
  rescanBtn.classList.remove("hidden");
  rescanBtn.textContent = "Done";
  rescanBtn.onclick = () => window.close();
  // also auto-close after a beat
  setTimeout(() => window.close(), 1800);
});

rescanBtn.addEventListener("click", () => {
  previewEl.classList.add("hidden");
  confirmBtn.classList.add("hidden");
  rescanBtn.classList.add("hidden");
  noteEl.classList.add("hidden");
  pendingAccounts = [];
  startCamera();
});

cancelBtn.addEventListener("click", () => {
  stopCamera();
  window.close();
});

window.addEventListener("beforeunload", stopCamera);

startCamera();
