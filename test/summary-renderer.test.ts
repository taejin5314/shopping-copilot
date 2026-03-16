/**
 * Tests for scripts/summary-renderer.ts and scripts/summary-writer.ts.
 *
 * All tests are deterministic and side-effect free except for the writer
 * tests, which write to a temp file in os.tmpdir() and clean up afterward.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { renderJobSummary } from "../scripts/summary-renderer.js";
import { resolveSummaryTarget, writeSummary } from "../scripts/summary-writer.js";
import type { PipelineRunResult } from "../scripts/review-pipeline.js";
import type { GateResult } from "../scripts/quality-gate.js";
import type { ReviewSummary } from "./quality-review.js";
import type { ImportDiagnostics } from "./log-importer.js";
import type { SuggestionSummary } from "./fixture-suggester.js";

// ── Fixture builders ──

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

function mkSuggestionSummary(overrides: Partial<SuggestionSummary> = {}): SuggestionSummary {
  return {
    total: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    needingManualReview: 0,
    topReasonCategories: [],
    ...overrides,
  };
}

function mkPipelineResult(overrides: Partial<PipelineRunResult> = {}): PipelineRunResult {
  return {
    importedRecords: [],
    importDiagnostics: mkImportDiagnostics(),
    reviewResults: [],
    reviewSummary: mkReviewSummary(),
    suggestions: [],
    suggestionSummary: mkSuggestionSummary(),
    ...overrides,
  };
}

function mkGateResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    passed: true,
    failedChecks: [],
    passingChecks: [
      {
        name: "maxFailedQueries",
        threshold: 0,
        actual: 0,
        passed: true,
        message: "0 queries with failure-severity findings",
        hint: "--max-failed=<N>",
      },
    ],
    warnings: [],
    summary: { totalChecks: 9, failedChecks: 0, passingChecks: 9, activeChecks: 1 },
    ...overrides,
  };
}

// ── renderJobSummary — no gate ──

describe("renderJobSummary — no gate", () => {
  it("contains Quality Review heading", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(md.includes("## ✅ Quality Review"), `heading not found in:\n${md}`);
  });

  it("contains Review Summary section", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(md.includes("### Review Summary"));
  });

  it("shows reviewed count", () => {
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({ totalReviewed: 7 }),
    }));
    assert.ok(md.includes("| Reviewed | 7 |"), `count not found in:\n${md}`);
  });

  it("shows imported count", () => {
    const md = renderJobSummary(mkPipelineResult({
      importDiagnostics: mkImportDiagnostics({ importedCount: 7 }),
    }));
    assert.ok(md.includes("| Imported | 7 |"));
  });

  it("shows fallback rate as percentage", () => {
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({ fallbackRate: 0.33 }),
    }));
    assert.ok(md.includes("| Fallback rate (Route B) | 33% |"), `rate not found in:\n${md}`);
  });

  it("shows fixture suggestion count", () => {
    const md = renderJobSummary(mkPipelineResult({
      suggestionSummary: mkSuggestionSummary({ total: 3, needingManualReview: 1 }),
    }));
    assert.ok(md.includes("| Fixture suggestions | 3 (1 need review) |"));
  });

  it("does not show skipped row when skippedCount is 0", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(!md.includes("| Skipped |"));
  });

  it("shows skipped row when skippedCount > 0", () => {
    const md = renderJobSummary(mkPipelineResult({
      importDiagnostics: mkImportDiagnostics({ skippedCount: 2 }),
    }));
    assert.ok(md.includes("| Skipped | 2 |"));
  });

  it("does not show partial imports row when 0", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(!md.includes("| Partial imports |"));
  });

  it("shows partial imports row when > 0", () => {
    const md = renderJobSummary(mkPipelineResult({
      importDiagnostics: mkImportDiagnostics({ partialImports: 1 }),
    }));
    assert.ok(md.includes("| Partial imports | 1 |"));
  });

  it("shows top categories when present", () => {
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({
        topCategories: [{ category: "router", count: 3 }],
      }),
    }));
    assert.ok(md.includes("### Top Issue Categories"));
    assert.ok(md.includes("`router`: 3"));
  });

  it("omits top categories section when empty", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(!md.includes("### Top Issue Categories"));
  });

  it("shows common warnings when present", () => {
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({
        commonWarnings: [{ warning: "no location provided", count: 4 }],
      }),
    }));
    assert.ok(md.includes("### Common Warnings"));
    assert.ok(md.includes("no location provided (×4)"));
  });

  it("omits common warnings section when empty", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(!md.includes("### Common Warnings"));
  });

  it("does not show Gate Checks section without gate", () => {
    const md = renderJobSummary(mkPipelineResult());
    assert.ok(!md.includes("### ✅ Gate Checks"));
    assert.ok(!md.includes("### ❌ Failed Checks"));
  });
});

// ── renderJobSummary — gate passed ──

describe("renderJobSummary — gate passed", () => {
  it("heading shows PASSED", () => {
    const md = renderJobSummary(mkPipelineResult(), mkGateResult());
    assert.ok(md.includes("## ✅ Quality Gate — PASSED"), `heading not found in:\n${md}`);
  });

  it("shows passing gate checks table for finite-threshold checks", () => {
    const md = renderJobSummary(mkPipelineResult(), mkGateResult());
    assert.ok(md.includes("### ✅ Gate Checks"));
    assert.ok(md.includes("`maxFailedQueries`"));
  });

  it("omits Gate Checks section when no finite-threshold passing checks", () => {
    const gate = mkGateResult({
      passingChecks: [
        {
          name: "maxWarnOnlyQueries",
          threshold: Infinity,
          actual: 0,
          passed: true,
          message: "0 warn-only queries",
          hint: "--max-warn=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(!md.includes("### ✅ Gate Checks"));
  });

  it("does not show Failed Checks section when gate passes", () => {
    const md = renderJobSummary(mkPipelineResult(), mkGateResult());
    assert.ok(!md.includes("### ❌ Failed Checks"));
  });
});

// ── renderJobSummary — gate failed ──

describe("renderJobSummary — gate failed", () => {
  it("heading shows FAILED with ❌", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 2,
          passed: false,
          message: "2 queries with failure-severity findings",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("## ❌ Quality Gate — FAILED"), `heading not found:\n${md}`);
  });

  it("failed checks section appears", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 3,
          passed: false,
          message: "3 queries with failure-severity findings",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("### ❌ Failed Checks"));
  });

  it("failed check name appears in table", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 2,
          passed: false,
          message: "2 queries with failure-severity findings",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("`maxFailedQueries`"), `check name not found:\n${md}`);
  });

  it("override hint appears in failed checks table", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 1,
          passed: false,
          message: "1 query with failure-severity findings",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("`--max-failed=<N>`"));
  });

  it("actual value is bolded in failed checks", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 4,
          passed: false,
          message: "4 queries",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("**4**"), `bold actual not found:\n${md}`);
  });

  it("fallback rate failure is shown as percentage", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFallbackRate",
          threshold: 0.3,
          actual: 0.75,
          passed: false,
          message: "75.0% of queries used Route B fallback",
          hint: "--max-fallback=<0-1>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("**75.0%**"), `percentage not found:\n${md}`);
  });

  it("multiple failed checks all appear", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 2,
          passed: false,
          message: "2 queries",
          hint: "--max-failed=<N>",
        },
        {
          name: "maxFallbackRate",
          threshold: 0.3,
          actual: 0.8,
          passed: false,
          message: "80.0% fallback",
          hint: "--max-fallback=<0-1>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("`maxFailedQueries`"));
    assert.ok(md.includes("`maxFallbackRate`"));
  });

  it("does not show Gate Checks (passing) section when gate failed", () => {
    const gate = mkGateResult({
      passed: false,
      failedChecks: [
        {
          name: "maxFailedQueries",
          threshold: 0,
          actual: 1,
          passed: false,
          message: "1 query",
          hint: "--max-failed=<N>",
        },
      ],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(!md.includes("### ✅ Gate Checks"));
  });
});

// ── renderJobSummary — gate warnings ──

describe("renderJobSummary — gate meta-warnings", () => {
  it("gate warnings appear as blockquotes", () => {
    const gate = mkGateResult({
      warnings: ["All thresholds are set to Infinity — gate will always pass."],
    });
    const md = renderJobSummary(mkPipelineResult(), gate);
    assert.ok(md.includes("> **Note:**"), `blockquote not found:\n${md}`);
    assert.ok(md.includes("All thresholds"));
  });

  it("no Note blockquote when gate has no warnings", () => {
    const md = renderJobSummary(mkPipelineResult(), mkGateResult());
    assert.ok(!md.includes("> **Note:**"));
  });
});

// ── renderJobSummary — zero/empty data ──

describe("renderJobSummary — empty/zero data", () => {
  it("renders without throwing on all-zero summary", () => {
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({
        totalReviewed: 0,
        totalFindings: 0,
        queriesWithFailures: 0,
        queriesWithWarnings: 0,
        fallbackRate: 0,
      }),
      importDiagnostics: mkImportDiagnostics({
        importedCount: 0,
        skippedCount: 0,
        partialImports: 0,
      }),
    }));
    assert.ok(typeof md === "string" && md.length > 0);
    assert.ok(md.includes("| Reviewed | 0 |"));
    assert.ok(md.includes("| Imported | 0 |"));
  });

  it("renders with null gate (gate not enabled)", () => {
    const md = renderJobSummary(mkPipelineResult(), null);
    assert.ok(md.includes("## ✅ Quality Review"));
    assert.ok(!md.includes("Gate"));
  });

  it("top categories capped at 5", () => {
    const cats = Array.from({ length: 8 }, (_, i) => ({
      category: `cat-${i}`,
      count: 8 - i,
    }));
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({ topCategories: cats }),
    }));
    // Should contain cat-0 through cat-4 but not cat-5 through cat-7
    assert.ok(md.includes("`cat-4`"));
    assert.ok(!md.includes("`cat-5`"));
  });

  it("common warnings capped at 5", () => {
    const warns = Array.from({ length: 7 }, (_, i) => ({
      warning: `warning text ${i}`,
      count: i + 2,
    }));
    const md = renderJobSummary(mkPipelineResult({
      reviewSummary: mkReviewSummary({ commonWarnings: warns }),
    }));
    assert.ok(md.includes("warning text 4"));
    assert.ok(!md.includes("warning text 5"));
  });
});

// ── resolveSummaryTarget ──

describe("resolveSummaryTarget", () => {
  it("returns none when no flag and no env", () => {
    const t = resolveSummaryTarget([], {});
    assert.equal(t.kind, "none");
  });

  it("returns github when GITHUB_STEP_SUMMARY is set", () => {
    const t = resolveSummaryTarget([], { GITHUB_STEP_SUMMARY: "/tmp/summary.md" });
    assert.equal(t.kind, "github");
  });

  it("returns file when --summary-file flag provided", () => {
    const t = resolveSummaryTarget(["--summary-file=/tmp/out.md"], {});
    assert.deepEqual(t, { kind: "file", path: "/tmp/out.md" });
  });

  it("--summary-file takes priority over GITHUB_STEP_SUMMARY", () => {
    const t = resolveSummaryTarget(
      ["--summary-file=/tmp/out.md"],
      { GITHUB_STEP_SUMMARY: "/tmp/gh.md" },
    );
    assert.deepEqual(t, { kind: "file", path: "/tmp/out.md" });
  });

  it("ignores unrelated flags", () => {
    const t = resolveSummaryTarget(["--verbose", "--gate", "--max-failed=0"], {});
    assert.equal(t.kind, "none");
  });
});

// ── writeSummary ──

describe("writeSummary", () => {
  let tmpFile: string;

  before(() => {
    tmpFile = join(tmpdir(), `summary-writer-test-${Date.now()}.md`);
    // Ensure file does not exist before tests
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  after(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  it("returns null (no-op) when target is none", () => {
    const err = writeSummary("# Hello", { kind: "none" });
    assert.equal(err, null);
  });

  it("writes markdown to a file target", () => {
    const err = writeSummary("# Test Summary\n", { kind: "file", path: tmpFile });
    assert.equal(err, null);
    const content = readFileSync(tmpFile, "utf8");
    assert.ok(content.includes("# Test Summary"));
  });

  it("appends on subsequent writes", () => {
    const err2 = writeSummary("## Second Section\n", { kind: "file", path: tmpFile });
    assert.equal(err2, null);
    const content = readFileSync(tmpFile, "utf8");
    assert.ok(content.includes("# Test Summary"));
    assert.ok(content.includes("## Second Section"));
  });

  it("returns Error (does not throw) when path is not writable", () => {
    const err = writeSummary("# Hello", { kind: "file", path: "/nonexistent/dir/out.md" });
    assert.ok(err instanceof Error, "expected an Error to be returned");
  });

  it("writes via github target using env", () => {
    const ghFile = join(tmpdir(), `summary-gh-test-${Date.now()}.md`);
    try {
      const err = writeSummary("# GH Summary\n", { kind: "github" }, { GITHUB_STEP_SUMMARY: ghFile });
      assert.equal(err, null);
      const content = readFileSync(ghFile, "utf8");
      assert.ok(content.includes("# GH Summary"));
    } finally {
      if (existsSync(ghFile)) unlinkSync(ghFile);
    }
  });

  it("returns null when github target but env var is empty", () => {
    const err = writeSummary("# Hello", { kind: "github" }, { GITHUB_STEP_SUMMARY: "" });
    assert.equal(err, null);
  });
});
