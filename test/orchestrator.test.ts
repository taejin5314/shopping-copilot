/**
 * Orchestrator unit tests.
 *
 * These tests use in-memory mock adapters — no MCP server required.
 * They focus on routing logic (intent classification, router overrides)
 * and the ProductCandidate → inventory/store input contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleQuery, buildAutoRankCart } from "../src/orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../src/orchestration/orchestrator.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ProductCandidate } from "../src/domain/product-finder.js";
import { StubRetriever } from "../src/rag/retriever.js";
import type { RetailerAdapter, SearchOpts, FindStoresOpts } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, StoreStock, ProductRef } from "../src/core/types.js";

// ── Mock helpers ──

function makeProduct(overrides: Partial<ProductInfo> & { itemNo: string; name: string }): ProductInfo {
  return {
    retailer: "mock",
    typeName: "Furniture",
    price: { amount: 399, currency: "CAD" },
    url: `https://example.com/${overrides.itemNo}`,
    measureText: null,
    designText: null,
    imageUrl: null,
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ProductCandidate> & { itemNo: string | null; name: string },
): ProductCandidate {
  return {
    retailer: "mock",
    productId: overrides.itemNo ?? overrides.name,
    variantId: null,
    typeName: "Furniture",
    price: 399,
    currency: "CAD",
    url: `https://example.com/${overrides.itemNo ?? overrides.name}`,
    imageUrl: null,
    matchScore: 0.8,
    matchedFromKeywords: [],
    warnings: [],
    measureText: null,
    designText: null,
    ...overrides,
  };
}

/** Adapter that records every findStoresForCart call for assertion. */
interface TrackingAdapter extends RetailerAdapter {
  findStoresCalls: Array<Array<{ itemNo: string; quantity: number }>>;
}

function trackingAdapter(products: ProductInfo[]): TrackingAdapter {
  const findStoresCalls: Array<Array<{ itemNo: string; quantity: number }>> = [];
  return {
    retailerId: "mock",
    findStoresCalls,
    listStores: async (): Promise<StoreRef[]> => [],
    searchProducts: async (_q: string, _o?: SearchOpts): Promise<ProductInfo[]> => products,
    checkStock: async (_i: ProductRef[], _s: string[]): Promise<StoreStock[]> => [],
    findStoresForCart: async (
      items: Array<{ itemNo: string; quantity: number }>,
      _opts?: FindStoresOpts,
    ): Promise<StoreStock[]> => {
      findStoresCalls.push([...items]);
      return [];
    },
  };
}

function mockAdapter(products: ProductInfo[]): RetailerAdapter {
  return trackingAdapter(products);
}

function baseConfig(products: ProductInfo[]): OrchestratorConfig {
  return {
    adapter: mockAdapter(products),
    retriever: new StubRetriever(),
    maxProductResults: 5,
    skipLlmForStructuredResults: true,
  };
}

// ── QU fixtures ──

const QU_SINGLE: QueryUnderstandingOutput = {
  category: "sofa",
  keywords: ["sofa"],
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
};

const QU_MULTIPLE: QueryUnderstandingOutput = {
  ...QU_SINGLE,
  category: "furniture",
  keywords: ["sofa", "desk"],
  itemCardinality: "multiple",
};

// ── Router output fixtures ──

const ROUTER_SEARCH_PRODUCT: RouterOutput = {
  intent: "search_product",
  retailerScope: "all",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.9,
  warnings: [],
  reasoningSummary: "Product search query.",
};

const ROUTER_FIND_STORE: RouterOutput = {
  ...ROUTER_SEARCH_PRODUCT,
  intent: "find_best_store",
  reasoningSummary: "Store-oriented query.",
};

// ────────────────────────────────────────────────
// buildAutoRankCart — unit tests
// ────────────────────────────────────────────────

describe("buildAutoRankCart — product-discovery mode (isCartIntent=false)", () => {
  it("groups same-named variants and excludes unrelated products", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchScore: 0.9 }),
      makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa", matchScore: 0.85 }),
      makeCandidate({ itemNo: "D1", name: "ALEX Desk", matchScore: 0.7 }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: false });
    assert.equal(result.inputSource, "finderCandidates");
    assert.ok(result.variantGroupingApplied);
    // Desk excluded — different product name
    assert.deepEqual(
      result.cart.map((c) => c.itemNo).sort(),
      ["S1", "S2"],
    );
  });

  it("top-scored single product → only that product in cart", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchScore: 0.9 }),
      makeCandidate({ itemNo: "D1", name: "ALEX Desk", matchScore: 0.6 }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: false });
    assert.deepEqual(result.cart.map((c) => c.itemNo), ["S1"]);
    assert.ok(result.variantGroupingApplied);
  });

  it("respects maxVariants cap even within the same variant group", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
      makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa" }),
      makeCandidate({ itemNo: "S3", name: "SÖDERHAMN Sofa" }),
      makeCandidate({ itemNo: "S4", name: "SÖDERHAMN Sofa" }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: false, maxVariants: 2 });
    assert.equal(result.cart.length, 2);
  });

  it("falls back to productId when itemNo is null", () => {
    const candidate = makeCandidate({ productId: "PROD-99", itemNo: null, name: "Test Product" });
    const result = buildAutoRankCart([candidate], [], { isCartIntent: false });
    assert.equal(result.cart[0].itemNo, "PROD-99");
  });

  it("all cart items have quantity=1", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
      makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa" }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: false });
    assert.ok(result.cart.every((c) => c.quantity === 1));
  });
});

describe("buildAutoRankCart — cart-intent mode (isCartIntent=true)", () => {
  it("preserves all distinct product types as separate cart items", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchScore: 0.9 }),
      makeCandidate({ itemNo: "D1", name: "ALEX Desk", matchScore: 0.8 }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: true });
    assert.equal(result.inputSource, "finderCandidates");
    assert.ok(!result.variantGroupingApplied);
    assert.deepEqual(
      result.cart.map((c) => c.itemNo).sort(),
      ["D1", "S1"],
    );
  });

  it("preserves multiple variants of different products separately", () => {
    const candidates = [
      makeCandidate({ itemNo: "S1", name: "SÖDERHAMN Sofa", matchScore: 0.9 }),
      makeCandidate({ itemNo: "S2", name: "SÖDERHAMN Sofa", matchScore: 0.85 }),
      makeCandidate({ itemNo: "D1", name: "ALEX Desk", matchScore: 0.7 }),
    ];
    // Cart intent: sofa-beige, sofa-blue, and desk all preserved
    const result = buildAutoRankCart(candidates, [], { isCartIntent: true });
    assert.deepEqual(
      result.cart.map((c) => c.itemNo).sort(),
      ["D1", "S1", "S2"],
    );
  });

  it("still respects maxVariants cap in cart mode", () => {
    const candidates = [
      makeCandidate({ itemNo: "A", name: "Product A" }),
      makeCandidate({ itemNo: "B", name: "Product B" }),
      makeCandidate({ itemNo: "C", name: "Product C" }),
      makeCandidate({ itemNo: "D", name: "Product D" }),
    ];
    const result = buildAutoRankCart(candidates, [], { isCartIntent: true, maxVariants: 2 });
    assert.equal(result.cart.length, 2);
  });
});

describe("buildAutoRankCart — Route B fallback (no finderCandidates)", () => {
  it("null finderCandidates → uses foundProducts unchanged", () => {
    const products = [
      makeProduct({ itemNo: "P1", name: "Product 1" }),
      makeProduct({ itemNo: "P2", name: "Product 2" }),
    ];
    const result = buildAutoRankCart(null, products, { isCartIntent: false });
    assert.equal(result.inputSource, "foundProducts");
    assert.ok(!result.variantGroupingApplied);
    assert.deepEqual(
      result.cart.map((c) => c.itemNo).sort(),
      ["P1", "P2"],
    );
  });

  it("empty finderCandidates [] → falls through to foundProducts", () => {
    const products = [makeProduct({ itemNo: "P1", name: "Product 1" })];
    const result = buildAutoRankCart([], products, { isCartIntent: false });
    assert.equal(result.inputSource, "foundProducts");
    assert.equal(result.cart[0].itemNo, "P1");
  });

  it("Route B cart mode still returns foundProducts (no candidates to preserve)", () => {
    const products = [
      makeProduct({ itemNo: "P1", name: "Sofa" }),
      makeProduct({ itemNo: "P2", name: "Desk" }),
    ];
    const result = buildAutoRankCart(null, products, { isCartIntent: true });
    assert.equal(result.inputSource, "foundProducts");
    assert.deepEqual(
      result.cart.map((c) => c.itemNo).sort(),
      ["P1", "P2"],
    );
  });

  it("respects maxVariants cap for foundProducts too", () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      makeProduct({ itemNo: `P${i}`, name: `Product ${i}` }),
    );
    const result = buildAutoRankCart(null, products, { isCartIntent: false, maxVariants: 2 });
    assert.equal(result.cart.length, 2);
  });
});

// ────────────────────────────────────────────────
// Integration — verify what cart reaches findStoresForCart
// ────────────────────────────────────────────────

describe("orchestrator — auto-rank cart integration (Route B)", () => {
  it("Route B: findStoresForCart is called with all found products", async () => {
    const products = [
      makeProduct({ itemNo: "P1", name: "SÖDERHAMN Sofa" }),
      makeProduct({ itemNo: "P2", name: "EKTORP Sofa" }),
    ];
    const adapter = trackingAdapter(products);
    await handleQuery("sofa", {
      adapter,
      retriever: new StubRetriever(),
      maxProductResults: 5,
      skipLlmForStructuredResults: true,
    });
    assert.equal(adapter.findStoresCalls.length, 1);
    // Route B — all products forwarded, no variant grouping (finderCandidates null)
    const sentItemNos = adapter.findStoresCalls[0].map((i) => i.itemNo).sort();
    assert.deepEqual(sentItemNos, ["P1", "P2"]);
  });
});

describe("orchestrator — auto-rank cart integration (Route A, product-discovery)", () => {
  it("single-type QU: topVariantGroup narrows to same-named variants only", async () => {
    // Three products: two sofa variants + one unrelated desk
    const products = [
      makeProduct({ itemNo: "S1", name: "SÖDERHAMN Sofa", designText: "Beige" }),
      makeProduct({ itemNo: "S2", name: "SÖDERHAMN Sofa", designText: "Blue" }),
      makeProduct({ itemNo: "D1", name: "ALEX Desk" }),
    ];
    const adapter = trackingAdapter(products);
    await handleQuery("sofa", {
      adapter,
      retriever: new StubRetriever(),
      maxProductResults: 5,
      skipLlmForStructuredResults: true,
    }, { queryUnderstandingOutput: QU_SINGLE });

    assert.equal(adapter.findStoresCalls.length, 1);
    const sentItemNos = adapter.findStoresCalls[0].map((i) => i.itemNo).sort();
    // Desk must be excluded — topVariantGroup selects only SÖDERHAMN Sofa variants
    assert.deepEqual(sentItemNos, ["S1", "S2"]);
  });

  it("single-type QU: single product with no siblings → only that item in cart", async () => {
    const products = [
      makeProduct({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
      makeProduct({ itemNo: "D1", name: "ALEX Desk" }),
    ];
    const adapter = trackingAdapter(products);
    await handleQuery("sofa", {
      adapter,
      retriever: new StubRetriever(),
      maxProductResults: 5,
      skipLlmForStructuredResults: true,
    }, { queryUnderstandingOutput: QU_SINGLE });

    const sentItemNos = adapter.findStoresCalls[0].map((i) => i.itemNo);
    // Only the highest-scored product's itemNo (SÖDERHAMN Sofa came first from adapter)
    assert.deepEqual(sentItemNos, ["S1"]);
  });
});

describe("orchestrator — auto-rank cart integration (Route A, cart intent)", () => {
  it("multiple-cardinality QU: all distinct products preserved in inventory lookup", async () => {
    const products = [
      makeProduct({ itemNo: "S1", name: "SÖDERHAMN Sofa" }),
      makeProduct({ itemNo: "D1", name: "ALEX Desk" }),
    ];
    const adapter = trackingAdapter(products);
    await handleQuery("sofa and desk", {
      adapter,
      retriever: new StubRetriever(),
      maxProductResults: 5,
      skipLlmForStructuredResults: true,
    }, { queryUnderstandingOutput: QU_MULTIPLE });

    assert.equal(adapter.findStoresCalls.length, 1);
    const sentItemNos = adapter.findStoresCalls[0].map((i) => i.itemNo).sort();
    // Both sofa and desk must be in the cart — not collapsed by topVariantGroup
    assert.deepEqual(sentItemNos, ["D1", "S1"]);
  });

  it("multiple-cardinality: variants of the same product AND distinct products all preserved", async () => {
    // e.g. user asked for "beige sofa, blue sofa, and a desk"
    const products = [
      makeProduct({ itemNo: "S1", name: "SÖDERHAMN Sofa", designText: "Beige" }),
      makeProduct({ itemNo: "S2", name: "SÖDERHAMN Sofa", designText: "Blue" }),
      makeProduct({ itemNo: "D1", name: "ALEX Desk" }),
    ];
    const adapter = trackingAdapter(products);
    await handleQuery("sofa and desk", {
      adapter,
      retriever: new StubRetriever(),
      maxProductResults: 5,
      skipLlmForStructuredResults: true,
    }, { queryUnderstandingOutput: QU_MULTIPLE });

    const sentItemNos = adapter.findStoresCalls[0].map((i) => i.itemNo).sort();
    assert.deepEqual(sentItemNos, ["D1", "S1", "S2"]);
  });
});

describe("orchestrator — auto-rank absent when no products found", () => {
  it("empty adapter: findStoresForCart is never called", async () => {
    const adapter = trackingAdapter([]);
    await handleQuery("sofa", {
      adapter,
      retriever: new StubRetriever(),
      skipLlmForStructuredResults: true,
    }, { queryUnderstandingOutput: QU_SINGLE });
    assert.equal(adapter.findStoresCalls.length, 0);
  });
});

// ────────────────────────────────────────────────
// Router override — regression tests
// ────────────────────────────────────────────────

describe("orchestrator — router search_product intent", () => {
  it("returns products when router intent is search_product (regression: was skipping search)", async () => {
    const products = [makeProduct({ itemNo: "001.001.01", name: "SÖDERHAMN Sofa" })];
    const resp = await handleQuery(
      "sofa",
      baseConfig(products),
      { routerOutput: ROUTER_SEARCH_PRODUCT },
    );
    assert.ok(resp.products, "products should be present");
    assert.equal(resp.products!.length, 1);
    assert.equal(resp.products![0].name, "SÖDERHAMN Sofa");
    assert.equal(resp.intent.type, "product_info");
  });

  it("returns products without router output (Route B fallback)", async () => {
    const products = [makeProduct({ itemNo: "001.001.02", name: "EKTORP Sofa" })];
    const resp = await handleQuery("sofa", baseConfig(products));
    assert.ok(resp.products);
    assert.equal(resp.products!.length, 1);
    assert.equal(resp.intent.type, "product_info");
  });

  it("search_product does not set intent to product_info before search runs", async () => {
    const resp = await handleQuery(
      "sofa",
      baseConfig([]),
      { routerOutput: ROUTER_SEARCH_PRODUCT },
    );
    assert.equal(resp.intent.type, "unknown");
    assert.equal(resp.products, undefined);
  });

  it("find_best_store upgrades unknown to stock (existing behaviour unchanged)", async () => {
    const resp = await handleQuery(
      "stores near me",
      baseConfig([]),
      {
        routerOutput: ROUTER_FIND_STORE,
        cart: [{ itemNo: "001.001.01", quantity: 1 }],
      },
    );
    assert.equal(resp.intent.type, "stock");
  });
});

describe("orchestrator — intent not overridden when pattern classifier succeeds", () => {
  it("policy intent from pattern classifier is not overridden by router", async () => {
    const resp = await handleQuery(
      "What is the return policy?",
      baseConfig([]),
      { routerOutput: ROUTER_SEARCH_PRODUCT },
    );
    assert.equal(resp.intent.type, "policy");
  });
});

describe("orchestrator — response shape invariants", () => {
  it("always returns required fields even when search fails", async () => {
    const resp = await handleQuery("sofa", baseConfig([]));
    assert.ok(typeof resp.intent === "object");
    assert.ok(typeof resp.intent.type === "string");
    assert.ok(Array.isArray(resp.toolCallsUsed));
    assert.ok(Array.isArray(resp.retrievedKnowledge));
    assert.ok(Array.isArray(resp.citations));
    assert.ok(Array.isArray(resp.warnings));
    assert.ok(typeof resp.answer === "string");
  });
});
