/**
 * Main entry point — wires UI events to pipeline.
 */

// onnxruntime-web is loaded via <script> tag in index.html to avoid Vite bundling issues

import "./styles.css";
import { runPipeline } from "./lib/pipeline";
import { initOcr } from "./lib/ocr";
import {
  initOAuth,
  requestOAuthToken,
  revokeOAuth,
  setApiKey,
  getCredential,
  isAuthenticated,
} from "./lib/auth";
import type { PipelineProgress, PipelineResult, InvoiceExtraction, ValidationResult } from "./lib/types";

// Set via VITE_GOOGLE_CLIENT_ID env var at build time (or .env.local file)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

// Preload OCR models on page load
initOcr().catch(() => {});

// --- DOM references ---
const tabOAuth = document.getElementById("tab-oauth") as HTMLButtonElement;
const tabApiKey = document.getElementById("tab-apikey") as HTMLButtonElement;
const panelOAuth = document.getElementById("panel-oauth") as HTMLDivElement;
const panelApiKey = document.getElementById("panel-apikey") as HTMLDivElement;
const googleSigninBtn = document.getElementById("google-signin-btn") as HTMLButtonElement;
const userInfo = document.getElementById("user-info") as HTMLDivElement;
const userEmail = document.getElementById("user-email") as HTMLSpanElement;
const signoutLink = document.getElementById("signout-link") as HTMLAnchorElement;
const oauthError = document.getElementById("oauth-error") as HTMLDivElement;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const uploadZone = document.getElementById("upload-zone") as HTMLDivElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const uploadLabel = document.getElementById("upload-label") as HTMLDivElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const cardProgress = document.getElementById("card-progress") as HTMLDivElement;
const progressSteps = document.getElementById("progress-steps") as HTMLDivElement;
const errorMessage = document.getElementById("error-message") as HTMLDivElement;
const resultsSection = document.getElementById("results-section") as HTMLDivElement;
const downloadBtn = document.getElementById("download-btn") as HTMLAnchorElement;
const resultsGrid = document.getElementById("results-grid") as HTMLDivElement;
const lineItemsTable = document.getElementById("line-items-table") as HTMLTableElement;
const validationChecks = document.getElementById("validation-checks") as HTMLDivElement;
const confidenceScore = document.getElementById("confidence-score") as HTMLDivElement;
const ocrToggle = document.getElementById("ocr-toggle") as HTMLDivElement;
const ocrDebug = document.getElementById("ocr-debug") as HTMLDivElement;

// --- State ---
let selectedFile: File | null = null;

// --- Auth tab switching ---
function switchTab(mode: "oauth" | "apikey") {
  const isOAuth = mode === "oauth";
  tabOAuth.classList.toggle("active", isOAuth);
  tabApiKey.classList.toggle("active", !isOAuth);
  panelOAuth.classList.toggle("hidden", !isOAuth);
  panelApiKey.classList.toggle("hidden", isOAuth);
  sessionStorage.setItem("auth-tab", mode);
  updateRunBtn();
}

tabOAuth.addEventListener("click", () => switchTab("oauth"));
tabApiKey.addEventListener("click", () => switchTab("apikey"));

// Restore last-used tab
const savedTab = sessionStorage.getItem("auth-tab");
if (savedTab === "apikey") switchTab("apikey");

// --- OAuth init ---
const oauthAvailable = initOAuth(GOOGLE_CLIENT_ID, (cred) => {
  if (cred?.mode === "oauth") {
    googleSigninBtn.classList.add("hidden");
    userInfo.classList.remove("hidden");
    userEmail.textContent = "Signed in with Google";
    oauthError.classList.add("hidden");
  } else {
    googleSigninBtn.classList.remove("hidden");
    userInfo.classList.add("hidden");
  }
  updateRunBtn();
});

// If GIS didn't load, default to API key tab
if (!oauthAvailable) {
  switchTab("apikey");
  tabOAuth.disabled = true;
  tabOAuth.title = "Google Sign-in unavailable (library blocked)";
}

googleSigninBtn.addEventListener("click", () => {
  oauthError.classList.add("hidden");
  requestOAuthToken();
});

signoutLink.addEventListener("click", (e) => {
  e.preventDefault();
  revokeOAuth();
});

// --- API Key persistence (sessionStorage) ---
const storedKey = sessionStorage.getItem("gemini-api-key");
if (storedKey) apiKeyInput.value = storedKey;

apiKeyInput.addEventListener("input", () => {
  sessionStorage.setItem("gemini-api-key", apiKeyInput.value);
  setApiKey(apiKeyInput.value.trim());
  updateRunBtn();
});

// Initialise API key credential if we have a stored key and start on API key tab
if (storedKey) setApiKey(storedKey.trim());

// --- File upload ---
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file) selectFile(file);
});

fileInput.addEventListener("change", () => {
  console.log("file change event", fileInput.files);
  const file = fileInput.files?.[0];
  if (file) selectFile(file);
});
fileInput.addEventListener("input", () => {
  console.log("file input event", fileInput.files);
  const file = fileInput.files?.[0];
  if (file) selectFile(file);
});

function selectFile(file: File) {
  selectedFile = file;
  uploadZone.classList.add("has-file");
  uploadLabel.innerHTML = `<div class="filename">${file.name}</div><div style="font-size:0.8em">${(file.size / 1024).toFixed(0)} KB</div>`;
  updateRunBtn();
}

function updateRunBtn() {
  runBtn.disabled = !selectedFile || !isAuthenticated();
}

// --- Progress rendering ---

const STEP_LABELS: Record<string, string> = {
  upload: "Converting document",
  ocr: "Running OCR",
  table_extract: "Extracting tables",
  llm_extract: "Gemini extraction",
  validate: "Validating",
  excel: "Generating Excel",
  done: "Complete",
};

const STEP_ORDER = ["upload", "ocr", "table_extract", "llm_extract", "validate", "excel", "done"];

function renderProgress(progress: PipelineProgress) {
  const currentIdx = STEP_ORDER.indexOf(progress.step);

  progressSteps.innerHTML = STEP_ORDER.filter((s) => s !== "done")
    .map((step, i) => {
      const isDone = i < currentIdx || progress.step === "done";
      const isActive = step === progress.step && progress.step !== "done";
      const cls = isDone ? "done" : isActive ? "active" : "";
      const indicator = isDone
        ? "&#10003;"
        : isActive
          ? `<div class="spinner"></div>`
          : "";
      const timing =
        isDone && progress.elapsed_ms && i === currentIdx - 1
          ? `${(progress.elapsed_ms / 1000).toFixed(1)}s`
          : "";
      const message = isActive ? progress.message : STEP_LABELS[step];

      return `
        <div class="progress-step ${cls}">
          <div class="indicator">${indicator}</div>
          <span>${message}</span>
          ${timing ? `<span class="timing">${timing}</span>` : ""}
        </div>
      `;
    })
    .join("");

  if (progress.step === "done") {
    progressSteps.innerHTML += `
      <div class="progress-step done">
        <div class="indicator">&#10003;</div>
        <span>${progress.message}</span>
        <span class="timing">${((progress.elapsed_ms ?? 0) / 1000).toFixed(1)}s total</span>
      </div>
    `;
  }
}

// --- Results rendering ---

function renderResults(result: PipelineResult) {
  renderHeaderFields(result.extraction);
  renderLineItems(result.extraction);
  renderValidation(result.validation);

  // Download button
  const url = URL.createObjectURL(result.excelBlob);
  downloadBtn.href = url;
  const baseName = selectedFile?.name.replace(/\.[^.]+$/, "") ?? "invoice";
  downloadBtn.download = `${baseName}_extracted.xlsx`;

  // OCR debug
  ocrDebug.textContent = result.ocrText;

  resultsSection.classList.remove("hidden");
}

function renderHeaderFields(ext: InvoiceExtraction) {
  const fields: [string, string | undefined][] = [
    ["Supplier", ext.supplier_name],
    ["Supplier Address", ext.supplier_address],
    ["Client", ext.client_name],
    ["Client Address", ext.client_address],
    ["Invoice #", ext.invoice_number],
    ["Date", ext.invoice_date_end ? `${ext.invoice_date} to ${ext.invoice_date_end}` : ext.invoice_date],
    ["Original Date", ext.invoice_date_raw],
    ["Location", ext.location],
    ["Currency", ext.currency],
    ["Total excl. VAT", ext.total_excl_vat.toFixed(2)],
    ["VAT", ext.vat_rate != null ? `${ext.vat_amount.toFixed(2)} (${ext.vat_rate}%)` : ext.vat_amount.toFixed(2)],
    ["Total incl. VAT", ext.total_incl_vat.toFixed(2)],
  ];

  resultsGrid.innerHTML = fields
    .filter(([, v]) => v != null)
    .map(
      ([label, value]) => `
      <div>
        <div class="field-label">${label}</div>
        <div class="field-value">${value}</div>
      </div>
    `,
    )
    .join("");
}

function renderLineItems(ext: InvoiceExtraction) {
  if (ext.line_items.length === 0) {
    lineItemsTable.innerHTML = "<tr><td>No line items extracted</td></tr>";
    return;
  }

  // Determine which columns have data
  const allCols: { key: keyof (typeof ext.line_items)[0]; label: string; monetary: boolean }[] = [
    { key: "section", label: "Section", monetary: false },
    { key: "date", label: "Date", monetary: false },
    { key: "item", label: "Item", monetary: false },
    { key: "quantity", label: "Qty", monetary: false },
    { key: "unit", label: "Unit", monetary: false },
    { key: "start_time", label: "Start", monetary: false },
    { key: "finish_time", label: "Finish", monetary: false },
    { key: "hours", label: "Hours", monetary: false },
    { key: "total_hours", label: "Total Hrs", monetary: false },
    { key: "tariff", label: "Tariff", monetary: true },
    { key: "tariff_unit", label: "Tariff Unit", monetary: false },
    { key: "total", label: "Total", monetary: true },
  ];

  const usedCols = allCols.filter((col) =>
    ext.line_items.some((item) => item[col.key] != null),
  );

  const hasSections = ext.line_items.some((i) => i.section != null);

  let html = "<thead><tr>";
  for (const col of usedCols) {
    if (hasSections && col.key === "section") continue;
    html += `<th class="${col.monetary ? "monetary" : ""}">${col.label}</th>`;
  }
  html += "</tr></thead><tbody>";

  let currentSection = "";
  for (const item of ext.line_items) {
    if (hasSections && item.section && item.section !== currentSection) {
      currentSection = item.section;
      const colspan = usedCols.length - (hasSections ? 1 : 0);
      html += `<tr class="section-header"><td colspan="${colspan}">${currentSection}</td></tr>`;
    }

    html += "<tr>";
    for (const col of usedCols) {
      if (hasSections && col.key === "section") continue;
      const val = item[col.key];
      const cls = col.monetary ? "monetary" : "";
      const display =
        val == null
          ? ""
          : col.monetary && typeof val === "number"
            ? val.toFixed(2)
            : String(val);
      html += `<td class="${cls}">${display}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody>";
  lineItemsTable.innerHTML = html;
}

function renderValidation(val: ValidationResult) {
  validationChecks.innerHTML = val.checks
    .map((c) => {
      const cls = c.skipped ? "check-skip" : c.passed ? "check-pass" : "check-fail";
      const icon = c.skipped ? "&#9711;" : c.passed ? "&#10003;" : "&#10007;";
      return `<div class="check-item ${cls}">${icon} <span>${c.name}</span> <span style="color:rgb(var(--gray));font-size:0.8em">${c.detail}</span></div>`;
    })
    .join("");

  const pct = Math.round(val.confidence_score * 100);
  const cls =
    pct >= 80 ? "confidence-high" : pct >= 60 ? "confidence-medium" : "confidence-low";
  confidenceScore.className = `confidence-score ${cls}`;
  confidenceScore.textContent = `${pct}%`;
}

// --- OCR debug toggle ---
ocrToggle.addEventListener("click", () => {
  const isHidden = ocrDebug.classList.toggle("hidden");
  ocrToggle.innerHTML = `${isHidden ? "&#9654;" : "&#9660;"} Raw OCR Text`;
});

// --- Run pipeline ---
runBtn.addEventListener("click", async () => {
  const credential = getCredential();
  if (!selectedFile || !credential) return;

  // Reset UI
  runBtn.disabled = true;
  cardProgress.classList.remove("hidden");
  errorMessage.classList.add("hidden");
  resultsSection.classList.add("hidden");
  progressSteps.innerHTML = "";

  try {
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    const result = await runPipeline(
      bytes,
      selectedFile.name,
      credential,
      (progress) => renderProgress(progress),
    );
    renderResults(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMessage.textContent = msg;
    errorMessage.classList.remove("hidden");
  } finally {
    runBtn.disabled = false;
  }
});

// --- Init ---
updateRunBtn();
