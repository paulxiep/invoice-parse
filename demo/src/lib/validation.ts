/**
 * Validation and confidence scoring.
 * Port of services/processing/invoice_processing/validation.py
 */

import type {
  InvoiceExtraction,
  ValidationCheck,
  ValidationResult,
} from "./types";

const REVIEW_THRESHOLD = 0.7;

const OPTIONAL_FIELDS: (keyof InvoiceExtraction)[] = [
  "supplier_address",
  "client_address",
  "invoice_date_end",
  "location",
  "vat_rate",
];

function validateVatMath(extraction: InvoiceExtraction): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // excl + vat_amount ≈ incl
  const expectedTotal = extraction.total_excl_vat + extraction.vat_amount;
  const diff = Math.abs(expectedTotal - extraction.total_incl_vat);
  checks.push({
    name: "vat_sum",
    passed: diff < 0.02,
    skipped: false,
    detail: `excl(${extraction.total_excl_vat}) + vat(${extraction.vat_amount}) = ${expectedTotal}, incl=${extraction.total_incl_vat}, diff=${diff.toFixed(2)}`,
  });

  // If vat_rate provided, verify vat_amount ≈ excl × rate/100
  if (extraction.vat_rate != null) {
    const expectedVat =
      extraction.total_excl_vat * extraction.vat_rate / 100;
    const vatDiff = Math.abs(expectedVat - extraction.vat_amount);
    checks.push({
      name: "vat_rate_consistency",
      passed: vatDiff < 0.02,
      skipped: false,
      detail: `expected_vat=${expectedVat.toFixed(2)}, actual=${extraction.vat_amount}, diff=${vatDiff.toFixed(2)}`,
    });
  } else {
    let derived = "";
    if (extraction.total_excl_vat > 0) {
      const derivedRate =
        (extraction.vat_amount / extraction.total_excl_vat) * 100;
      derived = `derived rate = ${derivedRate.toFixed(1)}%`;
    }
    checks.push({
      name: "vat_rate_consistency",
      passed: true,
      skipped: true,
      detail: `vat_rate not provided; ${derived}`,
    });
  }

  return checks;
}

function validateLineItemsSum(
  extraction: InvoiceExtraction,
): ValidationCheck {
  const itemsSum = extraction.line_items.reduce(
    (sum, item) => sum + item.total,
    0,
  );
  const diff = Math.abs(itemsSum - extraction.total_excl_vat);
  const n = extraction.line_items.length;
  const absTolerance = Math.max(0.01, 0.005 * n);
  const relOk = extraction.total_excl_vat
    ? Math.abs(diff / extraction.total_excl_vat) < 0.005
    : diff < 0.01;
  const passed = diff <= absTolerance || relOk;

  return {
    name: "line_items_sum",
    passed,
    skipped: false,
    detail: `items_sum=${itemsSum.toFixed(2)}, total_excl_vat=${extraction.total_excl_vat.toFixed(2)}, diff=${diff.toFixed(2)}, tolerance=${absTolerance.toFixed(3)}`,
  };
}

function validateDates(extraction: InvoiceExtraction): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const fieldName of ["invoice_date", "invoice_date_end"] as const) {
    const val = extraction[fieldName];
    if (val == null) continue;

    const d = new Date(val + "T00:00:00");

    checks.push({
      name: `${fieldName}_not_future`,
      passed: d <= today,
      skipped: false,
      detail: `${fieldName}=${val}`,
    });

    checks.push({
      name: `${fieldName}_not_ancient`,
      passed: d.getFullYear() >= 2000,
      skipped: false,
      detail: `${fieldName}=${val}`,
    });
  }

  return checks;
}

function validateFieldCompleteness(
  extraction: InvoiceExtraction,
): ValidationCheck {
  const filled = OPTIONAL_FIELDS.filter(
    (f) => extraction[f] != null,
  ).length;
  const ratio = filled / OPTIONAL_FIELDS.length;

  return {
    name: "field_completeness",
    passed: true,
    skipped: false,
    detail: `${filled}/${OPTIONAL_FIELDS.length} optional fields filled (${Math.round(ratio * 100)}%)`,
  };
}

function computeConfidence(
  checks: ValidationCheck[],
  ocrConfidence: number,
  fieldCompletenessRatio: number,
): number {
  const applicable = checks.filter((c) => !c.skipped);
  const checkScore = applicable.length
    ? applicable.filter((c) => c.passed).length / applicable.length
    : 0.5;

  const score =
    0.5 * checkScore + 0.3 * ocrConfidence + 0.2 * fieldCompletenessRatio;
  return Math.round(Math.min(1.0, Math.max(0.0, score)) * 1000) / 1000;
}

export function validateExtraction(
  extraction: InvoiceExtraction,
  ocrAvgConfidence: number,
): ValidationResult {
  const checks: ValidationCheck[] = [];
  checks.push(...validateVatMath(extraction));
  checks.push(validateLineItemsSum(extraction));
  checks.push(...validateDates(extraction));
  checks.push(validateFieldCompleteness(extraction));

  const filled = OPTIONAL_FIELDS.filter(
    (f) => extraction[f] != null,
  ).length;
  const completenessRatio = filled / OPTIONAL_FIELDS.length;

  const confidence = computeConfidence(
    checks,
    ocrAvgConfidence,
    completenessRatio,
  );
  const needsReview = confidence < REVIEW_THRESHOLD;

  const failed = checks.filter((c) => !c.passed && !c.skipped);
  const summary = failed.length
    ? "Failed checks: " + failed.map((c) => c.name).join(", ")
    : "All checks passed";

  return {
    checks,
    confidence_score: confidence,
    needs_review: needsReview,
    summary,
  };
}
