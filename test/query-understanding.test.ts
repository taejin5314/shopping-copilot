import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runQueryUnderstanding,
  runQueryUnderstandingDetailed,
  QueryUnderstandingOutputSchema,
} from "../src/llm/query-understanding.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { LlmProvider, LlmResponse } from "../src/llm/provider.js";

// ── Test helpers ──

function fakeProvider(json: object): LlmProvider {
  return {
    complete: async () => ({ content: JSON.stringify(json) } as LlmResponse),
  };
}

function fakeProviderText(text: string): LlmProvider {
  return {
    complete: async () => ({ content: text } as LlmResponse),
  };
}

function throwingProvider(message = "LLM unavailable"): LlmProvider {
  return {
    complete: async () => { throw new Error(message); },
  };
}

function slowProvider(delayMs: number, response: object): LlmProvider {
  return {
    complete: () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ content: JSON.stringify(response) } as LlmResponse), delayMs),
      ),
  };
}

// ── Fixtures ──

const SOFA_BED_RESPONSE: QueryUnderstandingOutput = {
  category: "sofa bed",
  keywords: ["sofa bed", "comfortable", "convertible"],
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

const OAK_DESK_RESPONSE: QueryUnderstandingOutput = {
  category: "desk",
  keywords: ["desk", "home office", "oak", "white"],
  budgetMin: null,
  budgetMax: null,
  color: "white",
  size: "small",
  material: "oak",
  style: null,
  retailerPreference: "all",
  mustBeInStock: true,
  locationTerms: ["near Toronto"],
  itemCardinality: "single",
  warnings: [],
};

const IKEA_DINING_RESPONSE: QueryUnderstandingOutput = {
  category: "dining table",
  keywords: ["dining table", "minimalist", "IKEA"],
  budgetMin: null,
  budgetMax: 500,
  color: null,
  size: null,
  material: null,
  style: "minimalist",
  retailerPreference: "ikea",
  mustBeInStock: false,
  locationTerms: ["in Vancouver"],
  itemCardinality: "single",
  warnings: [],
};

const MULTI_ITEM_RESPONSE: QueryUnderstandingOutput = {
  category: "bedroom furniture",
  keywords: ["bed frame", "mattress"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "multiple",
  warnings: ["Multiple distinct product types detected — clarify if this is a cart check or product discovery."],
};

const STRUCTUBE_CART_RESPONSE: QueryUnderstandingOutput = {
  category: "living room furniture",
  keywords: ["sofa", "coffee table", "Structube"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "structube",
  mustBeInStock: true,
  locationTerms: ["near downtown Toronto"],
  itemCardinality: "multiple",
  warnings: [],
};

const BUDGET_RANGE_RESPONSE: QueryUnderstandingOutput = {
  category: "sofa",
  keywords: ["sofa", "couch"],
  budgetMin: 300,
  budgetMax: 700,
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

const VAGUE_RESPONSE: QueryUnderstandingOutput = {
  category: "",
  keywords: ["comfortable", "seating"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "unknown",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "unknown",
  warnings: ["Category is too vague to search effectively — consider specifying the product type."],
};

const QUEEN_BED_RESPONSE: QueryUnderstandingOutput = {
  category: "bed frame",
  keywords: ["queen bed frame", "bed frame"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: "queen",
  material: null,
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

// ── Schema validation ──

describe("QueryUnderstandingOutputSchema", () => {
  it("accepts a valid output", () => {
    const result = QueryUnderstandingOutputSchema.safeParse(SOFA_BED_RESPONSE);
    assert.ok(result.success);
  });

  it("rejects unknown retailerPreference value", () => {
    const result = QueryUnderstandingOutputSchema.safeParse({ ...SOFA_BED_RESPONSE, retailerPreference: "walmart" });
    assert.equal(result.success, false);
  });

  it("rejects unknown itemCardinality value", () => {
    const result = QueryUnderstandingOutputSchema.safeParse({ ...SOFA_BED_RESPONSE, itemCardinality: "many" });
    assert.equal(result.success, false);
  });

  it("rejects non-boolean mustBeInStock", () => {
    const result = QueryUnderstandingOutputSchema.safeParse({ ...SOFA_BED_RESPONSE, mustBeInStock: "yes" });
    assert.equal(result.success, false);
  });

  it("rejects non-null non-number budgetMax", () => {
    const result = QueryUnderstandingOutputSchema.safeParse({ ...SOFA_BED_RESPONSE, budgetMax: "cheap" });
    assert.equal(result.success, false);
  });

  it("rejects missing required fields", () => {
    const { category: _omit, ...without } = SOFA_BED_RESPONSE;
    const result = QueryUnderstandingOutputSchema.safeParse(without);
    assert.equal(result.success, false);
  });

  it("accepts null for all nullable fields", () => {
    const result = QueryUnderstandingOutputSchema.safeParse({
      ...SOFA_BED_RESPONSE,
      budgetMin: null,
      budgetMax: null,
      color: null,
      size: null,
      material: null,
      style: null,
    });
    assert.ok(result.success);
  });
});

// ── runQueryUnderstanding — mock provider ──

describe("runQueryUnderstanding", () => {
  it("parses budget and category for a sofa bed query", async () => {
    const result = await runQueryUnderstanding(
      "I want a comfortable sofa bed under $800",
      fakeProvider(SOFA_BED_RESPONSE),
    );
    assert.ok(result);
    assert.equal(result.category, "sofa bed");
    assert.equal(result.budgetMax, 800);
    assert.equal(result.budgetMin, null);
    assert.equal(result.mustBeInStock, false);
    assert.equal(result.itemCardinality, "single");
  });

  it("parses attributes, mustBeInStock, and location for an oak desk query", async () => {
    const result = await runQueryUnderstanding(
      "white oak desk for small home office, must be in stock near Toronto",
      fakeProvider(OAK_DESK_RESPONSE),
    );
    assert.ok(result);
    assert.equal(result.category, "desk");
    assert.equal(result.color, "white");
    assert.equal(result.material, "oak");
    assert.equal(result.size, "small");
    assert.equal(result.mustBeInStock, true);
    assert.deepEqual(result.locationTerms, ["near Toronto"]);
  });

  it("parses retailer, style, budget, and location for an IKEA dining table query", async () => {
    const result = await runQueryUnderstanding(
      "IKEA dining table minimalist style under $500 in Vancouver",
      fakeProvider(IKEA_DINING_RESPONSE),
    );
    assert.ok(result);
    assert.equal(result.retailerPreference, "ikea");
    assert.equal(result.style, "minimalist");
    assert.equal(result.budgetMax, 500);
    assert.deepEqual(result.locationTerms, ["in Vancouver"]);
  });

  it("parses multi-item cardinality with warnings for ambiguous multi-product query", async () => {
    const result = await runQueryUnderstanding("bed frame and mattress", fakeProvider(MULTI_ITEM_RESPONSE));
    assert.ok(result);
    assert.equal(result.itemCardinality, "multiple");
    assert.ok(result.warnings.length > 0);
    assert.ok(result.keywords.includes("bed frame"));
    assert.ok(result.keywords.includes("mattress"));
  });

  it("parses Structube cart with location and mustBeInStock", async () => {
    const result = await runQueryUnderstanding(
      "sofa and coffee table from Structube near downtown Toronto",
      fakeProvider(STRUCTUBE_CART_RESPONSE),
    );
    assert.ok(result);
    assert.equal(result.retailerPreference, "structube");
    assert.equal(result.mustBeInStock, true);
    assert.equal(result.itemCardinality, "multiple");
    assert.ok(result.locationTerms.some((t) => t.toLowerCase().includes("toronto")));
  });

  it("parses a budget range (min and max)", async () => {
    const result = await runQueryUnderstanding("sofa between $300 and $700", fakeProvider(BUDGET_RANGE_RESPONSE));
    assert.ok(result);
    assert.equal(result.budgetMin, 300);
    assert.equal(result.budgetMax, 700);
  });

  it("parses size from a queen bed frame query", async () => {
    const result = await runQueryUnderstanding("queen size bed frame", fakeProvider(QUEEN_BED_RESPONSE));
    assert.ok(result);
    assert.equal(result.size, "queen");
    assert.equal(result.category, "bed frame");
  });

  it("includes warnings and unknown cardinality for vague query", async () => {
    const result = await runQueryUnderstanding("something comfy", fakeProvider(VAGUE_RESPONSE));
    assert.ok(result);
    assert.equal(result.category, "");
    assert.equal(result.itemCardinality, "unknown");
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].toLowerCase().includes("vague") || result.warnings[0].toLowerCase().includes("category"));
  });

  it("extracts JSON from markdown code fences", async () => {
    const wrapped = "```json\n" + JSON.stringify(SOFA_BED_RESPONSE) + "\n```";
    const result = await runQueryUnderstanding("sofa bed", fakeProviderText(wrapped));
    assert.ok(result);
    assert.equal(result.category, "sofa bed");
  });

  it("extracts JSON from response with extra prose around code fence", async () => {
    const extra =
      "Here is the normalized query:\n\n```json\n" +
      JSON.stringify(SOFA_BED_RESPONSE) +
      "\n```\n\nI hope this helps.";
    const result = await runQueryUnderstanding("sofa bed", fakeProviderText(extra));
    assert.ok(result);
    assert.equal(result.category, "sofa bed");
  });

  it("returns null when LLM throws", async () => {
    const result = await runQueryUnderstanding("sofa", throwingProvider());
    assert.equal(result, null);
  });

  it("returns null when response is not valid JSON", async () => {
    const result = await runQueryUnderstanding("sofa", fakeProviderText("Sorry, I cannot help with that."));
    assert.equal(result, null);
  });

  it("returns null when JSON does not match schema", async () => {
    const invalid = { category: 42, keywords: "not an array" };
    const result = await runQueryUnderstanding("sofa", fakeProvider(invalid));
    assert.equal(result, null);
  });

  it("returns null for empty model response", async () => {
    const result = await runQueryUnderstanding("sofa", fakeProviderText(""));
    assert.equal(result, null);
  });

  it("returns null for whitespace-only response", async () => {
    const result = await runQueryUnderstanding("sofa", fakeProviderText("   \n\t  "));
    assert.equal(result, null);
  });

  it("returns null when provider times out", async () => {
    const result = await runQueryUnderstanding("sofa", slowProvider(100, SOFA_BED_RESPONSE), { timeoutMs: 20 });
    assert.equal(result, null);
  });
});

// ── runQueryUnderstandingDetailed — failure reasons ──

describe("runQueryUnderstandingDetailed failure reasons", () => {
  it("returns provider_error when LLM throws", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", throwingProvider("network error"));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "provider_error");
      assert.ok(result.detail?.includes("network error"));
    }
  });

  it("returns timeout when provider exceeds timeoutMs", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", slowProvider(100, SOFA_BED_RESPONSE), { timeoutMs: 20 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "timeout");
  });

  it("returns empty_response for empty content", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", fakeProviderText(""));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_response");
  });

  it("returns empty_response for whitespace-only content", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", fakeProviderText("  \n  "));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_response");
  });

  it("returns invalid_json when response has no JSON", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", fakeProviderText("Sorry, I cannot process this."));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_json");
  });

  it("returns invalid_json for malformed JSON", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", fakeProviderText("{category: broken,,}"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_json");
  });

  it("returns schema_error when JSON shape is wrong", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", fakeProvider({ category: 99, keywords: false }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "schema_error");
      assert.ok(result.detail && result.detail.length > 0);
    }
  });

  it("returns ok: true on valid response", async () => {
    const result = await runQueryUnderstandingDetailed("sofa bed", fakeProvider(SOFA_BED_RESPONSE));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.output.category, "sofa bed");
  });

  it("provider succeeding within timeoutMs returns ok: true", async () => {
    const result = await runQueryUnderstandingDetailed("sofa", slowProvider(10, SOFA_BED_RESPONSE), { timeoutMs: 200 });
    assert.equal(result.ok, true);
  });
});

// ── Field extraction semantics ──

describe("QueryUnderstandingOutput field semantics", () => {
  it("keywords array is non-empty for all valid responses", async () => {
    for (const fixture of [SOFA_BED_RESPONSE, OAK_DESK_RESPONSE, IKEA_DINING_RESPONSE, MULTI_ITEM_RESPONSE]) {
      const result = await runQueryUnderstanding("", fakeProvider(fixture));
      assert.ok(result);
      assert.ok(result.keywords.length > 0, `expected keywords for fixture with category="${fixture.category}"`);
    }
  });

  it("mustBeInStock is false by default when not mentioned", async () => {
    const result = await runQueryUnderstanding("", fakeProvider(SOFA_BED_RESPONSE));
    assert.ok(result);
    assert.equal(result.mustBeInStock, false);
  });

  it("locationTerms is empty array when no location mentioned", async () => {
    const result = await runQueryUnderstanding("", fakeProvider(SOFA_BED_RESPONSE));
    assert.ok(result);
    assert.deepEqual(result.locationTerms, []);
  });

  it("budgetMin and budgetMax are both null when no budget mentioned", async () => {
    const result = await runQueryUnderstanding("", fakeProvider(OAK_DESK_RESPONSE));
    assert.ok(result);
    assert.equal(result.budgetMin, null);
    assert.equal(result.budgetMax, null);
  });

  it("both budgetMin and budgetMax populated for a range query", async () => {
    const result = await runQueryUnderstanding("", fakeProvider(BUDGET_RANGE_RESPONSE));
    assert.ok(result);
    assert.ok(typeof result.budgetMin === "number");
    assert.ok(typeof result.budgetMax === "number");
    assert.ok(result.budgetMin! < result.budgetMax!);
  });
});
