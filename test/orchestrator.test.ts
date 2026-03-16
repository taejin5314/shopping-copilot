/**
 * Orchestrator unit tests.
 *
 * These tests use in-memory mock adapters — no MCP server required.
 * They focus on routing logic (intent classification, router overrides)
 * rather than the correctness of individual retailer adapters.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleQuery } from "../src/orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../src/orchestration/orchestrator.js";
import type { RouterOutput } from "../src/llm/router.js";
import { StubRetriever } from "../src/rag/retriever.js";
import type { RetailerAdapter, SearchOpts, FindStoresOpts } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, StoreStock, ProductRef } from "../src/core/types.js";

// ── Mock adapter ──

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

function mockAdapter(products: ProductInfo[]): RetailerAdapter {
  return {
    retailerId: "mock",
    listStores: async (): Promise<StoreRef[]> => [],
    searchProducts: async (_query: string, _opts?: SearchOpts): Promise<ProductInfo[]> => products,
    checkStock: async (_items: ProductRef[], _storeIds: string[]): Promise<StoreStock[]> => [],
    findStoresForCart: async (
      _items: Array<{ itemNo: string; quantity: number }>,
      _opts?: FindStoresOpts,
    ): Promise<StoreStock[]> => [],
  };
}

function baseConfig(products: ProductInfo[]): OrchestratorConfig {
  return {
    adapter: mockAdapter(products),
    retriever: new StubRetriever(),
    maxProductResults: 3,
    skipLlmForStructuredResults: true,
  };
}

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

// ── Router override — regression tests ──

describe("orchestrator — router search_product intent", () => {
  it("returns products when router intent is search_product (regression: was skipping search)", async () => {
    const products = [makeProduct({ itemNo: "001.001.01", name: "SÖDERHAMN Sofa" })];
    const resp = await handleQuery(
      "sofa",
      baseConfig(products),
      { routerOutput: ROUTER_SEARCH_PRODUCT },
    );
    // Products must be returned — previously this returned undefined because the search was skipped
    assert.ok(resp.products, "products should be present");
    assert.equal(resp.products!.length, 1);
    assert.equal(resp.products![0].name, "SÖDERHAMN Sofa");
    // Intent should resolve to product_info once products are found
    assert.equal(resp.intent.type, "product_info");
  });

  it("returns products without router output (Route B fallback)", async () => {
    const products = [makeProduct({ itemNo: "001.001.02", name: "EKTORP Sofa" })];
    const resp = await handleQuery("sofa", baseConfig(products));
    assert.ok(resp.products);
    assert.equal(resp.products!.length, 1);
    assert.equal(resp.intent.type, "product_info");
  });

  it("search_product with router does not set intent to product_info before search runs", async () => {
    // Empty adapter → search returns 0 products
    const resp = await handleQuery(
      "sofa",
      baseConfig([]), // nothing to find
      { routerOutput: ROUTER_SEARCH_PRODUCT },
    );
    // No products returned → intent stays unknown (no products to upgrade to product_info)
    assert.equal(resp.intent.type, "unknown");
    assert.equal(resp.products, undefined);
  });

  it("find_best_store router intent upgrades unknown to stock (existing behaviour unchanged)", async () => {
    // Use a query the pattern classifier returns "unknown" for so the router override fires.
    const resp = await handleQuery(
      "stores near me",
      baseConfig([]),
      {
        routerOutput: ROUTER_FIND_STORE,
        // Provide a cart so the stock path doesn't bail early with "no item numbers"
        cart: [{ itemNo: "001.001.01", quantity: 1 }],
      },
    );
    // Router upgrade fires: unknown → stock
    assert.equal(resp.intent.type, "stock");
  });
});

describe("orchestrator — intent not overridden when pattern classifier succeeds", () => {
  it("policy intent from pattern classifier is not overridden by router", async () => {
    const resp = await handleQuery(
      "What is the return policy?",
      baseConfig([]),
      { routerOutput: ROUTER_SEARCH_PRODUCT }, // router disagrees
    );
    // Pattern classifier should win for this well-understood query
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
