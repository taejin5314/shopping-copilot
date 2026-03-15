import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeQuery, RouterOutputSchema } from "../src/llm/router.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { LlmProvider, LlmResponse } from "../src/llm/provider.js";

// ── Helpers ──

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

function throwingProvider(): LlmProvider {
  return {
    complete: async () => { throw new Error("LLM unavailable"); },
  };
}

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
    assert.ok(result !== null);
    assert.equal(result.intent, "search_product");
    assert.equal(result.retailerScope, "all");
    assert.equal(result.locationRequired, false);
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("parses find_best_store routing for an IKEA stock query", async () => {
    const result = await routeQuery("Which IKEA near Vancouver has this desk in stock?", fakeProvider(FIND_BEST_STORE_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.intent, "find_best_store");
    assert.equal(result.retailerScope, "ikea");
    assert.equal(result.locationRequired, true);
    assert.equal(result.locationProvided, true);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("parses check_cart routing for a Structube multi-item query", async () => {
    const result = await routeQuery("Can I get these 3 items from one Structube store in Toronto?", fakeProvider(CHECK_CART_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.intent, "check_cart");
    assert.equal(result.retailerScope, "structube");
    assert.equal(result.itemCardinality, "multiple");
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("includes warnings for vague queries", async () => {
    const result = await routeQuery("Where should I buy this near me?", fakeProvider(VAGUE_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("product reference"));
    assert.ok(result.confidence < 0.8);
  });

  it("extracts JSON from markdown code fences", async () => {
    const wrapped = "```json\n" + JSON.stringify(SEARCH_PRODUCT_RESPONSE) + "\n```";
    const result = await routeQuery("sofa", fakeProviderText(wrapped));
    assert.ok(result !== null);
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

// ── Routing logic: intent → orchestrator mapping ──

describe("routeQuery intent semantics", () => {
  it("find_best_store maps to inventory_store when item is identified", async () => {
    const result = await routeQuery("", fakeProvider(FIND_BEST_STORE_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("check_cart maps to inventory_store when cart is identified", async () => {
    const result = await routeQuery("", fakeProvider(CHECK_CART_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.nextAgent, "inventory_store");
  });

  it("search_product maps to query_understanding", async () => {
    const result = await routeQuery("", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.ok(result !== null);
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("reasoningSummary is present and non-empty", async () => {
    const result = await routeQuery("", fakeProvider(SEARCH_PRODUCT_RESPONSE));
    assert.ok(result !== null);
    assert.ok(result.reasoningSummary.length > 0);
  });
});
