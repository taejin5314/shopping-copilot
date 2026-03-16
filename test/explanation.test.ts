/**
 * Tests for src/domain/explanation.ts — deterministic explanation builder.
 *
 * No LLM calls. Every output is derived from fixed structured inputs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExplanation } from "../src/domain/explanation.js";
import type { ExplanationInput } from "../src/domain/explanation.js";
import type { ProductCandidate } from "../src/domain/product-finder.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";

// ── Fixtures ──

function makeCandidate(
  overrides: Partial<ProductCandidate> & { itemNo: string; name: string },
): ProductCandidate {
  return {
    retailer: "ikea",
    productId: overrides.itemNo,
    variantId: null,
    typeName: "Sofa",
    price: 699,
    currency: "CAD",
    url: `https://ikea.com/${overrides.itemNo}`,
    imageUrl: null,
    matchScore: 0.8,
    matchedFromKeywords: [],
    warnings: [],
    measureText: null,
    designText: null,
    ...overrides,
  };
}

const ROUTER_IKEA: RouterOutput = {
  intent: "search_product",
  retailerScope: "ikea",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.92,
  warnings: [],
  reasoningSummary: "IKEA product search.",
};

const ROUTER_ALL: RouterOutput = { ...ROUTER_IKEA, retailerScope: "all", confidence: 0.88 };

const ROUTER_LOW_CONF: RouterOutput = { ...ROUTER_IKEA, retailerScope: "all", confidence: 0.55 };

const QU_SOFA: QueryUnderstandingOutput = {
  category: "sofa",
  keywords: ["sofa", "comfortable"],
  budgetMin: null,
  budgetMax: 800,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

const QU_WHITE_LEATHER: QueryUnderstandingOutput = {
  ...QU_SOFA,
  color: "white",
  material: "leather",
};

const QU_MULTI: QueryUnderstandingOutput = {
  ...QU_SOFA,
  category: "furniture",
  keywords: ["sofa", "desk"],
  itemCardinality: "multiple",
};

// ── buildExplanation — summary ──

describe("buildExplanation — summary", () => {
  it("produces a count+category summary for a single candidate", () => {
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { summary } = buildExplanation(input);
    assert.ok(summary.includes("1"), "includes count");
    assert.ok(summary.toLowerCase().includes("sofa"), "includes category");
  });

  it("summary pluralises for multiple candidates", () => {
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [
        makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
        makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa" }),
      ],
      inputSource: "finderCandidates",
    };
    const { summary } = buildExplanation(input);
    assert.ok(summary.includes("2"));
  });

  it("includes retailer name in summary when scope is specific", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_IKEA,
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { summary } = buildExplanation(input);
    assert.ok(summary.toLowerCase().includes("ikea"), "includes retailer");
  });

  it("summary does not include retailer when scope is all", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_ALL,
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { summary } = buildExplanation(input);
    assert.ok(!summary.toLowerCase().includes("all"), "does not mention 'all'");
  });

  it("falls back to typeName when QU category is absent", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", typeName: "Sofa" })],
      inputSource: "finderCandidates",
    };
    const { summary } = buildExplanation(input);
    assert.ok(summary.toLowerCase().includes("sofa"));
  });

  it("Route B: summary works with no QU and no finderCandidates", () => {
    const input: ExplanationInput = {
      query: "sofa",
      inputSource: "foundProducts",
    };
    // No finderCandidates → count 0 → no-products summary
    const { summary } = buildExplanation(input);
    assert.ok(summary.length > 0);
  });
});

// ── buildExplanation — retailer scope point ──

describe("buildExplanation — retailer scope explanation", () => {
  it("emits scope point when retailer is specific", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_IKEA,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("ikea")));
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("limited")));
  });

  it("no scope point when retailerScope is all", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_ALL,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("limited")));
  });

  it("no scope point when routerOutput is absent", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("limited")));
  });

  it("metadata.retailerScope matches router scope", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_IKEA,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { metadata } = buildExplanation(input);
    assert.equal(metadata.retailerScope, "ikea");
  });
});

// ── buildExplanation — Route B fallback path ──

describe("buildExplanation — Route B fallback explanation", () => {
  it("emits route-fallback point when inputSource is foundProducts", () => {
    const input: ExplanationInput = {
      query: "sofa",
      inputSource: "foundProducts",
      finderCandidates: [],
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("keyword search")));
    assert.ok(metadata.fallbackUsed);
    assert.equal(metadata.inputSource, "foundProducts");
  });

  it("no fallback point when inputSource is finderCandidates", () => {
    const input: ExplanationInput = {
      query: "sofa",
      inputSource: "finderCandidates",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("keyword search")));
    assert.ok(!metadata.fallbackUsed);
  });
});

// ── buildExplanation — budget ──

describe("buildExplanation — budget matching", () => {
  it("within-budget candidate → budget point says within", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", price: 699 });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA, // budgetMax: 800
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("within")));
    assert.equal(metadata.budgetStatus, "within");
  });

  it("over-budget candidate → budget point says over, still included", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", price: 950 });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA, // budgetMax: 800
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("over")));
    assert.equal(metadata.budgetStatus, "exceeded");
    // Candidate is still in finderCandidates — not filtered
    assert.equal(metadata.candidateCount, 1);
  });

  it("way-over-budget (>1.5× budget) → significantly exceeds wording", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "Luxury Sofa", price: 1400 });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA, // budgetMax: 800
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("significantly")));
    assert.equal(metadata.budgetStatus, "way_exceeded");
  });

  it("no budget point when budgetMax is null", () => {
    const quNoBudget: QueryUnderstandingOutput = { ...QU_SOFA, budgetMax: null };
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", price: 999 });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: quNoBudget,
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("budget")));
    assert.equal(metadata.budgetStatus, null);
  });

  it("unknown budget status when candidate price is null", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", price: null });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { metadata } = buildExplanation(input);
    assert.equal(metadata.budgetStatus, "unknown");
  });
});

// ── buildExplanation — attribute match/miss ──

describe("buildExplanation — color and material matching", () => {
  it("matched color attribute appears in explanationPoints and metadata", () => {
    const candidate = makeCandidate({
      itemNo: "D1",
      name: "MICKE Desk",
      typeName: "Desk",
      designText: "white",
    });
    const input: ExplanationInput = {
      query: "white desk",
      queryUnderstandingOutput: { ...QU_SOFA, category: "desk", color: "white", budgetMax: null },
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("matched")));
    assert.ok(metadata.attributesMatched.some((a) => a.includes("white")));
    assert.equal(metadata.attributesMissed.length, 0);
  });

  it("missing color attribute adds missed point and warning-style note", () => {
    const candidate = makeCandidate({
      itemNo: "D1",
      name: "MICKE Desk",
      typeName: "Desk",
      designText: "black",
    });
    const input: ExplanationInput = {
      query: "white desk",
      queryUnderstandingOutput: { ...QU_SOFA, category: "desk", color: "white", budgetMax: null },
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("not found")));
    assert.ok(metadata.attributesMissed.some((a) => a.includes("white")));
    assert.equal(metadata.attributesMatched.length, 0);
  });

  it("missing material adds separate missed point alongside color miss", () => {
    const candidate = makeCandidate({
      itemNo: "S1",
      name: "EKTORP Sofa",
      typeName: "Sofa",
      designText: "beige fabric",
    });
    const input: ExplanationInput = {
      query: "white leather sofa",
      queryUnderstandingOutput: QU_WHITE_LEATHER, // color=white, material=leather
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    // Both color and material should appear in missed
    assert.ok(metadata.attributesMissed.some((a) => a.includes("white")));
    assert.ok(metadata.attributesMissed.some((a) => a.includes("leather")));
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("not found")));
    // Candidate is still present — warnings only, not filtered
    assert.equal(metadata.candidateCount, 1);
  });

  it("no attribute points when QU has no color/material/size/style", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" });
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA, // no color/material/size/style
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("attribute")));
    assert.equal(metadata.attributesMatched.length, 0);
    assert.equal(metadata.attributesMissed.length, 0);
  });
});

// ── buildExplanation — keyword matching ──

describe("buildExplanation — keyword matching", () => {
  it("matched keywords appear in explanationPoints", () => {
    const candidate = makeCandidate({
      itemNo: "S1",
      name: "SÖDERHAMN Sofa",
      matchedFromKeywords: ["sofa", "comfortable"],
    });
    const input: ExplanationInput = {
      query: "comfortable sofa",
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("sofa")));
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("keyword")));
  });

  it("no keyword point when matchedFromKeywords is empty", () => {
    const candidate = makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchedFromKeywords: [] });
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [candidate],
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("keyword")));
  });
});

// ── buildExplanation — variant grouping ──

describe("buildExplanation — variant grouping", () => {
  it("variantGroupingApplied=true → explains designs/colors included", () => {
    const input: ExplanationInput = {
      query: "sofa",
      queryUnderstandingOutput: QU_SOFA,
      finderCandidates: [
        makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", designText: "Beige" }),
        makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa", designText: "Blue" }),
      ],
      variantGroupingApplied: true,
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("design")));
    assert.ok(metadata.variantGroupingApplied);
  });

  it("cart intent (isCartIntent=true) → explains items kept separate", () => {
    const input: ExplanationInput = {
      query: "sofa and desk",
      queryUnderstandingOutput: QU_MULTI,
      finderCandidates: [
        makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
        makeCandidate({ itemNo: "D1", name: "ALEX Desk", typeName: "Desk" }),
      ],
      variantGroupingApplied: false,
      isCartIntent: true,
      inputSource: "finderCandidates",
    };
    const { explanationPoints, metadata } = buildExplanation(input);
    assert.ok(explanationPoints.some((p) => p.toLowerCase().includes("separate")));
    assert.ok(!metadata.variantGroupingApplied);
  });

  it("neither variant nor cart mode → no grouping point", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      variantGroupingApplied: false,
      isCartIntent: false,
      inputSource: "finderCandidates",
    };
    const { explanationPoints } = buildExplanation(input);
    assert.ok(!explanationPoints.some((p) =>
      p.toLowerCase().includes("design") || p.toLowerCase().includes("separate"),
    ));
  });
});

// ── buildExplanation — router confidence warnings ──

describe("buildExplanation — router confidence warnings", () => {
  it("low confidence (<0.7) emits a warning (not a point)", () => {
    const input: ExplanationInput = {
      query: "something vague",
      routerOutput: ROUTER_LOW_CONF, // confidence: 0.55
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { warnings, explanationPoints } = buildExplanation(input);
    assert.ok(warnings.some((w) => w.toLowerCase().includes("confidence")));
    // It's a warning, not an explanation point
    assert.ok(!explanationPoints.some((p) => p.toLowerCase().includes("confidence")));
  });

  it("high confidence (≥0.7) emits no confidence warning", () => {
    const input: ExplanationInput = {
      query: "sofa",
      routerOutput: ROUTER_IKEA, // confidence: 0.92
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
      inputSource: "finderCandidates",
    };
    const { warnings } = buildExplanation(input);
    assert.ok(!warnings.some((w) => w.toLowerCase().includes("confidence")));
  });

  it("router absent → no confidence warning", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
    };
    const { warnings } = buildExplanation(input);
    assert.equal(warnings.length, 0);
  });

  it("metadata.routerConfidence is null when router absent", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" })],
    };
    const { metadata } = buildExplanation(input);
    assert.equal(metadata.routerConfidence, null);
  });
});

// ── buildExplanation — metadata correctness ──

describe("buildExplanation — metadata", () => {
  it("candidateCount reflects finderCandidates length", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [
        makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
        makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa" }),
        makeCandidate({ itemNo: "D1", name: "ALEX Desk" }),
      ],
      inputSource: "finderCandidates",
    };
    assert.equal(buildExplanation(input).metadata.candidateCount, 3);
  });

  it("candidateCount is 0 for Route B (no finderCandidates)", () => {
    const input: ExplanationInput = {
      query: "sofa",
      inputSource: "foundProducts",
    };
    assert.equal(buildExplanation(input).metadata.candidateCount, 0);
  });

  it("topCandidateScore reflects matchScore of first candidate", () => {
    const input: ExplanationInput = {
      query: "sofa",
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchScore: 0.73 })],
      inputSource: "finderCandidates",
    };
    assert.equal(buildExplanation(input).metadata.topCandidateScore, 0.73);
  });

  it("topCandidateScore is null when no candidates", () => {
    const input: ExplanationInput = { query: "sofa", finderCandidates: [] };
    assert.equal(buildExplanation(input).metadata.topCandidateScore, null);
  });

  it("fallbackUsed true for foundProducts, false for finderCandidates", () => {
    const a = buildExplanation({ query: "q", inputSource: "foundProducts" });
    const b = buildExplanation({ query: "q", inputSource: "finderCandidates" });
    assert.ok(a.metadata.fallbackUsed);
    assert.ok(!b.metadata.fallbackUsed);
  });
});

// ── buildExplanation — robustness ──

describe("buildExplanation — robustness", () => {
  it("empty input does not throw", () => {
    assert.doesNotThrow(() => buildExplanation({ query: "sofa" }));
  });

  it("always returns all required output fields", () => {
    const result = buildExplanation({ query: "sofa" });
    assert.ok(typeof result.summary === "string");
    assert.ok(Array.isArray(result.explanationPoints));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(typeof result.metadata === "object");
  });

  it("works with undefined finderCandidates (Route B with no QU)", () => {
    const result = buildExplanation({
      query: "sofa",
      inputSource: "foundProducts",
    });
    assert.equal(result.metadata.candidateCount, 0);
    assert.ok(result.metadata.fallbackUsed);
  });

  it("explanation points list is never null or contains null items", () => {
    const result = buildExplanation({
      query: "sofa",
      routerOutput: ROUTER_IKEA,
      queryUnderstandingOutput: QU_WHITE_LEATHER,
      finderCandidates: [makeCandidate({ itemNo: "S1", name: "EKTORP Sofa", designText: "beige" })],
      variantGroupingApplied: true,
      inputSource: "finderCandidates",
    });
    assert.ok(result.explanationPoints.every((p) => typeof p === "string" && p.length > 0));
  });
});
