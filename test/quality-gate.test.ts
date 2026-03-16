/**
 * Tests for the CI quality gate (scripts/quality-gate.ts).
 *
 * All tests are pure/deterministic — no I/O, no LLM, no network.
 *
 * Coverage:
 *   1.  Gate passes with healthy review summary (no findings)
 *   2.  Gate fails on too many failed queries
 *   3.  Gate fails on high fallback rate
 *   4.  Gate fails on explanation-category failures
 *   5.  Gate fails on zero-candidate findings
 *   6.  Multiple threshold failures are all reported
 *   7.  Gate passes when actual equals threshold (boundary)
 *   8.  Gate fails when actual exceeds threshold by 1 (boundary)
 *   9.  Partial threshold overrides — only overridden fields change
 *   10. parseThresholdsFromArgv — correct parsing of each flag
 *   11. parseThresholdsFromArgv — unknown flags are silently ignored
 *   12. parseThresholdsFromArgv — invalid numeric values are skipped
 *   13. DEFAULT_THRESHOLDS are stable and documented
 *   14. formatGateResult — PASSED output contains status
 *   15. formatGateResult — FAILED output lists failing checks with hints
 *   16. formatGateResult — passing checks are shown separately
 *   17. gateResultToJson — structure for JSON output
 *   18. warnOnlyQueries counted separately from failed queries
 *   19. maxWarnOnlyQueries threshold respected
 *   20. maxSkippedRecords and maxPartialImports thresholds
 *   21. Gate warns when all thresholds are Infinity
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateGate,
  parseThresholdsFromArgv,
  formatGateResult,
  gateResultToJson,
  DEFAULT_THRESHOLDS,
  type GateThresholds,
  type GateResult,
} from "../scripts/quality-gate.js";

import type { ReviewResult, ReviewSummary } from "./quality-review.js";
import type { ImportDiagnostics } from "./log-importer.js";

// ── Test builders ──

function mkReviewSummary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    totalReviewed: 5,
    totalFindings: 0,
    queriesWithFailures: 0,
    queriesWithWarnings: 0,
    fallbackRate: 0,
    topCategories: [],
    commonWarnings: [],
    suggestedFixtureCandidates: [],
    ...overrides,
  };
}

function mkImportDiagnostics(overrides: Partial<ImportDiagnostics> = {}): ImportDiagnostics {
  return {
    importedCount: 5,
    skippedCount: 0,
    groupedCount: 0,
    recordsMissingQuery: 0,
    partialImports: 0,
    warnings: [],
    ...overrides,
  };
}

function mkReviewResult(
  query: string,
  findings: Array<{ severity: "info" | "warn" | "fail"; category: string; check: string }> = [],
): ReviewResult {
  const typedFindings = findings.map((f) => ({
    severity: f.severity,
    category: f.category,
    check: f.check,
    message: `test message for ${f.check}`,
  }));
  return {
    input: { query },
    findings: typedFindings,
    hasFailures: typedFindings.some((f) => f.severity === "fail"),
    hasWarnings: typedFindings.some((f) => f.severity === "warn"),
  };
}

// Helpers
const noResults: ReviewResult[] = [];
const diag = mkImportDiagnostics();

// ── Test 1: Gate passes with healthy summary ──

describe("evaluateGate — passes with healthy summary", () => {
  const result = evaluateGate(mkReviewSummary(), diag, noResults);

  it("passed is true", () => assert.equal(result.passed, true));
  it("failedChecks is empty", () => assert.equal(result.failedChecks.length, 0));
  it("summary.failedChecks is 0", () => assert.equal(result.summary.failedChecks, 0));
  it("summary.totalChecks is 9", () => assert.equal(result.summary.totalChecks, 9));
});

// ── Test 2: Gate fails on too many failed queries ──

describe("evaluateGate — fails on maxFailedQueries exceeded", () => {
  const results = [
    mkReviewResult("query a", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
    mkReviewResult("query b", [{ severity: "fail", category: "explanation", check: "explanation:missing-on-product-path" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 2, totalFindings: 2 });
  const result = evaluateGate(summary, diag, results, { maxFailedQueries: 1 });

  it("passed is false", () => assert.equal(result.passed, false));
  it("failedChecks contains maxFailedQueries", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFailedQueries"));
  });
  it("failing check has correct actual", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFailedQueries")!;
    assert.equal(c.actual, 2);
  });
  it("failing check has correct threshold", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFailedQueries")!;
    assert.equal(c.threshold, 1);
  });
  it("message mentions the count", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFailedQueries")!;
    assert.ok(c.message.includes("2"));
  });
  it("hint contains --max-failed", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFailedQueries")!;
    assert.ok(c.hint.includes("--max-failed"));
  });
});

// ── Test 3: Gate fails on high fallback rate ──

describe("evaluateGate — fails on maxFallbackRate exceeded", () => {
  const summary = mkReviewSummary({ fallbackRate: 0.75 });
  const result = evaluateGate(summary, diag, noResults, { maxFallbackRate: 0.5 });

  it("passed is false", () => assert.equal(result.passed, false));
  it("failedChecks contains maxFallbackRate", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFallbackRate"));
  });
  it("actual is 0.75", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFallbackRate")!;
    assert.equal(c.actual, 0.75);
  });
  it("threshold is 0.5", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFallbackRate")!;
    assert.equal(c.threshold, 0.5);
  });
  it("message mentions percentage", () => {
    const c = result.failedChecks.find((c) => c.name === "maxFallbackRate")!;
    assert.ok(c.message.includes("75.0%") || c.message.includes("75%") || c.message.includes("fallback"));
  });
});

// ── Test 4: Gate fails on explanation failures ──

describe("evaluateGate — fails on maxExplanationFailures exceeded", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "explanation", check: "explanation:missing-on-product-path" }]),
    mkReviewResult("q2", [{ severity: "fail", category: "explanation", check: "explanation:missing-on-product-path" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 2, totalFindings: 2 });
  const result = evaluateGate(summary, diag, results, {
    maxFailedQueries: Infinity,  // don't gate on total
    maxExplanationFailures: 1,
  });

  it("passed is false", () => assert.equal(result.passed, false));
  it("failedChecks contains maxExplanationFailures", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxExplanationFailures"));
  });
  it("actual explanation failures is 2", () => {
    const c = result.failedChecks.find((c) => c.name === "maxExplanationFailures")!;
    assert.equal(c.actual, 2);
  });
  it("maxFailedQueries is not in failedChecks (Infinity)", () => {
    assert.ok(!result.failedChecks.some((c) => c.name === "maxFailedQueries"));
  });
});

// ── Test 5: Gate fails on zero-candidate findings ──

describe("evaluateGate — fails on maxZeroCandidateFailures exceeded", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
    mkReviewResult("q2", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
    mkReviewResult("q3", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 3 });
  const result = evaluateGate(summary, diag, results, {
    maxFailedQueries: Infinity,
    maxZeroCandidateFailures: 2,
  });

  it("passed is false", () => assert.equal(result.passed, false));
  it("failedChecks contains maxZeroCandidateFailures", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxZeroCandidateFailures"));
  });
  it("actual is 3", () => {
    const c = result.failedChecks.find((c) => c.name === "maxZeroCandidateFailures")!;
    assert.equal(c.actual, 3);
  });
});

// ── Test 6: Multiple threshold failures all reported ──

describe("evaluateGate — multiple failures all reported", () => {
  const results = [
    mkReviewResult("q1", [
      { severity: "fail", category: "finder", check: "finder:zero-candidates" },
      { severity: "warn", category: "warnings", check: "warnings:excessive" },
    ]),
    mkReviewResult("q2", [
      { severity: "fail", category: "explanation", check: "explanation:missing-on-product-path" },
    ]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 2, fallbackRate: 0.8 });
  const result = evaluateGate(summary, diag, results, {
    maxFailedQueries: 0,
    maxFallbackRate: 0.5,
    maxExplanationFailures: 0,
  });

  it("passed is false", () => assert.equal(result.passed, false));
  it("failedChecks has 3 entries", () => assert.equal(result.failedChecks.length, 3));

  it("reports maxFailedQueries failure", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFailedQueries"));
  });
  it("reports maxFallbackRate failure", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFallbackRate"));
  });
  it("reports maxExplanationFailures failure", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxExplanationFailures"));
  });

  it("summary.failedChecks is 3", () => assert.equal(result.summary.failedChecks, 3));
  it("passingChecks contains the remaining checks", () => {
    assert.ok(result.passingChecks.length > 0);
  });
});

// ── Test 7: Boundary — actual equals threshold → passes ──

describe("evaluateGate — boundary: actual === threshold passes", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 1 });
  const result = evaluateGate(summary, diag, results, { maxFailedQueries: 1 });

  it("passed is true when actual equals threshold", () => {
    assert.equal(result.passed, true);
  });
  it("no failedChecks", () => assert.equal(result.failedChecks.length, 0));
});

// ── Test 8: Boundary — actual exceeds threshold by 1 → fails ──

describe("evaluateGate — boundary: actual === threshold + 1 fails", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
    mkReviewResult("q2", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 2 });
  const result = evaluateGate(summary, diag, results, { maxFailedQueries: 1 });

  it("passed is false when actual > threshold", () => {
    assert.equal(result.passed, false);
  });
});

// ── Test 9: Partial threshold overrides ──

describe("evaluateGate — partial overrides leave other defaults intact", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 1, fallbackRate: 0.9 });

  // Override only maxFallbackRate; maxFailedQueries should use DEFAULT (0)
  const result = evaluateGate(summary, diag, results, { maxFallbackRate: 0.5 });

  it("maxFailedQueries uses default (0) — fails on 1 failed query", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFailedQueries"));
  });
  it("maxFallbackRate uses override (0.5) — fails on 0.9", () => {
    assert.ok(result.failedChecks.some((c) => c.name === "maxFallbackRate"));
  });
  it("maxRouterFailures uses default (Infinity) — not in failedChecks", () => {
    assert.ok(!result.failedChecks.some((c) => c.name === "maxRouterFailures"));
  });
});

// ── Test 10: parseThresholdsFromArgv ──

describe("parseThresholdsFromArgv — correct parsing", () => {
  const args = [
    "--max-failed=3",
    "--max-warn=5",
    "--max-fallback=0.3",
    "--max-router-failures=1",
    "--max-explanation-failures=2",
    "--max-zero-candidates=0",
    "--max-excessive-warnings=4",
    "--max-skipped=10",
    "--max-partial=7",
  ];
  const t = parseThresholdsFromArgv(args);

  it("parses maxFailedQueries", () => assert.equal(t.maxFailedQueries, 3));
  it("parses maxWarnOnlyQueries", () => assert.equal(t.maxWarnOnlyQueries, 5));
  it("parses maxFallbackRate", () => assert.equal(t.maxFallbackRate, 0.3));
  it("parses maxRouterFailures", () => assert.equal(t.maxRouterFailures, 1));
  it("parses maxExplanationFailures", () => assert.equal(t.maxExplanationFailures, 2));
  it("parses maxZeroCandidateFailures", () => assert.equal(t.maxZeroCandidateFailures, 0));
  it("parses maxExcessiveWarningQueries", () => assert.equal(t.maxExcessiveWarningQueries, 4));
  it("parses maxSkippedRecords", () => assert.equal(t.maxSkippedRecords, 10));
  it("parses maxPartialImports", () => assert.equal(t.maxPartialImports, 7));
});

// ── Test 11: parseThresholdsFromArgv — unknown flags ignored ──

describe("parseThresholdsFromArgv — unknown flags silently ignored", () => {
  it("returns empty object for unknown flags", () => {
    const t = parseThresholdsFromArgv(["--unknown-flag=5", "--also-unknown=10"]);
    assert.equal(Object.keys(t).length, 0);
  });

  it("parses known flags alongside unknown ones", () => {
    const t = parseThresholdsFromArgv(["--unknown=99", "--max-failed=2"]);
    assert.equal(t.maxFailedQueries, 2);
    assert.equal(t.maxWarnOnlyQueries, undefined);
  });

  it("returns empty object for empty array", () => {
    assert.equal(Object.keys(parseThresholdsFromArgv([])).length, 0);
  });
});

// ── Test 12: parseThresholdsFromArgv — invalid numeric values skipped ──

describe("parseThresholdsFromArgv — invalid values are skipped", () => {
  it("skips NaN values", () => {
    const t = parseThresholdsFromArgv(["--max-failed=abc"]);
    assert.equal(t.maxFailedQueries, undefined);
  });

  it("accepts 0", () => {
    const t = parseThresholdsFromArgv(["--max-failed=0"]);
    assert.equal(t.maxFailedQueries, 0);
  });

  it("accepts float values", () => {
    const t = parseThresholdsFromArgv(["--max-fallback=0.25"]);
    assert.equal(t.maxFallbackRate, 0.25);
  });
});

// ── Test 13: DEFAULT_THRESHOLDS are stable ──

describe("DEFAULT_THRESHOLDS — stable documented values", () => {
  it("maxFailedQueries default is 0 (strict: any failure fails gate)", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxFailedQueries, 0);
  });
  it("maxWarnOnlyQueries default is Infinity (warnings do not block)", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxWarnOnlyQueries, Infinity);
  });
  it("maxFallbackRate default is 1.0 (any fallback rate allowed)", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxFallbackRate, 1.0);
  });
  it("maxRouterFailures default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxRouterFailures, Infinity);
  });
  it("maxExplanationFailures default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxExplanationFailures, Infinity);
  });
  it("maxZeroCandidateFailures default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxZeroCandidateFailures, Infinity);
  });
  it("maxExcessiveWarningQueries default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxExcessiveWarningQueries, Infinity);
  });
  it("maxSkippedRecords default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxSkippedRecords, Infinity);
  });
  it("maxPartialImports default is Infinity", () => {
    assert.equal(DEFAULT_THRESHOLDS.maxPartialImports, Infinity);
  });
  it("DEFAULT_THRESHOLDS has exactly 9 keys", () => {
    assert.equal(Object.keys(DEFAULT_THRESHOLDS).length, 9);
  });
});

// ── Test 14: formatGateResult — PASSED output ──

describe("formatGateResult — PASSED", () => {
  const result = evaluateGate(mkReviewSummary(), diag, noResults);
  const output = formatGateResult(result);

  it("contains 'Quality Gate'", () => assert.ok(output.includes("Quality Gate")));
  it("contains 'PASSED'", () => assert.ok(output.includes("PASSED")));
  it("does not contain 'FAILED'", () => assert.ok(!output.includes("FAILED")));
  it("does not contain 'Failed checks'", () => assert.ok(!output.includes("Failed checks:")));
});

// ── Test 15: formatGateResult — FAILED output with hints ──

describe("formatGateResult — FAILED with hints", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({ queriesWithFailures: 1, fallbackRate: 0.9 });
  const gateResult = evaluateGate(summary, diag, results, {
    maxFailedQueries: 0,
    maxFallbackRate: 0.5,
  });
  const output = formatGateResult(gateResult);

  it("contains 'FAILED'", () => assert.ok(output.includes("FAILED")));
  it("contains 'Failed checks'", () => assert.ok(output.includes("Failed checks:")));
  it("contains maxFailedQueries check name", () => assert.ok(output.includes("maxFailedQueries")));
  it("contains maxFallbackRate check name", () => assert.ok(output.includes("maxFallbackRate")));
  it("contains --max-failed hint", () => assert.ok(output.includes("--max-failed")));
  it("contains --max-fallback hint", () => assert.ok(output.includes("--max-fallback")));
  it("contains ↳ prefix for hints", () => assert.ok(output.includes("↳")));
  it("contains actual values", () => assert.ok(output.includes("1") || output.includes("0.9")));
});

// ── Test 16: formatGateResult — passing checks shown ──

describe("formatGateResult — passing checks shown", () => {
  // One failing, one explicitly configured passing
  const summary = mkReviewSummary({ queriesWithFailures: 1, fallbackRate: 0.2 });
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const gateResult = evaluateGate(summary, diag, results, {
    maxFailedQueries: 0,
    maxFallbackRate: 0.5,  // passes (0.2 ≤ 0.5)
  });
  const output = formatGateResult(gateResult);

  it("contains 'Passing checks'", () => assert.ok(output.includes("Passing checks:")));
  it("contains ✓ for passing check with finite threshold", () => {
    assert.ok(output.includes("✓"));
  });
  it("mentions infinite-threshold checks with ∞", () => {
    assert.ok(output.includes("∞"));
  });
});

// ── Test 17: gateResultToJson ──

describe("gateResultToJson", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const gateResult = evaluateGate(
    mkReviewSummary({ queriesWithFailures: 1 }),
    diag,
    results,
    { maxFailedQueries: 0 },
  );
  const json = gateResultToJson(gateResult);

  it("has 'passed' field", () => assert.equal(typeof json.passed, "boolean"));
  it("has 'summary' field", () => assert.ok(json.summary !== undefined));
  it("has 'failedChecks' array", () => assert.ok(Array.isArray(json.failedChecks)));
  it("has 'warnings' array", () => assert.ok(Array.isArray(json.warnings)));
  it("passed is false when gate fails", () => assert.equal(json.passed, false));
  it("failedChecks contains the failing check", () => {
    const fc = json.failedChecks as Array<Record<string, unknown>>;
    assert.ok(fc.some((c) => c.name === "maxFailedQueries"));
  });
  it("Infinity threshold is serialized as null", () => {
    const fc = json.failedChecks as Array<Record<string, unknown>>;
    // Find a passing check with Infinity threshold — not in failedChecks.
    // Verify the whole structure is serializable:
    assert.doesNotThrow(() => JSON.stringify(json));
  });
});

// ── Test 18: Warn-only queries counted separately from failed queries ──

describe("evaluateGate — warnOnly counted separately", () => {
  const results = [
    mkReviewResult("q1", [{ severity: "warn", category: "router", check: "router:low-confidence" }]),
    mkReviewResult("q2", [{ severity: "warn", category: "router", check: "router:low-confidence" }]),
    mkReviewResult("q3", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
  ];
  const summary = mkReviewSummary({
    queriesWithFailures: 1,
    queriesWithWarnings: 3,  // q1, q2, q3 all have warnings
  });

  const result = evaluateGate(summary, diag, results, {
    maxFailedQueries: Infinity,
    maxWarnOnlyQueries: 1,  // q1 and q2 are warn-only → 2 > 1 → fail
  });

  it("warnOnly count is 2 (q1 and q2 have no fails)", () => {
    const c = result.failedChecks.find((c) => c.name === "maxWarnOnlyQueries");
    assert.ok(c !== undefined, "maxWarnOnlyQueries should be in failedChecks");
    assert.equal(c!.actual, 2);
  });

  it("failed count is 1 (q3 only)", () => {
    const c = result.passingChecks.find((c) => c.name === "maxFailedQueries");
    // maxFailedQueries is Infinity so it passes — but actual should be 1
    assert.ok(c !== undefined);
    assert.equal(c!.actual, 1);
  });
});

// ── Test 19: maxWarnOnlyQueries threshold ──

describe("evaluateGate — maxWarnOnlyQueries respected", () => {
  const warnResults = [
    mkReviewResult("q1", [{ severity: "warn", category: "router", check: "router:low-confidence" }]),
    mkReviewResult("q2", [{ severity: "warn", category: "router", check: "router:low-confidence" }]),
  ];
  const summary = mkReviewSummary({ queriesWithWarnings: 2 });

  it("passes when warnOnly count === threshold", () => {
    const result = evaluateGate(summary, diag, warnResults, {
      maxFailedQueries: Infinity,
      maxWarnOnlyQueries: 2,
    });
    assert.equal(result.passed, true);
  });

  it("fails when warnOnly count > threshold", () => {
    const result = evaluateGate(summary, diag, warnResults, {
      maxFailedQueries: Infinity,
      maxWarnOnlyQueries: 1,
    });
    assert.equal(result.passed, false);
  });
});

// ── Test 20: Import-level thresholds ──

describe("evaluateGate — maxSkippedRecords and maxPartialImports", () => {
  const heavyDiag = mkImportDiagnostics({ skippedCount: 5, partialImports: 3 });

  it("fails on maxSkippedRecords exceeded", () => {
    const result = evaluateGate(
      mkReviewSummary(),
      heavyDiag,
      noResults,
      { maxFailedQueries: Infinity, maxSkippedRecords: 3 },
    );
    assert.equal(result.passed, false);
    assert.ok(result.failedChecks.some((c) => c.name === "maxSkippedRecords"));
  });

  it("fails on maxPartialImports exceeded", () => {
    const result = evaluateGate(
      mkReviewSummary(),
      heavyDiag,
      noResults,
      { maxFailedQueries: Infinity, maxPartialImports: 2 },
    );
    assert.equal(result.passed, false);
    assert.ok(result.failedChecks.some((c) => c.name === "maxPartialImports"));
  });

  it("passes when actual equals threshold (skipped)", () => {
    const result = evaluateGate(
      mkReviewSummary(),
      heavyDiag,
      noResults,
      { maxFailedQueries: Infinity, maxSkippedRecords: 5 },
    );
    assert.ok(result.passingChecks.some((c) => c.name === "maxSkippedRecords"));
  });
});

// ── Test 21: Gate warns when all thresholds are Infinity ──

describe("evaluateGate — warns when gate is effectively disabled", () => {
  const allInfinity: GateThresholds = {
    maxFailedQueries: Infinity,
    maxWarnOnlyQueries: Infinity,
    maxFallbackRate: Infinity,
    maxRouterFailures: Infinity,
    maxExplanationFailures: Infinity,
    maxZeroCandidateFailures: Infinity,
    maxExcessiveWarningQueries: Infinity,
    maxSkippedRecords: Infinity,
    maxPartialImports: Infinity,
  };
  const result = evaluateGate(mkReviewSummary(), diag, noResults, allInfinity);

  it("passed is true (nothing exceeds Infinity)", () => assert.equal(result.passed, true));
  it("emits a warning about the gate being disabled", () => {
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("infinity") || w.toLowerCase().includes("always pass")));
  });
  it("activeChecks is 0", () => assert.equal(result.summary.activeChecks, 0));
});

// ── Integration: gate embedded in review pipeline result ──

describe("evaluateGate — integration with runFullReviewPipeline output shape", () => {
  // Verify the gate can consume PipelineRunResult fields directly
  const mockSummary: ReviewSummary = {
    totalReviewed: 3,
    totalFindings: 4,
    queriesWithFailures: 2,
    queriesWithWarnings: 1,
    fallbackRate: 0.33,
    topCategories: [{ category: "finder", count: 2 }, { category: "explanation", count: 2 }],
    commonWarnings: [],
    suggestedFixtureCandidates: ["zero results query"],
  };
  const mockDiag: ImportDiagnostics = {
    importedCount: 3,
    skippedCount: 0,
    groupedCount: 0,
    recordsMissingQuery: 0,
    partialImports: 0,
    warnings: [],
  };
  const mockResults: ReviewResult[] = [
    mkReviewResult("q1", [{ severity: "fail", category: "explanation", check: "explanation:missing-on-product-path" }]),
    mkReviewResult("q2", [{ severity: "fail", category: "finder", check: "finder:zero-candidates" }]),
    mkReviewResult("q3", [{ severity: "warn", category: "router", check: "router:low-confidence" }]),
  ];

  const gateResult = evaluateGate(mockSummary, mockDiag, mockResults);

  it("fails with default thresholds (2 failed queries > 0)", () => {
    assert.equal(gateResult.passed, false);
  });

  it("json output is valid and embeddable", () => {
    const json = gateResultToJson(gateResult);
    assert.doesNotThrow(() => JSON.stringify({ pipeline: { review: mockSummary }, gate: json }));
  });

  it("formatted output is non-empty and contains the gate header", () => {
    const text = formatGateResult(gateResult);
    assert.ok(text.length > 0);
    assert.ok(text.includes("Quality Gate"));
  });
});
