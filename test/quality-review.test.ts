/**
 * Quality review heuristics tests.
 *
 * Tests every individual heuristic in isolation, then tests batch review
 * (summary aggregation, common-warning detection, fixture candidate suggestion).
 * All deterministic — no LLM, no network, no adapters.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reviewSingleInput,
  runQualityReview,
  buildReviewSummary,
  logReviewFindings,
} from "./quality-review.js";
import type { PipelineReviewInput, ReviewFinding, ReviewResult } from "./quality-review.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ExplanationOutput } from "../src/domain/explanation.js";

// ── Fixture builders ──

function makeRouter(overrides: Partial<RouterOutput> = {}): RouterOutput {
  return {
    intent: "search_product",
    retailerScope: "all",
    locationRequired: false,
    locationProvided: false,
    itemCardinality: "single",
    nextAgent: "query_understanding",
    confidence: 0.9,
    warnings: [],
    reasoningSummary: "Standard product search.",
    ...overrides,
  };
}

function makeQU(overrides: Partial<QueryUnderstandingOutput> = {}): QueryUnderstandingOutput {
  return {
    category: "sofa",
    keywords: ["sofa", "comfortable"],
    budgetMin: null,
    budgetMax: null,
    color: null,
    size: null,
    material: null,
    style: null,
    retailerPreference: "all",
    mustBeInStock: false,
    locationTerms: [],
    itemCardinality: "single",
    warnings: [],
    ...overrides,
  };
}

function makeExplanation(overrides: Partial<ExplanationOutput> = {}): ExplanationOutput {
  return {
    summary: "Found 2 sofas matching your search.",
    explanationPoints: ["Keywords matched: sofa."],
    warnings: [],
    metadata: {
      retailerScope: null,
      routerConfidence: 0.9,
      topCandidateScore: 0.8,
      budgetStatus: null,
      attributesMatched: [],
      attributesMissed: [],
      variantGroupingApplied: false,
      inputSource: "finderCandidates",
      fallbackUsed: false,
      candidateCount: 2,
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<PipelineReviewInput> = {}): PipelineReviewInput {
  return {
    query: "comfortable sofa",
    routerUsed: true,
    routerOutput: makeRouter(),
    quUsed: true,
    queryUnderstandingOutput: makeQU(),
    finderCandidateCount: 2,
    topCandidateScore: 0.8,
    explanation: makeExplanation(),
    inputSource: "finderCandidates",
    isCartIntent: false,
    warnings: [],
    ...overrides,
  };
}

// ── Helper: find a finding by check name ──

function findByCheck(findings: ReviewFinding[], check: string): ReviewFinding | undefined {
  return findings.find((f) => f.check === check);
}

function assertFinding(findings: ReviewFinding[], check: string, severity: "info" | "warn" | "fail"): void {
  const f = findByCheck(findings, check);
  assert.ok(f, `Finding "${check}" not found in [${findings.map((x) => x.check).join(", ")}]`);
  assert.equal(f.severity, severity,
    `Finding "${check}": expected ${severity}, got ${f.severity} — "${f.message}"`);
}

function assertNoFinding(findings: ReviewFinding[], check: string): void {
  const f = findByCheck(findings, check);
  assert.ok(!f, `Finding "${check}" should not be present but was: "${f?.message}"`);
}

// ────────────────────────────────────────────────
// Healthy query — no findings (or only expected info)
// ────────────────────────────────────────────────

describe("quality-review: healthy query", () => {
  it("produces no warn or fail findings for a fully clean Route A run", () => {
    const findings = reviewSingleInput(makeInput());
    const bad = findings.filter((f) => f.severity !== "info");
    assert.equal(bad.length, 0,
      `Unexpected warn/fail findings: ${JSON.stringify(bad)}`);
  });

  it("produces no findings at all for a clean Route A run with no info", () => {
    const findings = reviewSingleInput(makeInput());
    // Route A, no fallback → no path:fallback-used info finding
    assertNoFinding(findings, "path:fallback-used");
  });
});

// ────────────────────────────────────────────────
// Router heuristics
// ────────────────────────────────────────────────

describe("quality-review: router:low-confidence", () => {
  it("produces warn for confidence below 0.7", () => {
    const findings = reviewSingleInput(makeInput({ routerOutput: makeRouter({ confidence: 0.45 }) }));
    assertFinding(findings, "router:low-confidence", "warn");
  });

  it("does not produce warn for confidence at exactly 0.7", () => {
    const findings = reviewSingleInput(makeInput({ routerOutput: makeRouter({ confidence: 0.7 }) }));
    assertNoFinding(findings, "router:low-confidence");
  });

  it("does not produce warn for high-confidence router", () => {
    const findings = reviewSingleInput(makeInput({ routerOutput: makeRouter({ confidence: 0.95 }) }));
    assertNoFinding(findings, "router:low-confidence");
  });

  it("includes confidence value in metadata", () => {
    const findings = reviewSingleInput(makeInput({ routerOutput: makeRouter({ confidence: 0.55 }) }));
    const f = findByCheck(findings, "router:low-confidence");
    assert.ok(f?.metadata?.confidence === 0.55);
  });
});

describe("quality-review: router:failed", () => {
  it("produces warn when router was used but returned null", () => {
    const findings = reviewSingleInput(makeInput({ routerUsed: true, routerOutput: null }));
    assertFinding(findings, "router:failed", "warn");
  });

  it("does not produce warn when router was simply not used", () => {
    const findings = reviewSingleInput(makeInput({ routerUsed: false, routerOutput: undefined }));
    assertNoFinding(findings, "router:failed");
  });
});

describe("quality-review: router:qu-scope-mismatch", () => {
  it("produces warn when router scopes to ikea but QU prefers structube", () => {
    const findings = reviewSingleInput(makeInput({
      routerOutput: makeRouter({ retailerScope: "ikea" }),
      queryUnderstandingOutput: makeQU({ retailerPreference: "structube" }),
    }));
    assertFinding(findings, "router:qu-scope-mismatch", "warn");
  });

  it("does not warn when both agree on the same retailer", () => {
    const findings = reviewSingleInput(makeInput({
      routerOutput: makeRouter({ retailerScope: "ikea" }),
      queryUnderstandingOutput: makeQU({ retailerPreference: "ikea" }),
    }));
    assertNoFinding(findings, "router:qu-scope-mismatch");
  });

  it("does not warn when either side is 'all' (no conflict)", () => {
    const findings = reviewSingleInput(makeInput({
      routerOutput: makeRouter({ retailerScope: "ikea" }),
      queryUnderstandingOutput: makeQU({ retailerPreference: "all" }),
    }));
    assertNoFinding(findings, "router:qu-scope-mismatch");
  });
});

// ────────────────────────────────────────────────
// QU heuristics
// ────────────────────────────────────────────────

describe("quality-review: qu:empty-keywords", () => {
  it("produces fail when QU returns empty keywords array", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: makeQU({ keywords: [] }),
    }));
    assertFinding(findings, "qu:empty-keywords", "fail");
  });

  it("does not fail when QU has at least one keyword", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: makeQU({ keywords: ["sofa"] }),
    }));
    assertNoFinding(findings, "qu:empty-keywords");
  });
});

describe("quality-review: qu:empty-category", () => {
  it("produces warn when QU returns empty category", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: makeQU({ category: "" }),
    }));
    assertFinding(findings, "qu:empty-category", "warn");
  });

  it("does not warn for a non-empty category", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: makeQU({ category: "sofa bed" }),
    }));
    assertNoFinding(findings, "qu:empty-category");
  });
});

describe("quality-review: qu:failed", () => {
  it("produces warn when QU was used but returned null (Route B fallback)", () => {
    const findings = reviewSingleInput(makeInput({
      quUsed: true,
      queryUnderstandingOutput: null,
    }));
    assertFinding(findings, "qu:failed", "warn");
  });

  it("does not warn when QU was simply not used", () => {
    const findings = reviewSingleInput(makeInput({
      quUsed: false,
      queryUnderstandingOutput: undefined,
    }));
    assertNoFinding(findings, "qu:failed");
  });
});

// ────────────────────────────────────────────────
// Product Finder heuristics
// ────────────────────────────────────────────────

describe("quality-review: finder:zero-candidates", () => {
  it("produces fail when Route A ran and returned 0 candidates", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: makeQU(),
      finderCandidateCount: 0,
      inputSource: "finderCandidates",
    }));
    assertFinding(findings, "finder:zero-candidates", "fail");
  });

  it("does not fail for 0 candidates on Route B (no QU output)", () => {
    const findings = reviewSingleInput(makeInput({
      queryUnderstandingOutput: null,
      finderCandidateCount: 0,
      inputSource: "foundProducts",
    }));
    assertNoFinding(findings, "finder:zero-candidates");
  });

  it("does not fail when candidates were found", () => {
    const findings = reviewSingleInput(makeInput({ finderCandidateCount: 3 }));
    assertNoFinding(findings, "finder:zero-candidates");
  });
});

describe("quality-review: finder:weak-top-score", () => {
  it("produces warn for top score below 0.5", () => {
    const findings = reviewSingleInput(makeInput({ topCandidateScore: 0.35 }));
    assertFinding(findings, "finder:weak-top-score", "warn");
  });

  it("includes score in metadata", () => {
    const findings = reviewSingleInput(makeInput({ topCandidateScore: 0.3 }));
    const f = findByCheck(findings, "finder:weak-top-score");
    assert.equal(f?.metadata?.score, 0.3);
  });

  it("does not warn for score at exactly 0.5", () => {
    const findings = reviewSingleInput(makeInput({ topCandidateScore: 0.5 }));
    assertNoFinding(findings, "finder:weak-top-score");
  });

  it("does not warn when topCandidateScore is null (no candidates)", () => {
    const findings = reviewSingleInput(makeInput({ topCandidateScore: null }));
    assertNoFinding(findings, "finder:weak-top-score");
  });
});

// ────────────────────────────────────────────────
// Explanation heuristics
// ────────────────────────────────────────────────

describe("quality-review: explanation:missing-on-product-path", () => {
  it("produces fail when inputSource is finderCandidates but explanation is absent", () => {
    const findings = reviewSingleInput(makeInput({
      inputSource: "finderCandidates",
      explanation: null,
    }));
    assertFinding(findings, "explanation:missing-on-product-path", "fail");
  });

  it("does not fail when inputSource is foundProducts (Route B — explanation may differ)", () => {
    const findings = reviewSingleInput(makeInput({
      inputSource: "foundProducts",
      explanation: null,
    }));
    assertNoFinding(findings, "explanation:missing-on-product-path");
  });

  it("does not fail when explanation is present", () => {
    const findings = reviewSingleInput(makeInput({
      inputSource: "finderCandidates",
      explanation: makeExplanation(),
    }));
    assertNoFinding(findings, "explanation:missing-on-product-path");
  });
});

describe("quality-review: explanation:over-budget", () => {
  it("produces info when budgetStatus is way_exceeded", () => {
    const findings = reviewSingleInput(makeInput({
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          budgetStatus: "way_exceeded",
        },
      }),
    }));
    assertFinding(findings, "explanation:over-budget", "info");
  });

  it("does not produce finding for within-budget result", () => {
    const findings = reviewSingleInput(makeInput({
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          budgetStatus: "within",
        },
      }),
    }));
    assertNoFinding(findings, "explanation:over-budget");
  });

  it("does not produce finding when budgetStatus is null", () => {
    const findings = reviewSingleInput(makeInput({
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          budgetStatus: null,
        },
      }),
    }));
    assertNoFinding(findings, "explanation:over-budget");
  });
});

// ────────────────────────────────────────────────
// Path heuristics
// ────────────────────────────────────────────────

describe("quality-review: path:cart-intent-narrowed", () => {
  it("produces fail when cart intent is true but variant grouping was applied", () => {
    const findings = reviewSingleInput(makeInput({
      isCartIntent: true,
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          variantGroupingApplied: true,
        },
      }),
    }));
    assertFinding(findings, "path:cart-intent-narrowed", "fail");
  });

  it("does not fail when cart intent is true and variant grouping is false (correct)", () => {
    const findings = reviewSingleInput(makeInput({
      isCartIntent: true,
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          variantGroupingApplied: false,
        },
      }),
    }));
    assertNoFinding(findings, "path:cart-intent-narrowed");
  });

  it("does not fail when cart intent is false and variant grouping is true (correct for product-discovery)", () => {
    const findings = reviewSingleInput(makeInput({
      isCartIntent: false,
      explanation: makeExplanation({
        metadata: {
          ...makeExplanation().metadata,
          variantGroupingApplied: true,
        },
      }),
    }));
    assertNoFinding(findings, "path:cart-intent-narrowed");
  });
});

describe("quality-review: path:fallback-used", () => {
  it("produces info when Route B (foundProducts) was used", () => {
    const findings = reviewSingleInput(makeInput({ inputSource: "foundProducts" }));
    assertFinding(findings, "path:fallback-used", "info");
  });

  it("does not produce fallback info for Route A", () => {
    const findings = reviewSingleInput(makeInput({ inputSource: "finderCandidates" }));
    assertNoFinding(findings, "path:fallback-used");
  });
});

// ────────────────────────────────────────────────
// Warning accumulation heuristics
// ────────────────────────────────────────────────

describe("quality-review: warnings:excessive", () => {
  it("produces warn when more than 5 warnings are present", () => {
    const findings = reviewSingleInput(makeInput({
      warnings: ["w1", "w2", "w3", "w4", "w5", "w6"],
    }));
    assertFinding(findings, "warnings:excessive", "warn");
  });

  it("does not warn for exactly 5 warnings", () => {
    const findings = reviewSingleInput(makeInput({
      warnings: ["w1", "w2", "w3", "w4", "w5"],
    }));
    assertNoFinding(findings, "warnings:excessive");
  });

  it("does not warn for empty warnings array", () => {
    const findings = reviewSingleInput(makeInput({ warnings: [] }));
    assertNoFinding(findings, "warnings:excessive");
  });

  it("includes count and sample in metadata", () => {
    const warnings = Array.from({ length: 8 }, (_, i) => `warning ${i}`);
    const findings = reviewSingleInput(makeInput({ warnings }));
    const f = findByCheck(findings, "warnings:excessive");
    assert.equal(f?.metadata?.count, 8);
    assert.ok(Array.isArray(f?.metadata?.sample));
  });
});

// ────────────────────────────────────────────────
// Partial / missing input tolerance
// ────────────────────────────────────────────────

describe("quality-review: partial input tolerance", () => {
  it("handles input with only query (all other fields absent)", () => {
    const findings = reviewSingleInput({ query: "sofa" });
    // Should not throw, no fail/warn expected for absent fields
    const bad = findings.filter((f) => f.severity === "fail");
    assert.equal(bad.length, 0);
  });

  it("handles null explanation gracefully (no throw)", () => {
    assert.doesNotThrow(() =>
      reviewSingleInput(makeInput({ explanation: null, inputSource: "foundProducts" }))
    );
  });

  it("handles undefined warnings gracefully", () => {
    assert.doesNotThrow(() =>
      reviewSingleInput({ query: "sofa", warnings: undefined })
    );
  });
});

// ────────────────────────────────────────────────
// runQualityReview — batch runner
// ────────────────────────────────────────────────

describe("quality-review: runQualityReview batch", () => {
  it("returns one ReviewResult per input", () => {
    const inputs = [makeInput(), makeInput({ query: "chair" })];
    const { results } = runQualityReview(inputs);
    assert.equal(results.length, 2);
  });

  it("sets hasFailures correctly", () => {
    const inputs = [
      makeInput(), // clean
      makeInput({ queryUnderstandingOutput: makeQU({ keywords: [] }) }), // qu:empty-keywords = fail
    ];
    const { results } = runQualityReview(inputs);
    assert.equal(results[0].hasFailures, false);
    assert.equal(results[1].hasFailures, true);
  });

  it("sets hasWarnings correctly", () => {
    const inputs = [
      makeInput(), // clean
      makeInput({ routerOutput: makeRouter({ confidence: 0.5 }) }), // router:low-confidence = warn
    ];
    const { results } = runQualityReview(inputs);
    assert.equal(results[0].hasWarnings, false);
    assert.equal(results[1].hasWarnings, true);
  });

  it("does not throw for empty input array", () => {
    const { results, summary } = runQualityReview([]);
    assert.equal(results.length, 0);
    assert.equal(summary.totalReviewed, 0);
  });

  it("does not throw when an input is partially malformed", () => {
    const inputs = [
      { query: "sofa" } as PipelineReviewInput,
      makeInput(),
    ];
    assert.doesNotThrow(() => runQualityReview(inputs));
  });
});

// ────────────────────────────────────────────────
// buildReviewSummary
// ────────────────────────────────────────────────

describe("quality-review: buildReviewSummary aggregation", () => {
  it("counts totalReviewed and totalFindings correctly", () => {
    const results: ReviewResult[] = [
      { input: makeInput(), findings: [], hasFailures: false, hasWarnings: false },
      {
        input: makeInput({ query: "chair" }),
        findings: [
          { severity: "warn", category: "router", check: "router:low-confidence", message: "low" },
          { severity: "fail", category: "qu", check: "qu:empty-keywords", message: "no kw" },
        ],
        hasFailures: true,
        hasWarnings: true,
      },
    ];
    const summary = buildReviewSummary(results);
    assert.equal(summary.totalReviewed, 2);
    assert.equal(summary.totalFindings, 2);
  });

  it("counts queriesWithFailures correctly", () => {
    const results: ReviewResult[] = [
      { input: makeInput(), findings: [], hasFailures: false, hasWarnings: false },
      { input: makeInput({ query: "a" }), findings: [
        { severity: "fail", category: "qu", check: "qu:empty-keywords", message: "" },
      ], hasFailures: true, hasWarnings: false },
      { input: makeInput({ query: "b" }), findings: [
        { severity: "fail", category: "finder", check: "finder:zero-candidates", message: "" },
      ], hasFailures: true, hasWarnings: false },
    ];
    const summary = buildReviewSummary(results);
    assert.equal(summary.queriesWithFailures, 2);
  });

  it("topCategories sorted descending by count", () => {
    const results: ReviewResult[] = [
      {
        input: makeInput(),
        findings: [
          { severity: "warn", category: "router", check: "router:low-confidence", message: "" },
          { severity: "warn", category: "router", check: "router:failed", message: "" },
          { severity: "fail", category: "qu", check: "qu:empty-keywords", message: "" },
        ],
        hasFailures: true,
        hasWarnings: true,
      },
    ];
    const summary = buildReviewSummary(results);
    assert.equal(summary.topCategories[0].category, "router");
    assert.equal(summary.topCategories[0].count, 2);
    assert.equal(summary.topCategories[1].category, "qu");
    assert.equal(summary.topCategories[1].count, 1);
  });

  it("commonWarnings only includes warnings appearing in > 1 input", () => {
    const sharedWarning = "No user location provided — distance scoring was not applied.";
    const results: ReviewResult[] = [
      { input: makeInput({ warnings: [sharedWarning, "unique-a"] }), findings: [], hasFailures: false, hasWarnings: false },
      { input: makeInput({ query: "b", warnings: [sharedWarning, "unique-b"] }), findings: [], hasFailures: false, hasWarnings: false },
      { input: makeInput({ query: "c", warnings: ["only-in-c"] }), findings: [], hasFailures: false, hasWarnings: false },
    ];
    const summary = buildReviewSummary(results);
    assert.equal(summary.commonWarnings.length, 1);
    assert.equal(summary.commonWarnings[0].warning, sharedWarning);
    assert.equal(summary.commonWarnings[0].count, 2);
  });

  it("fallbackRate is correct fraction of foundProducts inputs", () => {
    const results: ReviewResult[] = [
      { input: makeInput({ inputSource: "foundProducts" }), findings: [], hasFailures: false, hasWarnings: false },
      { input: makeInput({ inputSource: "foundProducts" }), findings: [], hasFailures: false, hasWarnings: false },
      { input: makeInput({ inputSource: "finderCandidates" }), findings: [], hasFailures: false, hasWarnings: false },
    ];
    const summary = buildReviewSummary(results);
    assert.ok(Math.abs(summary.fallbackRate - 2 / 3) < 0.001);
  });

  it("fallbackRate is 0 for empty results", () => {
    const summary = buildReviewSummary([]);
    assert.equal(summary.fallbackRate, 0);
  });
});

// ────────────────────────────────────────────────
// suggestedFixtureCandidates
// ────────────────────────────────────────────────

describe("quality-review: suggestedFixtureCandidates", () => {
  it("includes queries with at least one fail finding", () => {
    const { summary } = runQualityReview([
      makeInput({ query: "clean query" }),
      makeInput({
        query: "broken query",
        queryUnderstandingOutput: makeQU({ keywords: [] }),
      }),
    ]);
    assert.ok(summary.suggestedFixtureCandidates.includes("broken query"));
    assert.ok(!summary.suggestedFixtureCandidates.includes("clean query"));
  });

  it("includes queries with 2 or more warn findings", () => {
    const { summary } = runQualityReview([
      makeInput({
        query: "double warn query",
        routerOutput: makeRouter({ confidence: 0.5 }), // router:low-confidence warn
        warnings: ["w1", "w2", "w3", "w4", "w5", "w6"], // warnings:excessive warn
      }),
    ]);
    assert.ok(summary.suggestedFixtureCandidates.includes("double warn query"));
  });

  it("does not include queries with only 1 warn finding", () => {
    const { summary } = runQualityReview([
      makeInput({
        query: "single warn query",
        routerOutput: makeRouter({ confidence: 0.5 }), // only 1 warn
      }),
    ]);
    assert.ok(!summary.suggestedFixtureCandidates.includes("single warn query"));
  });

  it("does not include clean queries (no findings)", () => {
    const { summary } = runQualityReview([makeInput({ query: "clean" })]);
    assert.ok(!summary.suggestedFixtureCandidates.includes("clean"));
  });
});

// ────────────────────────────────────────────────
// End-to-end scenario review
// ────────────────────────────────────────────────

describe("quality-review: realistic scenario batch", () => {
  it("identifies all problem categories across a mixed batch", () => {
    const inputs: PipelineReviewInput[] = [
      // 1. Clean Route A
      makeInput({ query: "sofa under $800" }),
      // 2. Low confidence router
      makeInput({
        query: "something I need",
        routerOutput: makeRouter({ confidence: 0.42 }),
      }),
      // 3. QU returned no keywords
      makeInput({
        query: "thing for room",
        queryUnderstandingOutput: makeQU({ keywords: [], category: "" }),
      }),
      // 4. Route A, 0 candidates
      makeInput({
        query: "obscure product xyz",
        finderCandidateCount: 0,
        inputSource: "finderCandidates",
        explanation: null,
      }),
      // 5. Route B fallback
      makeInput({
        query: "comfortable chair",
        queryUnderstandingOutput: null,
        quUsed: false,
        inputSource: "foundProducts",
        explanation: makeExplanation({ metadata: { ...makeExplanation().metadata, inputSource: "foundProducts", fallbackUsed: true } }),
      }),
      // 6. Warning-heavy session
      makeInput({
        query: "desk near me",
        warnings: ["w1", "w2", "w3", "w4", "w5", "w6", "w7"],
      }),
    ];

    const { results, summary } = runQualityReview(inputs);

    assert.equal(summary.totalReviewed, 6);

    // Low confidence input should have router warn
    const lowConfResult = results.find((r) => r.input.query === "something I need");
    assert.ok(lowConfResult?.findings.some((f) => f.check === "router:low-confidence"));

    // Empty keywords should have QU fail
    const emptyKwResult = results.find((r) => r.input.query === "thing for room");
    assert.ok(emptyKwResult?.findings.some((f) => f.check === "qu:empty-keywords" && f.severity === "fail"));

    // Zero candidates should be fail
    const zeroCandResult = results.find((r) => r.input.query === "obscure product xyz");
    assert.ok(zeroCandResult?.hasFailures);

    // Route B should have path:fallback-used info
    const routeBResult = results.find((r) => r.input.query === "comfortable chair");
    assert.ok(routeBResult?.findings.some((f) => f.check === "path:fallback-used"));

    // Warning-heavy should have warnings:excessive
    const warnHeavyResult = results.find((r) => r.input.query === "desk near me");
    assert.ok(warnHeavyResult?.findings.some((f) => f.check === "warnings:excessive"));

    // Queries with failures should be in suggested fixtures
    assert.ok(summary.suggestedFixtureCandidates.includes("obscure product xyz"));
    assert.ok(summary.suggestedFixtureCandidates.includes("thing for room"));
  });
});

// ────────────────────────────────────────────────
// logReviewFindings
// ────────────────────────────────────────────────

describe("quality-review: logReviewFindings", () => {
  it("does not throw for results with findings", () => {
    const { results } = runQualityReview([
      makeInput({ routerOutput: makeRouter({ confidence: 0.4 }) }),
    ]);
    assert.doesNotThrow(() => logReviewFindings(results));
  });

  it("does not throw for empty results", () => {
    assert.doesNotThrow(() => logReviewFindings([]));
  });
});
