import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeQuery, routeQueryDetailed, RouterOutputSchema } from "../src/llm/router.js";
import type { RouterOutput } from "../src/llm/router.js";
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

const SEARCH_PRODUCT_RESPONSE: RouterOutput = {
  intent: "search_product",
  retailerScope: "all",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.96,
  warnings: [],
  reasoningSummary: "The user is asking for product discovery with constraints, not store-specific availability.",
};

const FIND_BEST_STORE_RESPONSE: RouterOutput = {
  intent: "find_best_store",
  retailerScope: "ikea",
  locationRequired: true,
  locationProvided: true,
  itemCardinality: "single",
  nextAgent: "inventory_store",
  confidence: 0.95,
  warnings: [],
  reasoningSummary: "The user refers to a specific retailer and asks for store-level availability near a location.",
};

const CHECK_CART_RESPONSE: RouterOutput = {
  intent: "check_cart",
  retailerScope: "structube",
  locationRequired: true,
  locationProvided: true,
  itemCardinality: "multiple",
  nextAgent: "inventory_store",
  confidence: 0.98,
  warnings: [],
  reasoningSummary: "The user is asking for multi-item cart feasibility at a retailer near a specific city.",
};

const VAGUE_RESPONSE: RouterOutput = {
  intent: "find_best_store",
  retailerScope: "all",
  locationRequired: true,
  locationProvided: true,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.63,
  warnings: ["The product reference is unclear and may need normalization before store lookup."],
  reasoningSummary: "The request is store-oriented, but the product is not clearly identified enough for direct inventory lookup.",
};

// New edge-case fixtures
const NO_RETAILER_STORE_RESPONSE: RouterOutput = {
  intent: "find_best_store",
  retailerScope: "all",
  locationRequired: true,
  locationProvided: true,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.71,
  warnings: ["The product reference is unclear and may need normalization before store lookup."],
  reasoningSummary: "Store-oriented query without identified product or explicit retailer.",
};

const MULTI_ITEM_AMBIGUOUS_RESPONSE: RouterOutput = {
  intent: "search_product",
  retailerScope: "all",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "multiple",
  nextAgent: "query_understanding",
  confidence: 0.78,
  warnings: ["Multiple product types detected — clarify if this is a cart check or product discovery."],
  reasoningSummary: "Two distinct product types mentioned; treated as product search until cart intent is confirmed.",
};

const RETAILER_MISMATCH_RESPONSE: RouterOutput = {
  intent: "search_product",
  retailerScope: "ikea",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.82,
  warnings: ["Query wording is generic but 'IKEA' was explicitly mentioned — scoping to IKEA only."],
  reasoningSummary: "Explicit retailer mention overrides generic wording.",
};

const HIGH_CONFIDENCE_WITH_WARNINGS_RESPONSE: RouterOutput = {
  intent: "check_cart",
  retailerScope: "structube",
  locationRequired: true,
  locationProvided: false,
  itemCardinality: "multiple",
  nextAgent: "inventory_store",
  confidence: 0.91,
  warnings: ["Location is required for this query but was not detected in the message."],
  reasoningSummary: "Clear cart-check intent at Structube, but no location was provided to filter stores.",
};

// ── Schema validation ──

describe("RouterOutputSchema", () => {
  it("accepts a valid router output", () => {
    const result = RouterOutputSchema.safeParse(SEARCH_PRODUCT_RESPONSE);
    assert.ok(result.success);
  });

  it("rejects unknown intent value", () => {
    const result = RouterOutputSchema.safeParse({ ...SEARCH_PRODUCT_RESPONSE, intent: "buy_now" });
    assert.equal(result.success, false);
  });

  it("rejects unknown retailerScope value", () => {
    const result = RouterOutputSchema.safeParse({ ...SEARCH_PRODUCT_RESPONSE, retailerScope: "walmart" });
    assert.equal(result.success, false);
  });

  it("rejects confidence out of range", () => {
    const result = RouterOutputSchema.safeParse({ ...SEARCH_PRODUCT_RESPONSE, confidence: 1.5 });
    assert.equal(result.success, false);
  });

  it("rejects missing required fields", () => {
    const { intent: _omit, ...without } = SEARCH_PRODUCT_RESPONSE;
    const result = RouterOutputSchema.safeParse(without);
    assert.equal(result.success, false);
  });
});

// ── routeQuery — mock provider ──

describe("routeQuery", () => {
  it("parses search_product routing for a product discovery query", async () => {
    const result = await routeQuery("I want a comfortable sofa bed under $800", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.ok(result);
    assert.equal(result.intent, "search_product");
    assert.equal(result.retailerScope, "all");
    assert.equal(result.locationRequired, false);
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("parses find_best_store routing for an IKEA stock query", async () => {
    const result = await routeQuery("Which IKEA near Vancouver has this desk in stock?", fakeProvider(FIND_BEST_STORE_RESPONSE));
    assert.ok(result);
    assert.equal(result.intent, "find_best_store");
    assert.equal(result.retailerScope, "ikea");
    assert.equal(result.locationRequired, true);
    assert.equal(result.locationProvided, true);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("parses check_cart routing for a Structube multi-item query", async () => {
    const result = await routeQuery("Can I get these 3 items from one Structube store in Toronto?", fakeProvider(CHECK_CART_RESPONSE));
    assert.ok(result);
    assert.equal(result.intent, "check_cart");
    assert.equal(result.retailerScope, "structube");
    assert.equal(result.itemCardinality, "multiple");
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("includes warnings for vague queries", async () => {
    const result = await routeQuery("Where should I buy this near me?", fakeProvider(VAGUE_RESPONSE));
    assert.ok(result);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("product reference"));
    assert.ok(result.confidence < 0.8);
  });

  it("extracts JSON from markdown code fences", async () => {
    const wrapped = "```json\n" + JSON.stringify(SEARCH_PRODUCT_RESPONSE) + "\n```";
    const result = await routeQuery("sofa", fakeProviderText(wrapped));
    assert.ok(result);
    assert.equal(result.intent, "search_product");
  });

  it("returns null when LLM throws", async () => {
    const result = await routeQuery("sofa", throwingProvider());
    assert.equal(result, null);
  });

  it("returns null when response is not valid JSON", async () => {
    const result = await routeQuery("sofa", fakeProviderText("Sorry, I cannot process this."));
    assert.equal(result, null);
  });

  it("returns null when JSON does not match schema", async () => {
    const invalid = { intent: "unknown_intent", confidence: "high" };
    const result = await routeQuery("sofa", fakeProvider(invalid));
    assert.equal(result, null);
  });
});

// ── routeQuery — edge cases ──

describe("routeQuery edge cases", () => {
  it("no retailer + store-oriented query → find_best_store with all scope", async () => {
    const result = await routeQuery("where can I buy this near me?", fakeProvider(NO_RETAILER_STORE_RESPONSE));
    assert.ok(result);
    assert.equal(result.intent, "find_best_store");
    assert.equal(result.retailerScope, "all");
    assert.equal(result.locationRequired, true);
    assert.equal(result.locationProvided, true);
    // no explicit retailer, so nextAgent must be query_understanding (item not identified)
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("ambiguous multi-item wording → multiple cardinality with warning", async () => {
    const result = await routeQuery("bed frame and mattress", fakeProvider(MULTI_ITEM_AMBIGUOUS_RESPONSE));
    assert.ok(result);
    assert.equal(result.itemCardinality, "multiple");
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].toLowerCase().includes("multiple product"));
  });

  it("explicit retailer in query overrides generic wording", async () => {
    const result = await routeQuery("show me some stuff at IKEA", fakeProvider(RETAILER_MISMATCH_RESPONSE));
    assert.ok(result);
    assert.equal(result.retailerScope, "ikea");
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("ikea")));
  });

  it("high confidence with warnings is a valid combination", async () => {
    const result = await routeQuery(
      "Can I get a sofa and bookshelf from one Structube store?",
      fakeProvider(HIGH_CONFIDENCE_WITH_WARNINGS_RESPONSE),
    );
    assert.ok(result);
    assert.ok(result.confidence > 0.9);
    assert.ok(result.warnings.length > 0);
    assert.equal(result.intent, "check_cart");
    // location required but not provided
    assert.equal(result.locationRequired, true);
    assert.equal(result.locationProvided, false);
  });

  it("extracts JSON from response with extra prose before and after code fence", async () => {
    const extra =
      "Here is my routing decision based on the query:\n\n```json\n" +
      JSON.stringify(SEARCH_PRODUCT_RESPONSE) +
      "\n```\n\nI hope this helps you route the request correctly.";
    const result = await routeQuery("sofa", fakeProviderText(extra));
    assert.ok(result);
    assert.equal(result.intent, "search_product");
  });

  it("returns null for empty model response", async () => {
    const result = await routeQuery("sofa", fakeProviderText(""));
    assert.equal(result, null);
  });

  it("returns null for whitespace-only response", async () => {
    const result = await routeQuery("sofa", fakeProviderText("   \n\t  "));
    assert.equal(result, null);
  });

  it("returns null when provider times out", async () => {
    // Provider responds after 100ms; timeout fires at 20ms.
    const result = await routeQuery("sofa", slowProvider(100, SEARCH_PRODUCT_RESPONSE), { timeoutMs: 20 });
    assert.equal(result, null);
  });
});

// ── routeQueryDetailed — failure reasons ──

describe("routeQueryDetailed failure reasons", () => {
  it("returns provider_error when LLM throws", async () => {
    const result = await routeQueryDetailed("sofa", throwingProvider("network error"));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "provider_error");
      assert.ok(result.detail?.includes("network error"));
    }
  });

  it("returns timeout when provider exceeds timeoutMs", async () => {
    const result = await routeQueryDetailed("sofa", slowProvider(100, SEARCH_PRODUCT_RESPONSE), { timeoutMs: 20 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "timeout");
  });

  it("returns empty_response for empty content", async () => {
    const result = await routeQueryDetailed("sofa", fakeProviderText(""));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_response");
  });

  it("returns empty_response for whitespace-only content", async () => {
    const result = await routeQueryDetailed("sofa", fakeProviderText("  \n  "));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty_response");
  });

  it("returns invalid_json when response has no JSON", async () => {
    const result = await routeQueryDetailed("sofa", fakeProviderText("Sorry, I cannot process this request."));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_json");
  });

  it("returns invalid_json when JSON is malformed", async () => {
    const result = await routeQueryDetailed("sofa", fakeProviderText("{intent: broken json,,}"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_json");
  });

  it("returns schema_error when JSON is valid but shape is wrong", async () => {
    const result = await routeQueryDetailed("sofa", fakeProvider({ intent: "fly_to_moon", confidence: "very high" }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "schema_error");
      assert.ok(result.detail && result.detail.length > 0);
    }
  });

  it("returns ok: true on valid response", async () => {
    const result = await routeQueryDetailed("sofa", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.output.intent, "search_product");
  });

  it("provider succeeding within timeoutMs returns ok: true", async () => {
    // Provider responds in 10ms; timeout at 200ms — should succeed.
    const result = await routeQueryDetailed("sofa", slowProvider(10, SEARCH_PRODUCT_RESPONSE), { timeoutMs: 200 });
    assert.equal(result.ok, true);
  });
});

// ── Routing logic: intent → orchestrator mapping ──

describe("routeQuery intent semantics", () => {
  it("find_best_store maps to inventory_store when item is identified", async () => {
    const result = await routeQuery("", fakeProvider(FIND_BEST_STORE_RESPONSE));
    assert.ok(result);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("check_cart maps to inventory_store when cart is identified", async () => {
    const result = await routeQuery("", fakeProvider(CHECK_CART_RESPONSE));
    assert.ok(result);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("search_product maps to query_understanding", async () => {
    const result = await routeQuery("", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.ok(result);
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("reasoningSummary is present and non-empty", async () => {
    const result = await routeQuery("", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.ok(result);
    assert.ok(result.reasoningSummary.length > 0);
  });
});
