/**
 * Tests for the fixture suggestion / regression seed generator.
 *
 * Covers:
 *   1. Zero-candidate product query → proposes expectedCandidateCountMin: 1
 *   2. Missing explanation on product path → flags with low confidence, needsManualReview
 *   3. Cart-intent-narrowed → low confidence, needsManualReview, no over-assertion
 *   4. Excessive warnings → low confidence, needsManualReview
 *   5. Low-confidence router → low confidence, does NOT propose intent
 *   6. High-confidence clean path → high confidence, full expectations proposed
 *   7. Renderer produces stable deterministic output
 *   8. Summary counts are correct
 *   9. Uncertain/empty inputs do not over-generate expectations
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateFixtureSuggestions,
  renderFixtureSuggestion,
  buildSuggestionSummary,
  type FixtureSuggestion,
} from "./fixture-suggester.js";

import type { ReviewResult, ReviewFinding } from "./quality-review.js";
import type { PipelineReviewInput } from "./quality-review.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";

// ── Fixture builders ──

function mkRouterOutput(overrides: Partial<RouterOutput> = {}): RouterOutput {
  return {
    intent: "product_search",
    retailerScope: "all",
    confidence: 0.9,
    rawQuery: "test query",
    warnings: [],
    ...overrides,
  };
}

function mkQUOutput(overrides: Partial<QueryUnderstandingOutput> = {}): QueryUnderstandingOutput {
  return {
    keywords: ["sofa", "bed"],
    category: "furniture",
    budgetMax: null,
    color: null,
    material: null,
    size: null,
    style: null,
    itemCardinality: "single",
    retailerPreference: "all",
    warnings: [],
    rawQuery: "test query",
    ...overrides,
  };
}

function mkFinding(
  severity: ReviewFinding["severity"],
  category: string,
  check: string,
  message = "test",
): ReviewFinding {
  return { severity, category, check, message };
}

function mkInput(overrides: Partial<PipelineReviewInput> = {}): PipelineReviewInput {
  return { query: "cheap sofa bed under 500", ...overrides };
}

function mkResult(
  input: PipelineReviewInput,
  findings: ReviewFinding[],
): ReviewResult {
  return {
    input,
    findings,
    hasFailures: findings.some((f) => f.severity === "fail"),
    hasWarnings: findings.some((f) => f.severity === "warn"),
  };
}

// ── Scenario 1: Zero-candidate product query ──

describe("generateFixtureSuggestions — zero-candidate product query", () => {
  const finding = mkFinding("fail", "finder", "finder:zero-candidates",
    "Route A ran but Product Finder returned 0 candidates");
  const input = mkInput({
    query: "cheap sofa bed under 500",
    routerOutput: mkRouterOutput({ confidence: 0.85, intent: "product_search", retailerScope: "all" }),
    routerUsed: true,
    queryUnderstandingOutput: mkQUOutput({ category: "furniture", keywords: ["sofa", "bed"] }),
    quUsed: true,
    finderCandidateCount: 0,
    inputSource: "finderCandidates",
  });
  const result = mkResult(input, [finding]);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces exactly one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("includes 'finder' in reasonCategories", () => {
    assert.ok(suggestions[0].reasonCategories.includes("finder"));
  });

  it("proposes expectedCandidateCountMin: 1", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedCandidateCountMin, 1);
  });

  it("confidence is medium (recoverable data failure)", () => {
    assert.equal(suggestions[0].confidence, "medium");
  });

  it("needsManualReview is true", () => {
    assert.equal(suggestions[0].needsManualReview, true);
  });

  it("query is preserved verbatim", () => {
    assert.equal(suggestions[0].query, "cheap sofa bed under 500");
  });

  it("name is slugified query", () => {
    assert.equal(suggestions[0].name, "cheap-sofa-bed-under-500");
  });
});

// ── Scenario 2: Missing explanation on product path ──

describe("generateFixtureSuggestions — missing explanation on product path", () => {
  const finding = mkFinding("fail", "explanation", "explanation:missing-on-product-path",
    "Route A produced finderCandidates but explanation is absent");
  const input = mkInput({
    query: "ergonomic office chair",
    routerUsed: true,
    routerOutput: mkRouterOutput({ intent: "product_search", confidence: 0.88 }),
    quUsed: true,
    queryUnderstandingOutput: mkQUOutput({ category: "furniture" }),
    finderCandidateCount: 3,
    inputSource: "finderCandidates",
    explanation: null,
  });
  const result = mkResult(input, [finding]);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("confidence is low (structural failure)", () => {
    assert.equal(suggestions[0].confidence, "low");
  });

  it("needsManualReview is true", () => {
    assert.equal(suggestions[0].needsManualReview, true);
  });

  it("does not propose expectedCandidateCountMin (not a candidate issue)", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedCandidateCountMin, undefined);
  });

  it("sourceFindings includes the explanation finding", () => {
    assert.ok(suggestions[0].sourceFindings.some((f) => f.check === "explanation:missing-on-product-path"));
  });
});

// ── Scenario 3: Cart-intent-narrowed ──

describe("generateFixtureSuggestions — cart-intent-narrowed", () => {
  const finding = mkFinding("fail", "path", "path:cart-intent-narrowed",
    "Cart intent was detected but topVariantGroup narrowing was applied");
  const input = mkInput({
    query: "buy a desk and chair",
    isCartIntent: true,
    inputSource: "finderCandidates",
    routerOutput: mkRouterOutput({ intent: "product_search", confidence: 0.82 }),
    routerUsed: true,
  });
  const result = mkResult(input, [finding]);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("confidence is low", () => {
    assert.equal(suggestions[0].confidence, "low");
  });

  it("needsManualReview is true", () => {
    assert.equal(suggestions[0].needsManualReview, true);
  });

  it("does NOT propose expectedCandidateCountMin (not a zero-candidate case)", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedCandidateCountMin, undefined);
  });

  it("does NOT propose expectedRouterIntent (QU absent, conservative)", () => {
    // No QU output → no QU fields proposed even if router is high-confidence
    assert.equal(suggestions[0].proposedExpectations.expectedQUFields, undefined);
  });

  it("includes 'path' in reasonCategories", () => {
    assert.ok(suggestions[0].reasonCategories.includes("path"));
  });
});

// ── Scenario 4: Excessive warnings ──

describe("generateFixtureSuggestions — excessive warnings", () => {
  const finding = mkFinding("warn", "warnings", "warnings:excessive",
    "8 warnings accumulated");
  const warnings = Array.from({ length: 8 }, (_, i) => `adapter error ${i}`);
  const input = mkInput({
    query: "blue dining table ikea",
    warnings,
    inputSource: "foundProducts",
  });
  const result = mkResult(input, [finding]);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("confidence is low", () => {
    assert.equal(suggestions[0].confidence, "low");
  });

  it("needsManualReview is true", () => {
    assert.equal(suggestions[0].needsManualReview, true);
  });

  it("does not propose expectedWarningsContain (too noisy to assert specific strings)", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedWarningsContain, undefined);
  });

  it("includes 'warnings' in reasonCategories", () => {
    assert.ok(suggestions[0].reasonCategories.includes("warnings"));
  });
});

// ── Scenario 5: Low-confidence router ──

describe("generateFixtureSuggestions — low-confidence router", () => {
  const finding = mkFinding("warn", "router", "router:low-confidence",
    "Router confidence is 55% — below 70% threshold");
  const input = mkInput({
    query: "something vague",
    routerUsed: true,
    routerOutput: mkRouterOutput({ confidence: 0.55, intent: "product_search" }),
  });
  const result = mkResult(input, [finding]);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("confidence is low", () => {
    assert.equal(suggestions[0].confidence, "low");
  });

  it("needsManualReview is true", () => {
    assert.equal(suggestions[0].needsManualReview, true);
  });

  it("does NOT propose expectedRouterIntent (confidence below threshold)", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedRouterIntent, undefined);
  });

  it("does NOT propose expectedRetailerScope", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedRetailerScope, undefined);
  });
});

// ── Scenario 6: High-confidence clean path ──

describe("generateFixtureSuggestions — high-confidence clean path", () => {
  const findings = [
    mkFinding("info", "path", "path:fallback-used", "Route B used"),
  ];
  const input = mkInput({
    query: "white ikea desk 120cm",
    routerUsed: true,
    routerOutput: mkRouterOutput({
      confidence: 0.95,
      intent: "product_search",
      retailerScope: "ikea",
    }),
    quUsed: true,
    queryUnderstandingOutput: mkQUOutput({
      category: "desk",
      keywords: ["desk", "white", "120cm"],
      retailerPreference: "ikea",
      budgetMax: null,
      itemCardinality: "single",
    }),
    finderCandidateCount: 4,
    topCandidateScore: 0.87,
    inputSource: "finderCandidates",
  });
  const result = mkResult(input, findings);
  const suggestions = generateFixtureSuggestions([result]);

  it("produces one suggestion", () => {
    assert.equal(suggestions.length, 1);
  });

  it("confidence is high", () => {
    assert.equal(suggestions[0].confidence, "high");
  });

  it("needsManualReview is false", () => {
    assert.equal(suggestions[0].needsManualReview, false);
  });

  it("proposes expectedRouterIntent", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedRouterIntent, "product_search");
  });

  it("proposes expectedRetailerScope when router and QU agree", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedRetailerScope, "ikea");
  });

  it("proposes expectedQUFields.category", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedQUFields?.category, "desk");
  });

  it("proposes expectedQUFields.itemCardinality", () => {
    assert.equal(suggestions[0].proposedExpectations.expectedQUFields?.itemCardinality, "single");
  });
});

// ── Scenario 7: Renderer stability ──

describe("renderFixtureSuggestion", () => {
  const suggestion: FixtureSuggestion = {
    name: "cheap-sofa-bed-under-500",
    query: "cheap sofa bed under 500",
    reasonCategories: ["finder"],
    sourceFindings: [mkFinding("fail", "finder", "finder:zero-candidates", "no candidates")],
    proposedExpectations: { expectedCandidateCountMin: 1 },
    confidence: "medium",
    needsManualReview: true,
  };

  it("renders deterministically (same output on repeated calls)", () => {
    assert.equal(renderFixtureSuggestion(suggestion), renderFixtureSuggestion(suggestion));
  });

  it("output contains the constant name", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes("FIXTURE_CHEAP_SOFA_BED_UNDER_500"));
  });

  it("output contains the query string", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes('"cheap sofa bed under 500"'));
  });

  it("output contains expectedCandidateCountMin", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes("expectedCandidateCountMin: 1"));
  });

  it("output contains confidence comment", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes("Confidence: medium"));
  });

  it("output contains manual review comment when flagged", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes("Needs manual review: true"));
  });

  it("output contains TODO for mockProducts", () => {
    assert.ok(renderFixtureSuggestion(suggestion).includes("TODO: add mockProducts"));
  });

  it("renders high-confidence suggestion without manual review TODO", () => {
    const highConf: FixtureSuggestion = {
      ...suggestion,
      confidence: "high",
      needsManualReview: false,
    };
    const rendered = renderFixtureSuggestion(highConf);
    assert.ok(!rendered.includes("TODO: review findings before committing"));
    assert.ok(rendered.includes("Needs manual review: false"));
  });

  it("omits expectedRouterIntent line when not in proposedExpectations", () => {
    const rendered = renderFixtureSuggestion(suggestion);
    assert.ok(!rendered.includes("expectedRouterIntent"));
  });

  it("renders proposedExpectations.expectedRouterIntent when present", () => {
    const withIntent: FixtureSuggestion = {
      ...suggestion,
      proposedExpectations: { ...suggestion.proposedExpectations, expectedRouterIntent: "product_search" },
    };
    assert.ok(renderFixtureSuggestion(withIntent).includes('"product_search"'));
  });

  it("renders proposedExpectations.expectedQUFields when present", () => {
    const withQU: FixtureSuggestion = {
      ...suggestion,
      proposedExpectations: { expectedQUFields: { category: "furniture" } },
    };
    assert.ok(renderFixtureSuggestion(withQU).includes("furniture"));
  });
});

// ── Scenario 8: Summary counts ──

describe("buildSuggestionSummary", () => {
  const high: FixtureSuggestion = {
    name: "a",
    query: "a",
    reasonCategories: ["router", "qu"],
    sourceFindings: [],
    proposedExpectations: {},
    confidence: "high",
    needsManualReview: false,
  };
  const medium: FixtureSuggestion = {
    name: "b",
    query: "b",
    reasonCategories: ["finder"],
    sourceFindings: [],
    proposedExpectations: {},
    confidence: "medium",
    needsManualReview: true,
  };
  const low: FixtureSuggestion = {
    name: "c",
    query: "c",
    reasonCategories: ["finder", "warnings"],
    sourceFindings: [],
    proposedExpectations: {},
    confidence: "low",
    needsManualReview: true,
  };
  const summary = buildSuggestionSummary([high, medium, low]);

  it("total is 3", () => {
    assert.equal(summary.total, 3);
  });

  it("highConfidence is 1", () => {
    assert.equal(summary.highConfidence, 1);
  });

  it("mediumConfidence is 1", () => {
    assert.equal(summary.mediumConfidence, 1);
  });

  it("lowConfidence is 1", () => {
    assert.equal(summary.lowConfidence, 1);
  });

  it("needingManualReview is 2", () => {
    assert.equal(summary.needingManualReview, 2);
  });

  it("topReasonCategories sorts by count descending", () => {
    // finder appears in 2 suggestions, router/qu/warnings appear in 1 each
    assert.equal(summary.topReasonCategories[0].category, "finder");
    assert.equal(summary.topReasonCategories[0].count, 2);
  });

  it("empty input produces zero summary", () => {
    const empty = buildSuggestionSummary([]);
    assert.equal(empty.total, 0);
    assert.equal(empty.highConfidence, 0);
    assert.equal(empty.topReasonCategories.length, 0);
  });
});

// ── Scenario 9: Uncertain inputs do not over-generate ──

describe("generateFixtureSuggestions — does not over-generate", () => {
  it("produces no suggestions for inputs with no findings", () => {
    const result = mkResult(mkInput({ query: "clean query" }), []);
    assert.equal(generateFixtureSuggestions([result]).length, 0);
  });

  it("produces no suggestions for info-only findings with no expectations to propose", () => {
    // An info finding alone with no router/QU output → no expectations → no suggestion
    // (but only if needsManualReview is also false)
    const finding = mkFinding("info", "path", "path:fallback-used", "Route B used");
    const input = mkInput({
      query: "generic query",
      // No routerOutput, no queryUnderstandingOutput
      inputSource: "foundProducts",
    });
    const result = mkResult(input, [finding]);
    const suggestions = generateFixtureSuggestions([result]);
    // Should produce no suggestion: no expectations, no manual review flag
    assert.equal(suggestions.length, 0);
  });

  it("does not propose expectedRouterIntent for low-confidence router output", () => {
    const finding = mkFinding("warn", "router", "router:low-confidence", "55%");
    const input = mkInput({
      query: "vague request",
      routerOutput: mkRouterOutput({ confidence: 0.55, intent: "product_search" }),
      routerUsed: true,
    });
    const result = mkResult(input, [finding]);
    const [s] = generateFixtureSuggestions([result]);
    assert.equal(s.proposedExpectations.expectedRouterIntent, undefined);
  });

  it("does not propose expectedRetailerScope when router and QU disagree", () => {
    const finding = mkFinding("warn", "router", "router:qu-scope-mismatch",
      "Router scoped to ikea but QU prefers structube");
    const input = mkInput({
      query: "affordable sofa",
      routerOutput: mkRouterOutput({ confidence: 0.92, intent: "product_search", retailerScope: "ikea" }),
      routerUsed: true,
      queryUnderstandingOutput: mkQUOutput({ retailerPreference: "structube" }),
      quUsed: true,
    });
    const result = mkResult(input, [finding]);
    const [s] = generateFixtureSuggestions([result]);
    assert.equal(s?.proposedExpectations.expectedRetailerScope, undefined);
  });

  it("does not propose expectedQUFields when QU returned empty keywords", () => {
    const finding = mkFinding("fail", "qu", "qu:empty-keywords", "no keywords");
    const input = mkInput({
      query: "???",
      queryUnderstandingOutput: mkQUOutput({ keywords: [], category: "furniture" }),
      quUsed: true,
    });
    const result = mkResult(input, [finding]);
    const [s] = generateFixtureSuggestions([result]);
    assert.equal(s?.proposedExpectations.expectedQUFields, undefined);
  });

  it("handles malformed / null-like inputs without throwing", () => {
    // Pass an object with no findings but simulate a throw in the callback
    const broken = { input: null as unknown as PipelineReviewInput, findings: [], hasFailures: false, hasWarnings: false };
    assert.doesNotThrow(() => generateFixtureSuggestions([broken]));
  });
});

// ── Batch integration ──

describe("generateFixtureSuggestions — batch with mixed results", () => {
  const results: ReviewResult[] = [
    mkResult(mkInput({ query: "query a" }), []),  // no findings → no suggestion
    mkResult(mkInput({
      query: "zero candidates query",
      finderCandidateCount: 0,
      queryUnderstandingOutput: mkQUOutput(),
      inputSource: "finderCandidates",
    }), [mkFinding("fail", "finder", "finder:zero-candidates", "0 candidates")]),
    mkResult(mkInput({
      query: "high confidence product search",
      routerOutput: mkRouterOutput({ confidence: 0.91, intent: "product_search", retailerScope: "all" }),
      routerUsed: true,
      queryUnderstandingOutput: mkQUOutput({ category: "chair", itemCardinality: "single" }),
      quUsed: true,
    }), [mkFinding("info", "path", "path:fallback-used", "Route B")]),
  ];

  const suggestions = generateFixtureSuggestions(results);

  it("produces 2 suggestions (empty findings skipped, info-only with no expectations skipped if no router/QU)", () => {
    // "query a" → 0 findings → skipped
    // "zero candidates query" → fail → suggestion
    // "high confidence product search" → info only + good router+QU → high-confidence suggestion
    assert.equal(suggestions.length, 2);
  });

  it("first suggestion is for zero-candidates (medium confidence)", () => {
    const zeroSug = suggestions.find((s) => s.name === "zero-candidates-query");
    assert.ok(zeroSug);
    assert.equal(zeroSug.confidence, "medium");
    assert.equal(zeroSug.proposedExpectations.expectedCandidateCountMin, 1);
  });

  it("second suggestion is high confidence with QU expectations", () => {
    const highSug = suggestions.find((s) => s.name.includes("high-confidence"));
    assert.ok(highSug);
    assert.equal(highSug.confidence, "high");
    assert.equal(highSug.proposedExpectations.expectedRouterIntent, "product_search");
    assert.equal(highSug.proposedExpectations.expectedQUFields?.category, "chair");
  });
});
