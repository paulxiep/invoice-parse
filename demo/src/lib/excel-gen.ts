/**
 * Excel generation from InvoiceExtraction.
 * Port of services/output/src/excel_gen.rs using wasm-xlsxwriter.
 */

import type { InvoiceExtraction, LineItem } from "./types";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/wasm-xlsxwriter@0.12.2/web";

let xlsxModule: typeof import("wasm-xlsxwriter") | null = null;

async function ensureWasm() {
  if (!xlsxModule) {
    // Dynamic import from the CDN to get the web build directly
    const mod = await import(/* @vite-ignore */ `${WASM_CDN}/wasm_xlsxwriter.js`);
    await mod.default(`${WASM_CDN}/wasm_xlsxwriter_bg.wasm`);
    xlsxModule = mod;
  }
  return xlsxModule;
}

type CellValue = string | number | null;

type ColumnDef = {
  header: string;
  accessor: (item: LineItem) => CellValue;
  monetary: boolean;
};

const JOB_COLUMNS: ColumnDef[] = [
  { header: "Date", accessor: (i) => i.date ?? null, monetary: false },
  { header: "Item", accessor: (i) => i.item, monetary: false },
  { header: "Qty", accessor: (i) => i.quantity ?? null, monetary: false },
  { header: "Start", accessor: (i) => i.start_time ?? null, monetary: false },
  { header: "Finish", accessor: (i) => i.finish_time ?? null, monetary: false },
  { header: "Hours", accessor: (i) => i.hours ?? null, monetary: false },
  { header: "Total Hours", accessor: (i) => i.total_hours ?? null, monetary: false },
  { header: "Tariff", accessor: (i) => round2(i.tariff), monetary: true },
  { header: "Total", accessor: (i) => round2(i.total)!, monetary: true },
];

const MISC_COLUMNS: ColumnDef[] = [
  { header: "Item", accessor: (i) => i.item, monetary: false },
  { header: "Qty", accessor: (i) => i.quantity ?? null, monetary: false },
  { header: "Unit", accessor: (i) => i.unit ?? null, monetary: false },
  { header: "Tariff", accessor: (i) => round2(i.tariff), monetary: true },
  { header: "Tariff Unit", accessor: (i) => i.tariff_unit ?? null, monetary: false },
  { header: "Total", accessor: (i) => round2(i.total)!, monetary: true },
];

const FLAT_COLUMNS: ColumnDef[] = [
  { header: "Section", accessor: (i) => i.section ?? null, monetary: false },
  { header: "Date", accessor: (i) => i.date ?? null, monetary: false },
  { header: "Item", accessor: (i) => i.item, monetary: false },
  { header: "Qty", accessor: (i) => i.quantity ?? null, monetary: false },
  { header: "Unit", accessor: (i) => i.unit ?? null, monetary: false },
  { header: "Start", accessor: (i) => i.start_time ?? null, monetary: false },
  { header: "Finish", accessor: (i) => i.finish_time ?? null, monetary: false },
  { header: "Hours", accessor: (i) => i.hours ?? null, monetary: false },
  { header: "Total Hours", accessor: (i) => i.total_hours ?? null, monetary: false },
  { header: "Tariff", accessor: (i) => round2(i.tariff), monetary: true },
  { header: "Tariff Unit", accessor: (i) => i.tariff_unit ?? null, monetary: false },
  { header: "Total", accessor: (i) => round2(i.total)!, monetary: true },
];

function round2(v: number | undefined | null): number | null {
  if (v == null) return null;
  return Math.round(v * 100) / 100;
}

function pickColumns(sectionName: string): ColumnDef[] {
  const lower = sectionName.toLowerCase();
  if (lower.includes("job")) return JOB_COLUMNS;
  if (lower.includes("misc")) return MISC_COLUMNS;
  return FLAT_COLUMNS;
}

function hasSections(items: LineItem[]): boolean {
  return items.some((item) => item.section != null);
}

export async function generateExcel(
  extraction: InvoiceExtraction,
): Promise<Blob> {
  const mod = await ensureWasm();
  const { Workbook, Format } = mod!;
  const workbook = new Workbook();
  const ws = workbook.addWorksheet();

  const bold = new Format().setBold();
  const moneyFmt = new Format().setNumFormat("#,##0.00");
  const headerFmt = new Format().setBold();
  const sectionFmt = new Format().setBold();

  let row = 0;

  // --- Header section ---
  const headerFields: [string, string | null][] = [
    ["Supplier Name", extraction.supplier_name],
    ["Supplier Address", extraction.supplier_address ?? null],
    ["Client Name", extraction.client_name],
    ["Client Address", extraction.client_address ?? null],
    ["Invoice Number", extraction.invoice_number],
    [
      "Invoice Date",
      extraction.invoice_date_end
        ? `${extraction.invoice_date} \u2013 ${extraction.invoice_date_end}`
        : extraction.invoice_date,
    ],
    ["Location", extraction.location ?? null],
    ["Currency", extraction.currency],
  ];

  for (const [label, value] of headerFields) {
    if (value != null) {
      ws.writeWithFormat(row, 0, label, bold);
      ws.write(row, 1, value);
      row++;
    }
  }

  // VAT rate
  if (extraction.vat_rate != null) {
    ws.writeWithFormat(row, 0, "VAT Rate", bold);
    ws.write(row, 1, `${extraction.vat_rate}%`);
    row++;
  }

  // Monetary fields
  const monetaryFields: [string, number][] = [
    ["Total excl. VAT", extraction.total_excl_vat],
    ["VAT Amount", extraction.vat_amount],
    ["Total incl. VAT", extraction.total_incl_vat],
  ];

  for (const [label, value] of monetaryFields) {
    ws.writeWithFormat(row, 0, label, bold);
    ws.writeWithFormat(row, 1, round2(value)!, moneyFmt);
    row++;
  }

  // Column widths
  ws.setColumnWidth(0, 18);
  ws.setColumnWidth(1, 25);

  row++; // blank row

  // --- Line items ---
  const items = extraction.line_items;
  if (items.length === 0) {
    const buffer = workbook.saveToBufferSync();
    return new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  if (hasSections(items)) {
    let currentSection: string | null = null;
    let sectionItems: LineItem[] = [];

    for (const item of items) {
      const section = item.section ?? "";
      if (currentSection !== section && sectionItems.length > 0) {
        row = writeSection(ws, row, currentSection ?? "", sectionItems, {
          headerFmt,
          moneyFmt,
          sectionFmt,
        });
        sectionItems = [];
      }
      currentSection = section;
      sectionItems.push(item);
    }
    if (sectionItems.length > 0) {
      writeSection(ws, row, currentSection ?? "", sectionItems, {
        headerFmt,
        moneyFmt,
        sectionFmt,
      });
    }
  } else {
    const usedColumns = FLAT_COLUMNS.filter((col) =>
      items.some((item) => col.accessor(item) != null),
    );

    usedColumns.forEach((col, ci) => {
      ws.writeWithFormat(row, ci, col.header, headerFmt);
      ws.setColumnWidth(ci, col.header.length + 4);
    });
    row++;

    for (const item of items) {
      usedColumns.forEach((col, ci) => {
        writeCell(ws, row, ci, col.accessor(item), col.monetary, moneyFmt);
      });
      row++;
    }
  }

  const buffer = workbook.saveToBufferSync();
  return new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

interface SectionStyles {
  headerFmt: unknown;
  moneyFmt: unknown;
  sectionFmt: unknown;
}

function writeSection(
  ws: any,
  row: number,
  sectionName: string,
  items: LineItem[],
  styles: SectionStyles,
): number {
  const columns = pickColumns(sectionName);

  if (sectionName) {
    ws.writeWithFormat(row, 0, sectionName, styles.sectionFmt);
    row++;
  }

  columns.forEach((col, ci) => {
    ws.writeWithFormat(row, ci, col.header, styles.headerFmt);
    ws.setColumnWidth(ci, col.header.length + 4);
  });
  row++;

  for (const item of items) {
    columns.forEach((col, ci) => {
      writeCell(ws, row, ci, col.accessor(item), col.monetary, styles.moneyFmt);
    });
    row++;
  }

  return row + 1;
}

function writeCell(
  ws: any,
  row: number,
  col: number,
  value: CellValue,
  monetary: boolean,
  moneyFmt: any,
): void {
  if (value == null) return;
  if (monetary && typeof value === "number") {
    ws.writeWithFormat(row, col, value, moneyFmt);
  } else {
    ws.write(row, col, value);
  }
}
