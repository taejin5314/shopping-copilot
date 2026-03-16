/**
 * CI quality gate for offline pipeline review.
 *
 * Evaluates already-computed ReviewSummary / ImportDiagnostics / ReviewResult[]
 * against configurable thresholds and returns a structured GateResult.
 *
 * Design goals:
 *   - Pure / deterministic — no I/O, no LLM, no network.
 *   - Transparent — every check reports its name, actual value, and threshold.
 *   - Composable — evaluateGate / parseThresholdsFromArgv / formatGateResult
 *     can be called independently.
 *   - Actionable — failing checks include a hint for remediation or CLI override.
 *
 * Usage:
 *   const result = evaluateGate(reviewSummary, importDiagnostics, reviewResults);
 *   if (!result.passed) process.exit(1);
 */

import type { ReviewResult, ReviewSummary } from "../test/quality-review.js";
import type { ImportDiagnostics } from "../test/log-importer.js";

// ── Threshold configuration ──

export interface GateThresholds {
  /**
   * Max queries with at least one "fail"-severity finding.
   * Set to 0 in CI to fail on any quality issue.
   * Default: 0
   */
  maxFailedQueries: number;

  /**
   * Max queries with only "warn" findings and no failures.
   * Default: Infinity (warnings do not block by default)
   */
  maxWarnOnlyQueries: number;

  /**
   * Max fraction of queries using Route B fallback (0–1).
   * High fallback rates may indicate adapter or QU problems.
   * Default: 1.0 (any fallback rate allowed)
   */
  maxFallbackRate: number;

  /**
   * Max queries with at least one "fail" finding in the "router" category.
   * Default: Infinity
   */
  maxRouterFailures: number;

  /**
   * Max queries with at least one "fail" finding in the "explanation" category.
   * Default: Infinity
   */
  maxExplanationFailures: number;

  /**
   * Max queries triggering the finder:zero-candidates check.
   * Default: Infinity
   */
  maxZeroCandidateFailures: number;

  /**
   * Max queries triggering the warnings:excessive check.
   * Default: Infinity
   */
  maxExcessiveWarningQueries: number;

  /**
   * Max raw records skipped due to a missing query field.
   * Default: Infinity
   */
  maxSkippedRecords: number;

  /**
   * Max imported records that had partial import (failed shape validations).
   * Default: Infinity
   */
  maxPartialImports: number;
}

/**
 * Default thresholds — conservative and suitable for local/dev use.
 *
 * Only maxFailedQueries is active (set to 0) so the gate catches any
 * failure-severity finding on a properly captured dataset.
 * All other thresholds are set to Infinity (not gated by default).
 *
 * Typical CI override: pass --max-failed=0 --max-fallback=0.3 etc.
 */
export const DEFAULT_THRESHOLDS: GateThresholds = {
  maxFailedQueries: 0,
  maxWarnOnlyQueries: Infinity,
  maxFallbackRate: 1.0,
  maxRouterFailures: Infinity,
  maxExplanationFailures: Infinity,
  maxZeroCandidateFailures: Infinity,
  maxExcessiveWarningQueries: Infinity,
  maxSkippedRecords: Infinity,
  maxPartialImports: Infinity,
};

// ── Result model ──

export interface GateCheckResult {
  /** Threshold key name, e.g. "maxFailedQueries". */
  name: string;
  /** Configured limit. */
  threshold: number;
  /** Measured value. */
  actual: number;
  /** actual ≤ threshold. */
  passed: boolean;
  /** Human-readable description of the measured value. */
  message: string;
  /** CLI flag to override this threshold (e.g. "--max-failed=5"). */
  hint: string;
}

export interface GateResult {
  passed: boolean;
  failedChecks: GateCheckResult[];
  passingChecks: GateCheckResult[];
  warnings: string[];
  summary: {
    totalChecks: number;
    failedChecks: number;
    passingChecks: number;
    /** Checks with a finite threshold (i.e. actively evaluated). */
    activeChecks: number;
  };
}

// ── Internal helpers ──

function mkCheck(
  name: string,
  actual: number,
  threshold: number,
  message: string,
  hint: string,
): GateCheckResult {
  return { name, threshold, actual, passed: actual <= threshold, message, hint };
}

function countQueriesWithCategoryFail(results: ReviewResult[], category: string): number {
  return results.filter((r) =>
    r.findings.some((f) => f.category === category && f.severity === "fail"),
  ).length;
}

function countQueriesWithCheck(results: ReviewResult[], check: string): number {
  return results.filter((r) =>
    r.findings.some((f) => f.check === check),
  ).length;
}

// ── Core evaluator ──

/**
 * Evaluate already-computed review outputs against configurable thresholds.
 *
 * Pass partial thresholds to override only specific fields; unset fields use
 * DEFAULT_THRESHOLDS values.
 *
 * Never throws.
 */
export function evaluateGate(
  reviewSummary: ReviewSummary,
  importDiagnostics: ImportDiagnostics,
  reviewResults: ReviewResult[],
  thresholds?: Partial<GateThresholds>,
): GateResult {
  const t: GateThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const allChecks: GateCheckResult[] = [];
  const warnings: string[] = [];

  // ── High-level query counts ──

  const warnOnlyCount = reviewResults.filter(
    (r) => r.hasWarnings && !r.hasFailures,
  ).length;

  allChecks.push(mkCheck(
    "maxFailedQueries",
    reviewSummary.queriesWithFailures,
    t.maxFailedQueries,
    `${reviewSummary.queriesWithFailures} quer${reviewSummary.queriesWithFailures === 1 ? "y" : "ies"} with failure-severity findings`,
    "--max-failed=<N>",
  ));

  allChecks.push(mkCheck(
    "maxWarnOnlyQueries",
    warnOnlyCount,
    t.maxWarnOnlyQueries,
    `${warnOnlyCount} quer${warnOnlyCount === 1 ? "y" : "ies"} with only warn-severity findings`,
    "--max-warn=<N>",
  ));

  allChecks.push(mkCheck(
    "maxFallbackRate",
    reviewSummary.fallbackRate,
    t.maxFallbackRate,
    `${(reviewSummary.fallbackRate * 100).toFixed(1)}% of queries used Route B fallback`,
    "--max-fallback=<0-1>",
  ));

  // ── Category-specific failure counts ──

  const routerFails = countQueriesWithCategoryFail(reviewResults, "router");
  allChecks.push(mkCheck(
    "maxRouterFailures",
    routerFails,
    t.maxRouterFailures,
    `${routerFails} quer${routerFails === 1 ? "y" : "ies"} with router-category fail findings`,
    "--max-router-failures=<N>",
  ));

  const explanationFails = countQueriesWithCategoryFail(reviewResults, "explanation");
  allChecks.push(mkCheck(
    "maxExplanationFailures",
    explanationFails,
    t.maxExplanationFailures,
    `${explanationFails} quer${explanationFails === 1 ? "y" : "ies"} with explanation-category fail findings`,
    "--max-explanation-failures=<N>",
  ));

  // ── Specific check counts ──

  const zeroCandidates = countQueriesWithCheck(reviewResults, "finder:zero-candidates");
  allChecks.push(mkCheck(
    "maxZeroCandidateFailures",
    zeroCandidates,
    t.maxZeroCandidateFailures,
    `${zeroCandidates} quer${zeroCandidates === 1 ? "y" : "ies"} with finder:zero-candidates finding`,
    "--max-zero-candidates=<N>",
  ));

  const excessiveWarns = countQueriesWithCheck(reviewResults, "warnings:excessive");
  allChecks.push(mkCheck(
    "maxExcessiveWarningQueries",
    excessiveWarns,
    t.maxExcessiveWarningQueries,
    `${excessiveWarns} quer${excessiveWarns === 1 ? "y" : "ies"} with warnings:excessive finding`,
    "--max-excessive-warnings=<N>",
  ));

  // ── Import-level counts ──

  allChecks.push(mkCheck(
    "maxSkippedRecords",
    importDiagnostics.skippedCount,
    t.maxSkippedRecords,
    `${importDiagnostics.skippedCount} record(s) skipped during import (missing query)`,
    "--max-skipped=<N>",
  ));

  allChecks.push(mkCheck(
    "maxPartialImports",
    importDiagnostics.partialImports,
    t.maxPartialImports,
    `${importDiagnostics.partialImports} record(s) had partial import (shape validation failures)`,
    "--max-partial=<N>",
  ));

  // ── Aggregate ──

  const failedChecks = allChecks.filter((c) => !c.passed);
  const passingChecks = allChecks.filter((c) => c.passed);
  const activeChecks = allChecks.filter((c) => isFinite(c.threshold)).length;

  // Warn when there are no finite thresholds (gate is effectively disabled)
  if (activeChecks === 0) {
    warnings.push(
      "All thresholds are set to Infinity — gate will always pass. " +
      "Set at least one threshold (e.g. --max-failed=0) to make the gate meaningful.",
    );
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    passingChecks,
    warnings,
    summary: {
      totalChecks: allChecks.length,
      failedChecks: failedChecks.length,
      passingChecks: passingChecks.length,
      activeChecks,
    },
  };
}

// ── Argv threshold parser ──

/**
 * Parse `--max-*=N` style argv arguments into a partial GateThresholds object.
 * Unknown flags are silently ignored (the caller handles unknown arg reporting).
 * Invalid numeric values produce NaN, which is treated as Infinity by the gate.
 */
export function parseThresholdsFromArgv(args: string[]): Partial<GateThresholds> {
  const overrides: Partial<GateThresholds> = {};

  for (const arg of args) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const n = parseFloat(rawValue);
    if (!isFinite(n) && n !== Infinity) continue; // skip invalid values
    const value = n;

    switch (key) {
      case "max-failed":               overrides.maxFailedQueries = value; break;
      case "max-warn":                 overrides.maxWarnOnlyQueries = value; break;
      case "max-fallback":             overrides.maxFallbackRate = value; break;
      case "max-router-failures":      overrides.maxRouterFailures = value; break;
      case "max-explanation-failures": overrides.maxExplanationFailures = value; break;
      case "max-zero-candidates":      overrides.maxZeroCandidateFailures = value; break;
      case "max-excessive-warnings":   overrides.maxExcessiveWarningQueries = value; break;
      case "max-skipped":              overrides.maxSkippedRecords = value; break;
      case "max-partial":              overrides.maxPartialImports = value; break;
    }
  }

  return overrides;
}

// ── Formatters ──

function fmtThreshold(n: number): string {
  return isFinite(n) ? n.toString() : "∞";
}

function fmtActual(n: number): string {
  // Show fallback rate as percentage if it looks like a 0-1 fraction
  return n.toString();
}

/**
 * Format a GateResult as a human-readable string suitable for CI logs.
 *
 * Failed checks are shown prominently; passing checks are shown below.
 * Each failing check includes its CLI override hint.
 */
export function formatGateResult(result: GateResult): string {
  const lines: string[] = [];

  const statusIcon = result.passed ? "✓" : "✗";
  const statusLabel = result.passed ? "PASSED" : "FAILED";
  const { failedChecks: fc, passingChecks: pc, summary: s } = result;

  lines.push("=== Quality Gate ===");
  lines.push(
    `Status: ${statusLabel} ${statusIcon}` +
    (fc.length > 0 ? ` — ${fc.length} of ${s.activeChecks || s.totalChecks} active check${fc.length === 1 ? "" : "s"} failed` : ""),
  );

  if (result.warnings.length > 0) {
    lines.push("");
    for (const w of result.warnings) {
      lines.push(`  [warn] ${w}`);
    }
  }

  if (fc.length > 0) {
    lines.push("");
    lines.push("Failed checks:");
    for (const c of fc) {
      lines.push(`  ✗ ${c.name.padEnd(28)} actual=${fmtActual(c.actual)}  threshold=${fmtThreshold(c.threshold)}`);
      lines.push(`    ↳ ${c.message}`);
      lines.push(`    ↳ override with: ${c.hint}`);
    }
  }

  if (pc.length > 0) {
    lines.push("");
    lines.push("Passing checks:");
    for (const c of pc) {
      const finite = isFinite(c.threshold);
      // Only show finite-threshold checks in passing; infinite ones are trivially passing
      if (finite) {
        lines.push(`  ✓ ${c.name.padEnd(28)} ${fmtActual(c.actual)} ≤ ${fmtThreshold(c.threshold)}`);
      }
    }
    const infiniteCount = pc.filter((c) => !isFinite(c.threshold)).length;
    if (infiniteCount > 0) {
      lines.push(`  ✓ ${infiniteCount} additional check${infiniteCount === 1 ? "" : "s"} (threshold: ∞ — not gated)`);
    }
  }

  return lines.join("\n");
}

/**
 * Return a plain object representation of a GateResult for embedding in JSON output.
 */
export function gateResultToJson(result: GateResult): Record<string, unknown> {
  return {
    passed: result.passed,
    summary: result.summary,
    failedChecks: result.failedChecks.map((c) => ({
      name: c.name,
      actual: c.actual,
      threshold: isFinite(c.threshold) ? c.threshold : null,
      message: c.message,
    })),
    warnings: result.warnings,
  };
}
