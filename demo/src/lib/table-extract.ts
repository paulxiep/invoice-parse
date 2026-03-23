/**
 * Spatial clustering table extraction.
 * Port of services/processing/invoice_processing/table_extract.py
 * (SpatialClusterExtractor only — no PPStructure in browser).
 */

import type {
  OcrLine,
  OcrPage,
  RawOcrOutput,
  TableExtractionOutput,
  TablePage,
  TableRegion,
} from "./types";

/**
 * Cluster sorted values by detecting natural gaps.
 * A gap > 2× median signals a cluster boundary.
 * Returns list of clusters (each a list of original indices).
 */
function detectGaps(values: number[]): number[][] {
  if (values.length <= 1) {
    return [Array.from({ length: values.length }, (_, i) => i)];
  }

  const gaps = values.slice(1).map((v, i) => v - values[i]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const threshold = Math.max(medianGap * 2, 1);

  const clusters: number[][] = [[0]];
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > threshold) {
      clusters.push([]);
    }
    clusters[clusters.length - 1].push(i + 1);
  }
  return clusters;
}

/**
 * Cluster a single page's OCR lines into table regions.
 */
function clusterPage(page: OcrPage): TableRegion[] {
  if (page.lines.length === 0) return [];

  // Cluster lines into rows by y-gaps
  const yValues = page.lines.map((l) => l.y);
  const rowClusters = detectGaps(yValues);

  // Build row groups (sorted by x within each row)
  const rowGroups: OcrLine[][] = rowClusters.map((indices) =>
    indices.map((i) => page.lines[i]).sort((a, b) => a.x - b.x),
  );

  // Detect region boundaries (large y-gaps between rows)
  const rowYValues = rowGroups.map((g) => g[0].y);
  const regionBreaks = new Set<number>();

  if (rowYValues.length > 1) {
    const interRowGaps = rowYValues
      .slice(1)
      .map((y, i) => y - rowYValues[i]);
    const sorted = [...interRowGaps].sort((a, b) => a - b);
    const medianRowGap = sorted[Math.floor(sorted.length / 2)];
    const regionThreshold = Math.max(medianRowGap * 3, 1);

    interRowGaps.forEach((gap, i) => {
      if (gap > regionThreshold) regionBreaks.add(i + 1);
    });
  }

  // Format into regions
  const regions: TableRegion[] = [];
  rowGroups.forEach((row, i) => {
    if (regionBreaks.has(i)) {
      regions.push({ label: "separator", content: "---", rows: [] });
    }
    const lineText = row.map((l) => l.text).join("\t");
    regions.push({ label: "text", content: lineText, rows: [] });
  });

  return regions;
}

/**
 * Run spatial cluster table extraction on raw OCR output.
 */
export function extractTables(
  rawOcr: RawOcrOutput,
): TableExtractionOutput {
  const pages: TablePage[] = rawOcr.pages.map((ocrPage) => ({
    page_number: ocrPage.page_number,
    regions: clusterPage(ocrPage),
  }));

  return { pages, method: "spatial_cluster" };
}

/**
 * Format TableExtractionOutput for LLM prompt consumption.
 */
export function tableExtractionToPromptText(
  output: TableExtractionOutput,
): string {
  const parts: string[] = [];

  for (const page of output.pages) {
    if (output.pages.length > 1) {
      parts.push(`--- Page ${page.page_number} ---`);
    }
    for (const region of page.regions) {
      if (region.label === "title") {
        parts.push(`\n## ${region.content}\n`);
      } else if (region.label === "table" && region.rows.length > 0) {
        for (const row of region.rows) {
          parts.push("| " + row.join(" | ") + " |");
        }
        parts.push("");
      } else if (region.label === "separator") {
        parts.push("---");
      } else if (region.content.trim()) {
        parts.push(region.content);
        parts.push("");
      }
    }
  }

  return parts.join("\n");
}
