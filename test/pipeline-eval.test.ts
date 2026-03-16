/**
 * Pipeline evaluation tests — fixture-driven quality measurement.
 *
 * Each test runs a representative shopping scenario through the full deterministic
 * pipeline (Router → QU → Product Finder → Explanation) using mock LLM providers
 * and adapters. No real LLM or retailer API calls are made.
 *
 * Purpose:
 *   - Regression safety: catch regressions in stage composition or explanation logic.
 *   - Coverage of realistic query shapes: budget-constrained, retailer-scoped,
 *     multi-item, over-budget, Route B fallback, low-confidence routing.
 *   - Quality report: all fixtures must pass (report.failed === 0).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runEvalFixture, buildQualityReport } from "./eval-runner.js";
import type { EvalFixture } from "./eval-runner.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ProductInfo } from "../src/core/types.js";

// ── Fixture helpers ──

function makeProduct(overrides: Partial<ProductInfo> & { itemNo: string; name: string }): ProductInfo {
  return {
    retailer: "mock",
    typeName: "Furniture",
    price: { amount: 499, currency: "CAD" },
    url: `https://example.com/${overrides.itemNo}`,
    measureText: null,
    designText: null,
    imageUrl: null,
    ...overrides,
  };
}

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
    category: "furniture",
    keywords: ["furniture"],
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

// ── Fixture definitions ──

const FIXTURE_SOFA_BED: EvalFixture = {
  name: "sofa-bed-under-800",
  query: "I want a comfortable sofa bed under $800",
  mockRouterOutput: makeRouter({ intent: "search_product", retailerScope: "all" }),
  mockQUOutput: makeQU({
    category: "sofa bed",
    keywords: ["sofa bed", "comfortable"],
    budgetMax: 800,
  }),
  mockProducts: [
    makeProduct({ itemNo: "001", name: "LYCKSELE Sofa bed", price: { amount: 699, currency: "CAD" } }),
    makeProduct({ itemNo: "002", name: "FRIHETEN Sofa bed", price: { amount: 1100, currency: "CAD" } }),
  ],
  expectedRouterIntent: "search_product",
  expectedRetailerScope: "all",
  expectedQUFields: { category: "sofa bed", budgetMax: 800, itemCardinality: "single" },
  expectedCandidateCountMin: 2,
  expectedExplanationPointsContain: ["sofa bed"],
};

const FIXTURE_IKEA_WHITE_DESK: EvalFixture = {
  name: "ikea-white-desk-condo",
  query: "white IKEA desk for a small condo",
  mockRouterOutput: makeRouter({ intent: "search_product", retailerScope: "ikea" }),
  mockQUOutput: makeQU({
    category: "desk",
    keywords: ["desk", "white", "small"],
    color: "white",
    retailerPreference: "ikea",
  }),
  mockProducts: [
    makeProduct({ itemNo: "101", name: "MICKE Desk", designText: "white" }),
    makeProduct({ itemNo: "102", name: "MICKE Desk", designText: "black" }),
  ],
  expectedRouterIntent: "search_product",
  expectedRetailerScope: "ikea",
  expectedQUFields: { category: "desk", color: "white", retailerPreference: "ikea" },
  expectedCandidateCountMin: 1,
  expectedExplanationPointsContain: ["color"],
};

const FIXTURE_MULTI_ITEM: EvalFixture = {
  name: "bed-frame-and-mattress",
  query: "bed frame and mattress",
  mockRouterOutput: makeRouter({
    intent: "search_product",
    retailerScope: "all",
    itemCardinality: "multiple",
    warnings: ["Multiple product types detected."],
  }),
  mockQUOutput: makeQU({
    category: "bedroom furniture",
    keywords: ["bed frame", "mattress"],
    itemCardinality: "multiple",
    warnings: ["Multiple distinct product types — clarify if cart or discovery."],
  }),
  mockProducts: [
    makeProduct({ itemNo: "201", name: "MALM Bed frame" }),
    makeProduct({ itemNo: "202", name: "HASVAG Mattress" }),
  ],
  expectedRouterIntent: "search_product",
  expectedQUFields: { itemCardinality: "multiple" },
  expectedCandidateCountMin: 1,
  expectedWarningsContain: ["multiple product"],
};

const FIXTURE_STORE_FINDING: EvalFixture = {
  name: "store-finding-near-me",
  query: "where can I buy this near me",
  mockRouterOutput: makeRouter({
    intent: "find_best_store",
    retailerScope: "all",
    locationRequired: true,
    locationProvided: true,
    confidence: 0.82,
  }),
  // No mockQUOutput → Route B
  mockProducts: [makeProduct({ itemNo: "301", name: "Generic Chair" })],
  expectedRouterIntent: "find_best_store",
};

const FIXTURE_OVER_BUDGET: EvalFixture = {
  name: "over-budget-candidate",
  query: "sofa bed under $500",
  mockRouterOutput: makeRouter({ intent: "search_product" }),
  mockQUOutput: makeQU({
    category: "sofa bed",
    keywords: ["sofa bed"],
    budgetMax: 500,
  }),
  mockProducts: [
    // Way over budget: $900 > $500 * 1.5 → BUDGET_WAY_OVER_PENALTY applied
    makeProduct({ itemNo: "401", name: "FRIHETEN Sofa bed", price: { amount: 900, currency: "CAD" } }),
  ],
  expectedCandidateCountMin: 1,
  expectedExplanationPointsContain: ["exceeds your budget"],
};

const FIXTURE_ROUTE_B: EvalFixture = {
  name: "route-b-fallback",
  query: "comfortable chair",
  // No mockRouterOutput, no mockQUOutput → pure Route B
  mockProducts: [makeProduct({ itemNo: "501", name: "POÄNG Chair" })],
  expectedCandidateCountMin: 1,
};

const FIXTURE_LOW_CONFIDENCE: EvalFixture = {
  name: "low-confidence-router-warning",
  query: "something for the home",
  mockRouterOutput: makeRouter({
    confidence: 0.45,
    warnings: ["Query is very vague."],
  }),
  mockQUOutput: makeQU({
    category: "home decor",
    keywords: ["home", "decor"],
  }),
  mockProducts: [makeProduct({ itemNo: "601", name: "LACK Side table" })],
  expectedWarningsContain: ["confidence"],
};

// All fixtures — used for batch quality report.
const ALL_FIXTURES: EvalFixture[] = [
  FIXTURE_SOFA_BED,
  FIXTURE_IKEA_WHITE_DESK,
  FIXTURE_MULTI_ITEM,
  FIXTURE_STORE_FINDING,
  FIXTURE_OVER_BUDGET,
  FIXTURE_ROUTE_B,
  FIXTURE_LOW_CONFIDENCE,
];

// ── Helper: assert a fixture passes, with a descriptive mismatch message ──

async function assertFixturePasses(fixture: EvalFixture): Promise<void> {
  const result = await runEvalFixture(fixture);
  if (!result.passed) {
    const detail = result.mismatches
      .map((m) => `  [${m.category}] ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
      .join("\n");
    assert.fail(`Fixture "${fixture.name}" failed:\n${detail}`);
  }
}

// ────────────────────────────────────────────────
// Fixture 1: Sofa bed under $800
// ────────────────────────────────────────────────

describe("pipeline-eval: sofa bed under $800", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_SOFA_BED);
  });

  it("router classifies as search_product with all scope", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.equal(result.routerOutput?.intent, "search_product");
    assert.equal(result.routerOutput?.retailerScope, "all");
  });

  it("QU extracts sofa bed category and $800 budget", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.equal(result.quOutput?.category, "sofa bed");
    assert.equal(result.quOutput?.budgetMax, 800);
  });

  it("over-budget product scores lower than within-budget product", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.ok(result.finderResult);
    const [first, second] = result.finderResult.candidates;
    assert.ok(first.matchScore > second.matchScore,
      `Expected within-budget (${first.matchScore}) > over-budget (${second.matchScore})`);
  });

  it("Route A: explanation inputSource is finderCandidates", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.equal(result.stages.finder.route, "A");
    assert.equal(result.explanationOutput.metadata.inputSource, "finderCandidates");
    assert.equal(result.explanationOutput.metadata.fallbackUsed, false);
  });

  it("explanation summary mentions found count", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.ok(result.explanationOutput.summary.includes("2"),
      `Expected count "2" in summary: "${result.explanationOutput.summary}"`);
  });
});

// ────────────────────────────────────────────────
// Fixture 2: White IKEA desk for a condo
// ────────────────────────────────────────────────

describe("pipeline-eval: white IKEA desk for a condo", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_IKEA_WHITE_DESK);
  });

  it("router scopes to ikea", async () => {
    const result = await runEvalFixture(FIXTURE_IKEA_WHITE_DESK);
    assert.equal(result.routerOutput?.retailerScope, "ikea");
  });

  it("QU extracts white color and ikea retailer preference", async () => {
    const result = await runEvalFixture(FIXTURE_IKEA_WHITE_DESK);
    assert.equal(result.quOutput?.color, "white");
    assert.equal(result.quOutput?.retailerPreference, "ikea");
  });

  it("white desk candidate scores higher than black desk (color attribute match)", async () => {
    const result = await runEvalFixture(FIXTURE_IKEA_WHITE_DESK);
    assert.ok(result.finderResult);
    const whiteCand = result.finderResult.candidates.find((c) => c.designText === "white");
    const blackCand = result.finderResult.candidates.find((c) => c.designText === "black");
    assert.ok(whiteCand && blackCand);
    assert.ok(whiteCand.matchScore > blackCand.matchScore,
      `white (${whiteCand.matchScore}) should beat black (${blackCand.matchScore})`);
  });

  it("explanation reports color attribute as matched for white desk", async () => {
    const result = await runEvalFixture(FIXTURE_IKEA_WHITE_DESK);
    assert.ok(result.explanationOutput.metadata.attributesMatched.some((a) => a.includes("color")));
  });
});

// ────────────────────────────────────────────────
// Fixture 3: Bed frame and mattress (multi-item)
// ────────────────────────────────────────────────

describe("pipeline-eval: bed frame and mattress (multi-item)", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_MULTI_ITEM);
  });

  it("both router and QU agree on multiple cardinality", async () => {
    const result = await runEvalFixture(FIXTURE_MULTI_ITEM);
    assert.equal(result.routerOutput?.itemCardinality, "multiple");
    assert.equal(result.quOutput?.itemCardinality, "multiple");
  });

  it("product finder emits multi-item warning", async () => {
    const result = await runEvalFixture(FIXTURE_MULTI_ITEM);
    assert.ok(result.allWarnings.some((w) => w.toLowerCase().includes("multiple product")));
  });

  it("explanation variantGroupingApplied is false for cart intent", async () => {
    const result = await runEvalFixture(FIXTURE_MULTI_ITEM);
    // isCartIntent = true for multiple cardinality → variantGroupingApplied = false
    assert.equal(result.explanationOutput.metadata.variantGroupingApplied, false);
  });
});

// ────────────────────────────────────────────────
// Fixture 4: Store-finding ("where can I buy near me")
// ────────────────────────────────────────────────

describe("pipeline-eval: store-finding near me", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_STORE_FINDING);
  });

  it("router classifies as find_best_store", async () => {
    const result = await runEvalFixture(FIXTURE_STORE_FINDING);
    assert.equal(result.routerOutput?.intent, "find_best_store");
    assert.equal(result.routerOutput?.locationRequired, true);
    assert.equal(result.routerOutput?.locationProvided, true);
  });

  it("no QU output → Route B path", async () => {
    const result = await runEvalFixture(FIXTURE_STORE_FINDING);
    assert.equal(result.stages.finder.route, "B");
    assert.equal(result.quOutput, null);
  });

  it("Route B explanation has fallbackUsed=true", async () => {
    const result = await runEvalFixture(FIXTURE_STORE_FINDING);
    assert.equal(result.explanationOutput.metadata.inputSource, "foundProducts");
    assert.equal(result.explanationOutput.metadata.fallbackUsed, true);
  });
});

// ────────────────────────────────────────────────
// Fixture 5: Over-budget candidate
// ────────────────────────────────────────────────

describe("pipeline-eval: over-budget candidate", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_OVER_BUDGET);
  });

  it("over-budget product still appears as a candidate (not filtered out)", async () => {
    const result = await runEvalFixture(FIXTURE_OVER_BUDGET);
    assert.ok(result.finderResult?.candidates.length === 1);
    assert.equal(result.finderResult?.candidates[0].itemNo, "401");
  });

  it("over-budget product has reduced match score", async () => {
    const result = await runEvalFixture(FIXTURE_OVER_BUDGET);
    const candidate = result.finderResult?.candidates[0];
    assert.ok(candidate);
    // $900 > $500 * 1.5 → WAY_OVER penalty applied → score drops below 0.5
    assert.ok(candidate.matchScore < 0.5,
      `Expected score < 0.5 for way-over-budget product, got ${candidate.matchScore}`);
  });

  it("explanation budget status is way_exceeded", async () => {
    const result = await runEvalFixture(FIXTURE_OVER_BUDGET);
    assert.equal(result.explanationOutput.metadata.budgetStatus, "way_exceeded");
  });

  it("explanation point mentions budget exceedance", async () => {
    const result = await runEvalFixture(FIXTURE_OVER_BUDGET);
    assert.ok(result.explanationOutput.explanationPoints.some((p) =>
      p.toLowerCase().includes("exceeds your budget"),
    ));
  });
});

// ────────────────────────────────────────────────
// Fixture 6: Route B fallback (no Router, no QU)
// ────────────────────────────────────────────────

describe("pipeline-eval: Route B fallback (no Router, no QU)", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_ROUTE_B);
  });

  it("no router and no QU → Route B, router/qu stages marked as fallback", async () => {
    const result = await runEvalFixture(FIXTURE_ROUTE_B);
    assert.equal(result.routerOutput, null);
    assert.equal(result.quOutput, null);
    assert.equal(result.stages.finder.route, "B");
    assert.equal(result.stages.router.fallback, true);
    assert.equal(result.stages.qu.fallback, true);
  });

  it("Route B: explanation built with foundProducts inputSource", async () => {
    const result = await runEvalFixture(FIXTURE_ROUTE_B);
    assert.equal(result.explanationOutput.metadata.inputSource, "foundProducts");
    assert.equal(result.explanationOutput.metadata.fallbackUsed, true);
  });

  it("Route B: explanation summary correctly counts found products", async () => {
    const result = await runEvalFixture(FIXTURE_ROUTE_B);
    // 1 mockProduct → summary should include "1"
    assert.ok(result.explanationOutput.summary.includes("1"),
      `Expected count in summary: "${result.explanationOutput.summary}"`);
  });

  it("Route B: explanation includes keyword-search fallback point", async () => {
    const result = await runEvalFixture(FIXTURE_ROUTE_B);
    assert.ok(result.explanationOutput.explanationPoints.some((p) =>
      p.toLowerCase().includes("keyword search"),
    ), "Route B should explain that attribute filtering was not available");
  });
});

// ────────────────────────────────────────────────
// Fixture 7: Low-confidence router — warning propagation
// ────────────────────────────────────────────────

describe("pipeline-eval: low-confidence router warning propagation", () => {
  it("passes all fixture expectations", async () => {
    await assertFixturePasses(FIXTURE_LOW_CONFIDENCE);
  });

  it("low confidence (0.45) produces a confidence warning in explanation", async () => {
    const result = await runEvalFixture(FIXTURE_LOW_CONFIDENCE);
    assert.ok(result.explanationOutput.warnings.some((w) => w.includes("confidence")));
  });

  it("confidence warning surfaces in allWarnings (merged without duplication)", async () => {
    const result = await runEvalFixture(FIXTURE_LOW_CONFIDENCE);
    const confidenceWarnings = result.allWarnings.filter((w) => w.includes("confidence"));
    assert.ok(confidenceWarnings.length > 0, "confidence warning must be present");
    assert.equal(confidenceWarnings.length, 1, "confidence warning must not be duplicated");
  });

  it("router's own vague-query warning is also in allWarnings", async () => {
    const result = await runEvalFixture(FIXTURE_LOW_CONFIDENCE);
    assert.ok(result.allWarnings.some((w) => w.toLowerCase().includes("vague")));
  });
});

// ────────────────────────────────────────────────
// Quality report — batch regression check
// ────────────────────────────────────────────────

describe("pipeline-eval: quality report", () => {
  it("all fixtures pass (report.failed === 0)", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    const report = buildQualityReport(results);
    if (report.failed > 0) {
      assert.fail(
        `${report.failed}/${report.total} fixtures failed: [${report.failedFixtures.join(", ")}]\n` +
        results
          .filter((r) => !r.passed)
          .flatMap((r) => r.mismatches.map((m) =>
            `  ${r.fixture.name} [${m.category}] ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`))
          .join("\n"),
      );
    }
  });

  it("report totals are internally consistent", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    const report = buildQualityReport(results);
    assert.equal(report.total, ALL_FIXTURES.length);
    assert.equal(report.passed + report.failed, report.total);
    assert.equal(report.failedFixtures.length, report.failed);
  });

  it("report has expected structure fields", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    const report = buildQualityReport(results);
    assert.ok(typeof report.total === "number");
    assert.ok(typeof report.passed === "number");
    assert.ok(typeof report.failed === "number");
    assert.ok(typeof report.routerMismatches === "number");
    assert.ok(typeof report.quMismatches === "number");
    assert.ok(typeof report.candidateCountMismatches === "number");
    assert.ok(typeof report.explanationMismatches === "number");
    assert.ok(typeof report.warningMismatches === "number");
    assert.ok(Array.isArray(report.failedFixtures));
  });

  it("each EvalResult has expected shape", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    for (const r of results) {
      assert.ok(typeof r.passed === "boolean", `${r.fixture.name}: passed must be boolean`);
      assert.ok(Array.isArray(r.mismatches), `${r.fixture.name}: mismatches must be array`);
      assert.ok(Array.isArray(r.allWarnings), `${r.fixture.name}: allWarnings must be array`);
      assert.ok(r.explanationOutput, `${r.fixture.name}: explanationOutput must be present`);
      assert.ok(typeof r.stages.finder.route === "string", `${r.fixture.name}: route must be string`);
    }
  });
});

// ────────────────────────────────────────────────
// Stage observability — verify stage summaries are accurate
// ────────────────────────────────────────────────

describe("pipeline-eval: stage observability", () => {
  it("Route A fixture correctly reports route A in stages", async () => {
    const result = await runEvalFixture(FIXTURE_SOFA_BED);
    assert.equal(result.stages.finder.route, "A");
    assert.equal(result.stages.router.ok, true);
    assert.equal(result.stages.qu.ok, true);
  });

  it("Route B fixture correctly reports route B in stages", async () => {
    const result = await runEvalFixture(FIXTURE_ROUTE_B);
    assert.equal(result.stages.finder.route, "B");
    assert.equal(result.stages.router.fallback, true);
    assert.equal(result.stages.qu.fallback, true);
  });

  it("explanation is always marked as built", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    for (const r of results) {
      assert.equal(r.stages.explanation.built, true, `${r.fixture.name}: explanation must always be built`);
    }
  });

  it("finder candidate count in stages matches actual finderResult", async () => {
    const results = await Promise.all(ALL_FIXTURES.map(runEvalFixture));
    for (const r of results) {
      const actual = r.finderResult?.candidates.length ?? 0;
      assert.equal(r.stages.finder.candidateCount, actual,
        `${r.fixture.name}: stages.finder.candidateCount mismatch`);
    }
  });
});
