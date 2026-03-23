/**
 * LLM prompt construction.
 * Port of services/processing/invoice_processing/extraction.py
 */

import type { RawOcrOutput, TableExtractionOutput } from "./types";
import { invoiceExtractionJsonSchema } from "./types";
import { tableExtractionToPromptText } from "./table-extract";

export const SYSTEM_PROMPT = `\
You are an invoice data extraction assistant. Extract structured data from the \
OCR output of an invoice. You may receive two views of the same document:

1. STRUCTURED TABLES: Tables detected by layout analysis, with pipe-delimited \
columns. These have reliable column structure but may miss some page regions.
2. RAW OCR TEXT: All text on the page with tab-separated items on the same row. \
This captures everything but has less structure.

Use both views together for best accuracy. Follow these rules exactly:

- Number formats: European invoices use comma as decimal separator and \
space/period as thousands separator (e.g., "2 305,00" means 2305.00). \
Parse numbers according to the currency context.
- Subtotals: Do NOT include subtotal, summary, or "in total" rows as line items. \
Only extract individual transaction/charge rows.
- Sections: Invoices may have multiple sections (e.g., Job/Labor, Miscellaneous, \
Materials). Preserve section names in the \`section\` field.
- Dates: Convert all dates to YYYY-MM-DD format. If the invoice shows a date range, \
use the first date as \`invoice_date\` and the second as \`invoice_date_end\`. \
Preserve original text in \`invoice_date_raw\`.
- Currency: Extract currency as a 3-letter ISO 4217 code (e.g., CZK, EUR, USD).
- VAT rate: Express as a percentage integer (e.g., 20 for 20%), not a decimal.`;

function formatRawOcrForPrompt(rawOcr: RawOcrOutput): string {
  const parts: string[] = [];
  for (const page of rawOcr.pages) {
    if (rawOcr.pages.length > 1) {
      parts.push(`--- Page ${page.page_number} ---`);
    }
    for (const line of page.lines) {
      parts.push(line.text);
    }
  }
  return parts.join("\n");
}

export function buildExtractionPrompt(
  rawOcr?: RawOcrOutput,
  tableExtraction?: TableExtractionOutput,
): string {
  if (!rawOcr && !tableExtraction) {
    throw new Error(
      "At least one of rawOcr or tableExtraction must be provided",
    );
  }

  const schema = invoiceExtractionJsonSchema();
  const sections: string[] = [];

  if (tableExtraction) {
    sections.push(
      `## Structured Tables\n(method: ${tableExtraction.method})\n\n` +
        tableExtractionToPromptText(tableExtraction),
    );
  }

  if (rawOcr) {
    sections.push(
      "## Raw OCR Text\n" +
        "(tab-separated items on same row indicate spatial alignment)\n\n" +
        formatRawOcrForPrompt(rawOcr),
    );
  }

  const ocrText = sections.join("\n\n");

  return (
    "Extract the invoice data from the following OCR output.\n\n" +
    ocrText +
    "\n\n---\n\n" +
    "Return a JSON object matching this schema:\n" +
    JSON.stringify(schema, null, 2)
  );
}
