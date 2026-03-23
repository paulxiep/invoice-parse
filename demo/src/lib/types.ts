/** TypeScript port of libs/shared-py/invoice_shared/models.py */

export interface LineItem {
  section?: string;
  date?: string;
  item: string;
  quantity?: number;
  unit?: string;
  start_time?: string;
  finish_time?: string;
  hours?: number;
  total_hours?: number;
  tariff?: number;
  tariff_unit?: string;
  total: number;
}

export interface InvoiceExtraction {
  supplier_name: string;
  supplier_address?: string;
  client_name: string;
  client_address?: string;
  invoice_number: string;
  invoice_date: string;
  invoice_date_end?: string;
  invoice_date_raw: string;
  location?: string;
  total_excl_vat: number;
  vat_amount: number;
  vat_rate?: number;
  total_incl_vat: number;
  currency: string;
  line_items: LineItem[];
}

/** Generate the JSON schema for InvoiceExtraction (for Gemini structured output). */
export function invoiceExtractionJsonSchema(): object {
  return {
    type: "object",
    required: [
      "supplier_name",
      "client_name",
      "invoice_number",
      "invoice_date",
      "invoice_date_raw",
      "total_excl_vat",
      "vat_amount",
      "total_incl_vat",
      "currency",
      "line_items",
    ],
    properties: {
      supplier_name: { type: "string" },
      supplier_address: { type: "string" },
      client_name: { type: "string" },
      client_address: { type: "string" },
      invoice_number: { type: "string" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_end: { type: "string", description: "YYYY-MM-DD" },
      invoice_date_raw: { type: "string" },
      location: { type: "string" },
      total_excl_vat: { type: "number" },
      vat_amount: { type: "number" },
      vat_rate: { type: "number", description: "Percentage integer, e.g. 20" },
      total_incl_vat: { type: "number" },
      currency: { type: "string", description: "ISO 4217 code" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          required: ["item", "total"],
          properties: {
            section: { type: "string" },
            date: { type: "string" },
            item: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            start_time: { type: "string" },
            finish_time: { type: "string" },
            hours: { type: "number" },
            total_hours: { type: "number" },
            tariff: { type: "number" },
            tariff_unit: { type: "string" },
            total: { type: "number" },
          },
        },
      },
    },
  };
}

// --- OCR types ---

export interface OcrLine {
  text: string;
  x: number;
  y: number;
}

export interface OcrPage {
  page_number: number;
  width: number;
  height: number;
  lines: OcrLine[];
}

export interface RawOcrOutput {
  pages: OcrPage[];
}

// --- Table extraction types ---

export interface TableRegion {
  label: "table" | "title" | "text" | "separator";
  content: string;
  rows: string[][];
}

export interface TablePage {
  page_number: number;
  regions: TableRegion[];
}

export interface TableExtractionOutput {
  pages: TablePage[];
  method: string;
}

// --- Validation types ---

export interface ValidationCheck {
  name: string;
  passed: boolean;
  skipped: boolean;
  detail: string;
}

export interface ValidationResult {
  checks: ValidationCheck[];
  confidence_score: number;
  needs_review: boolean;
  summary: string;
}

// --- Pipeline progress ---

export type PipelineStep =
  | "upload"
  | "ocr"
  | "table_extract"
  | "llm_extract"
  | "validate"
  | "excel"
  | "done"
  | "error";

export interface PipelineProgress {
  step: PipelineStep;
  message: string;
  elapsed_ms?: number;
}

export interface PipelineResult {
  extraction: InvoiceExtraction;
  validation: ValidationResult;
  excelBlob: Blob;
  ocrText: string;
}
