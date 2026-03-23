/**
 * Browser OCR using paddleocr (ONNX Runtime Web).
 * Port of services/processing/invoice_processing/ocr.py run_raw_ocr().
 *
 * onnxruntime-web is loaded via CDN <script> tag in index.html
 * to avoid Vite bundling issues with WASM workers.
 */

import type { OcrLine, OcrPage, RawOcrOutput } from "./types";
import type { OrtModule, PaddleOcrService as PaddleOcrServiceType } from "paddleocr";

// Detection: PP-OCRv5 mobile det from paddleocr.js (small, ~4MB)
// Recognition: English PP-OCRv5 from HuggingFace (7.5MB)
const DET_MODEL_URL =
  "https://raw.githubusercontent.com/X3ZvaWQ/paddleocr.js/main/assets/PP-OCRv5_mobile_det_infer.onnx";
const REC_MODEL_URL =
  "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/rec.onnx";
const DICT_URL =
  "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/dict.txt";

/**
 * Fetch a resource with Cache API caching.
 */
async function cachedFetch(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open("paddleocr-models-v5");
  const cached = await cache.match(url);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.status}`);

  cache.put(url, response.clone());
  return response.arrayBuffer();
}

let ocrService: PaddleOcrServiceType | null = null;

/**
 * Wait for ort to be available on window (loaded via CDN script in index.html).
 */
function getOrt(): Promise<OrtModule> {
  const g = window as unknown as Record<string, unknown>;
  if (g.ort) return Promise.resolve(g.ort as unknown as OrtModule);

  return new Promise((resolve) => {
    window.addEventListener("ort-ready", () => {
      resolve(g.ort as unknown as OrtModule);
    }, { once: true });
  });
}

async function createOcrService() {
  const ort = await getOrt();
  const { PaddleOcrService } = await import("paddleocr");

  const [detBuffer, recBuffer, dictText] = await Promise.all([
    cachedFetch(DET_MODEL_URL),
    cachedFetch(REC_MODEL_URL),
    cachedFetch(DICT_URL).then((buf) => new TextDecoder().decode(buf)),
  ]);

  // CTC decoder does dict[maxScoreIndex] where index 0 = blank (skipped).
  // Chinese dict has blank at [0]; English dict doesn't — prepend one.
  const rawLines = dictText.split("\n").filter((l) => l.length > 0);
  const dictLines = [" ", ...rawLines];

  return PaddleOcrService.createInstance({
    ort,
    detection: {
      modelBuffer: detBuffer,
    },
    recognition: {
      modelBuffer: recBuffer,
      charactersDictionary: dictLines,
    },
  });
}

/**
 * Initialize the OCR service (downloads models on first call, cached after).
 */
export async function initOcr(): Promise<void> {
  if (!ocrService) {
    ocrService = await createOcrService();
  }
}

/**
 * Run OCR on ImageData arrays, returning structured RawOcrOutput.
 */
export async function runOcr(images: ImageData[]): Promise<RawOcrOutput> {
  if (!ocrService) {
    await initOcr();
  }

  const pages: OcrPage[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    // Convert RGBA (ImageData) to RGB (Uint8Array) as paddleocr expects
    const rgbData = new Uint8Array(img.width * img.height * 3);
    for (let p = 0; p < img.width * img.height; p++) {
      rgbData[p * 3] = img.data[p * 4];
      rgbData[p * 3 + 1] = img.data[p * 4 + 1];
      rgbData[p * 3 + 2] = img.data[p * 4 + 2];
    }

    const results = await ocrService!.recognize({
      data: rgbData,
      width: img.width,
      height: img.height,
    });

    const lines: OcrLine[] = results.map((r) => ({
      text: r.text,
      x: Math.round(r.box.x),
      y: Math.round(r.box.y),
    }));

    // Sort by y then x (matching Python behavior)
    lines.sort((a, b) => a.y - b.y || a.x - b.x);

    pages.push({
      page_number: i + 1,
      width: img.width,
      height: img.height,
      lines,
    });
  }

  return { pages };
}
