/**
 * Pipeline orchestrator — chains all steps with progress callbacks.
 */

import type { AuthCredential } from "./auth";
import type {
  InvoiceExtraction,
  PipelineProgress,
  PipelineResult,
  RawOcrOutput,
} from "./types";
import { fileToImages } from "./pdf-to-image";
import { initOcr, runOcr } from "./ocr";
import { extractTables } from "./table-extract";
import { extractWithGemini } from "./gemini";
import { validateExtraction } from "./validation";
import { generateExcel } from "./excel-gen";

export type ProgressCallback = (progress: PipelineProgress) => void;

function formatOcrText(ocr: RawOcrOutput): string {
  return ocr.pages
    .map((p) => p.lines.map((l) => l.text).join("\n"))
    .join("\n\n--- Page break ---\n\n");
}

export async function runPipeline(
  fileBytes: Uint8Array,
  filename: string,
  credential: AuthCredential,
  onProgress: ProgressCallback,
): Promise<PipelineResult> {
  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);

  // Step 1: Convert to images
  onProgress({ step: "upload", message: "Converting document to images..." });
  const images = await fileToImages(fileBytes, filename);
  onProgress({
    step: "upload",
    message: `Converted to ${images.length} page(s)`,
    elapsed_ms: elapsed(),
  });

  // Step 2: OCR
  onProgress({ step: "ocr", message: "Loading OCR models..." });
  await initOcr();
  onProgress({ step: "ocr", message: "Running OCR..." });
  const rawOcr = await runOcr(images);
  const totalLines = rawOcr.pages.reduce((s, p) => s + p.lines.length, 0);
  onProgress({
    step: "ocr",
    message: `OCR complete: ${totalLines} lines detected`,
    elapsed_ms: elapsed(),
  });

  // Step 3: Table extraction
  onProgress({ step: "table_extract", message: "Extracting table structure..." });
  const tableExtraction = extractTables(rawOcr);
  onProgress({
    step: "table_extract",
    message: "Table extraction complete",
    elapsed_ms: elapsed(),
  });

  // Step 4: LLM extraction (with fallback models)
  onProgress({ step: "llm_extract", message: "Sending to Gemini for extraction..." });
  let extraction: InvoiceExtraction;
  try {
    extraction = await extractWithGemini(credential, rawOcr, tableExtraction, (msg) => {
      onProgress({ step: "llm_extract", message: msg });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini extraction failed: ${msg}`);
  }
  onProgress({
    step: "llm_extract",
    message: `Extracted: ${extraction.line_items.length} line items`,
    elapsed_ms: elapsed(),
  });

  // Step 5: Validation
  onProgress({ step: "validate", message: "Validating extraction..." });
  // Browser OCR doesn't report confidence — use 0.85 as reasonable default
  const validation = validateExtraction(extraction, 0.85);
  onProgress({
    step: "validate",
    message: `Confidence: ${(validation.confidence_score * 100).toFixed(0)}% — ${validation.summary}`,
    elapsed_ms: elapsed(),
  });

  // Step 6: Excel generation
  onProgress({ step: "excel", message: "Generating Excel file..." });
  const excelBlob = await generateExcel(extraction);
  onProgress({
    step: "done",
    message: "Done!",
    elapsed_ms: elapsed(),
  });

  return {
    extraction,
    validation,
    excelBlob,
    ocrText: formatOcrText(rawOcr),
  };
}
