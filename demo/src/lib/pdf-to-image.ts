/** PDF → ImageData[] using pdfjs-dist. Port of ocr.py pdf_to_images(). */

import * as pdfjsLib from "pdfjs-dist";

// Set worker source to bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const TARGET_DPI = 300;
const PDF_DEFAULT_DPI = 72;
const SCALE = TARGET_DPI / PDF_DEFAULT_DPI;

/**
 * Detect if bytes are a PDF (magic bytes %PDF-).
 */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

/**
 * Convert PDF bytes to an array of ImageData (one per page) at 300 DPI.
 */
export async function pdfToImages(
  pdfBytes: Uint8Array,
): Promise<ImageData[]> {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const images: ImageData[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    images.push(ctx.getImageData(0, 0, viewport.width, viewport.height));
  }

  return images;
}

/**
 * Load an image file (PNG, JPG, WEBP, etc.) into ImageData.
 */
export async function imageFileToImageData(
  bytes: Uint8Array,
): Promise<ImageData[]> {
  const blob = new Blob([bytes as BlobPart]);
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);

  return [ctx.getImageData(0, 0, bitmap.width, bitmap.height)];
}

/**
 * Convert uploaded file bytes to ImageData[]. Auto-detects PDF vs image.
 */
export async function fileToImages(
  bytes: Uint8Array,
  filename: string,
): Promise<ImageData[]> {
  if (isPdf(bytes) || filename.toLowerCase().endsWith(".pdf")) {
    return pdfToImages(bytes);
  }
  return imageFileToImageData(bytes);
}
