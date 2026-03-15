/**
 * End-to-end evaluation fixtures.
 *
 * These tests exercise the full Router → Query Understanding → Product Finder
 * pipeline using deterministic mock providers and adapters.
 *
 * They do NOT call real LLM APIs or retailer APIs. Their purpose is to verify:
 *   1. Each stage produces the expected shape and values.
 *   2. The stages compose correctly — QU output drives Product Finder search
 *      queries, router scope drives adapter selection, warnings propagate.
 *   3. Cross-component consistency: router.retailerScope ↔ qu.retailerPreference
 *      ↔ the adapter actually queried.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeQuery } from "../src/llm/router.js";
import type { RouterOutput } from "../src/llm/router.js";
import { runQueryUnderstanding } from "../src/llm/query-understanding.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import { findProducts, buildSearchQuery } from "../src/domain/product-finder.js";
import type { LlmProvider, LlmResponse } from "../src/llm/provider.js";
import type { RetailerAdapter, SearchOpts, FindStoresOpts } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, StoreStock, ProductRef } from "../src/core/types.js";

// ── Helpers ──

function llmReturning(json: object): LlmProvider {
  return { complete: async () => ({ content: JSON.stringify(json) } as LlmResponse) };
}

function makeProduct(overrides: Partial<ProductInfo> & { itemNo: string; name: string }): ProductInfo {
  return {
    retailer: overrides.retailer ?? "test",
    typeName: "Furniture",
    price: { amount: 500, currency: "CAD" },
    url: `https://example.com/${overrides.itemNo}`,
    measureText: null,
    designText: null,
    imageUrl: null,
    ...overrides,
  };
}

function adapterReturning(retailerId: string, products: ProductInfo[]): RetailerAdapter & { queriedWith: string[] } {
  const queriedWith: string[] = [];
  return {
    retailerId,
    queriedWith,
    listStores: async (): Promise<StoreRef[]> => [],
    searchProducts: async (query: string, _opts?: SearchOpts): Promise<ProductInfo[]> => {
      queriedWith.push(query);
      return products;
    },
    checkStock: async (_items: ProductRef[], _storeIds: string[]): Promise<StoreStock[]> => [],
    findStoresForCart: async (
      _items: Array<{ itemNo: string; quantity: number }>,
      _opts?: FindStoresOpts,
    ): Promise<StoreStock[]> => [],
  };
}

// ── Fixture 1: Sofa bed with budget ──

const ROUTER_SOFA_BED: RouterOutput = {
  intent: "search_product",
  retailerScope: "all",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.93,
  warnings: [],
  reasoningSummary: "User is searching for a product type with a budget constraint.",
};

const QU_SOFA_BED: QueryUnderstandingOutput = {
  category: "sofa bed",
  keywords: ["sofa bed", "comfortable"],
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

describe("E2E eval: sofa bed under $800", () => {
  const query = "I want a comfortable sofa bed under $800";

  it("router classifies as search_product with all scope", async () => {
    const result = await routeQuery(query, llmReturning(ROUTER_SOFA_BED));
    assert.ok(result);
    assert.equal(result.intent, "search_product");
    assert.equal(result.retailerScope, "all");
    assert.equal(result.nextAgent, "query_understanding");
  });

  it("QU extracts category sofa bed and budgetMax 800", async () => {
    const result = await runQueryUnderstanding(query, llmReturning(QU_SOFA_BED));
    assert.ok(result);
    assert.equal(result.category, "sofa bed");
    assert.equal(result.budgetMax, 800);
    assert.equal(result.itemCardinality, "single");
  });

  it("product finder uses QU keywords as search query, not raw query", async () => {
    const products = [
      makeProduct({ itemNo: "001.001.01", name: "LYCKSELE Sofa bed", price: { amount: 699, currency: "CAD" } }),
    ];
    const adapter = adapterReturning("ikea", products);
    const routerOutput = await routeQuery(query, llmReturning(ROUTER_SOFA_BED));
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_SOFA_BED));
    assert.ok(quOutput);
    const result = await findProducts({ rawQuery: query, routerOutput: routerOutput ?? undefined, quOutput }, [adapter]);
    // Search query must be derived from QU keywords, not the raw verbose query
    assert.notEqual(result.searchQuery, query);
    assert.ok(result.searchQuery.includes("sofa bed"));
    assert.equal(adapter.queriedWith[0], result.searchQuery);
  });

  it("within-budget candidate scores higher than over-budget candidate", async () => {
    const products = [
      makeProduct({ itemNo: "001.001.01", name: "LYCKSELE Sofa bed", price: { amount: 699, currency: "CAD" } }),
      makeProduct({ itemNo: "001.001.02", name: "FRIHETEN Sofa bed", price: { amount: 1200, currency: "CAD" } }),
    ];
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_SOFA_BED));
    assert.ok(quOutput);
    const result = await findProducts({ rawQuery: query, quOutput }, [adapterReturning("ikea", products)]);
    assert.equal(result.candidates.length, 2);
    // First candidate (by score) should be the under-budget one
    assert.equal(result.candidates[0].itemNo, "001.001.01");
    assert.ok(result.candidates[0].matchScore > result.candidates[1].matchScore);
  });

  it("cross-stage: router.retailerScope 'all' → both adapters queried", async () => {
    const ikeaAdapter = adapterReturning("ikea", [makeProduct({ itemNo: "001.001.01", name: "IKEA Sofa bed" })]);
    const structubeAdapter = adapterReturning("structube", [makeProduct({ itemNo: "002.001.01", name: "Structube Sofa bed" })]);
    const routerOutput = await routeQuery(query, llmReturning(ROUTER_SOFA_BED));
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_SOFA_BED));
    assert.ok(quOutput);
    const result = await findProducts(
      { rawQuery: query, routerOutput: routerOutput ?? undefined, quOutput, retailerScope: routerOutput?.retailerScope },
      [ikeaAdapter, structubeAdapter],
    );
    assert.equal(ikeaAdapter.queriedWith.length, 1);
    assert.equal(structubeAdapter.queriedWith.length, 1);
    const retailers = new Set(result.candidates.map((c) => c.retailer));
    assert.ok(retailers.has("ikea"));
    assert.ok(retailers.has("structube"));
  });
});

// ── Fixture 2: IKEA white desk ──

const ROUTER_IKEA_DESK: RouterOutput = {
  intent: "search_product",
  retailerScope: "ikea",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "single",
  nextAgent: "query_understanding",
  confidence: 0.95,
  warnings: [],
  reasoningSummary: "User explicitly mentions IKEA and is searching for a desk.",
};

const QU_IKEA_DESK: QueryUnderstandingOutput = {
  category: "desk",
  keywords: ["desk", "home office", "white"],
  budgetMin: null,
  budgetMax: 600,
  color: "white",
  size: null,
  material: null,
  style: null,
  retailerPreference: "ikea",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

describe("E2E eval: IKEA white desk", () => {
  const query = "IKEA white desk for home office under $600";

  it("router scopes to ikea", async () => {
    const result = await routeQuery(query, llmReturning(ROUTER_IKEA_DESK));
    assert.ok(result);
    assert.equal(result.retailerScope, "ikea");
  });

  it("QU extracts color white and retailerPreference ikea", async () => {
    const result = await runQueryUnderstanding(query, llmReturning(QU_IKEA_DESK));
    assert.ok(result);
    assert.equal(result.color, "white");
    assert.equal(result.retailerPreference, "ikea");
    assert.equal(result.budgetMax, 600);
  });

  it("cross-stage: router.retailerScope 'ikea' → only ikea adapter queried", async () => {
    const ikeaAdapter = adapterReturning("ikea", [makeProduct({ itemNo: "004.001.01", name: "MICKE Desk white" })]);
    const structubeAdapter = adapterReturning("structube", [makeProduct({ itemNo: "004.002.01", name: "Structube Desk" })]);
    const routerOutput = await routeQuery(query, llmReturning(ROUTER_IKEA_DESK));
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_IKEA_DESK));
    assert.ok(quOutput);
    await findProducts(
      { rawQuery: query, routerOutput: routerOutput ?? undefined, quOutput, retailerScope: routerOutput?.retailerScope },
      [ikeaAdapter, structubeAdapter],
    );
    assert.equal(ikeaAdapter.queriedWith.length, 1);
    assert.equal(structubeAdapter.queriedWith.length, 0); // scoped out
  });

  it("white desk scores higher than non-white desk", async () => {
    const products = [
      makeProduct({ itemNo: "004.001.01", name: "MICKE Desk white", designText: "white" }),
      makeProduct({ itemNo: "004.001.02", name: "MICKE Desk black", designText: "black" }),
    ];
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_IKEA_DESK));
    assert.ok(quOutput);
    const result = await findProducts({ rawQuery: query, quOutput }, [adapterReturning("ikea", products)]);
    assert.equal(result.candidates[0].designText, "white");
    assert.ok(result.candidates[0].matchScore > result.candidates[1].matchScore);
  });

  it("cross-stage: router.retailerScope matches qu.retailerPreference", async () => {
    const routerOutput = await routeQuery(query, llmReturning(ROUTER_IKEA_DESK));
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_IKEA_DESK));
    assert.ok(routerOutput);
    assert.ok(quOutput);
    // Both stages agree on the retailer
    assert.equal(routerOutput.retailerScope, quOutput.retailerPreference);
  });
});

// ── Fixture 3: Multi-item (bed frame + mattress) ──

const ROUTER_MULTI_ITEM: RouterOutput = {
  intent: "search_product",
  retailerScope: "all",
  locationRequired: false,
  locationProvided: false,
  itemCardinality: "multiple",
  nextAgent: "query_understanding",
  confidence: 0.81,
  warnings: ["Multiple product types detected."],
  reasoningSummary: "Two distinct product categories mentioned; treated as product search.",
};

const QU_MULTI_ITEM: QueryUnderstandingOutput = {
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
  warnings: ["Multiple distinct product types — clarify if this is a cart check or product discovery."],
};

describe("E2E eval: multi-item (bed frame and mattress)", () => {
  const query = "bed frame and mattress";

  it("router flags multiple cardinality with warning", async () => {
    const result = await routeQuery(query, llmReturning(ROUTER_MULTI_ITEM));
    assert.ok(result);
    assert.equal(result.itemCardinality, "multiple");
    assert.ok(result.warnings.length > 0);
  });

  it("QU flags multiple cardinality with warning", async () => {
    const result = await runQueryUnderstanding(query, llmReturning(QU_MULTI_ITEM));
    assert.ok(result);
    assert.equal(result.itemCardinality, "multiple");
    assert.ok(result.warnings.length > 0);
  });

  it("product finder propagates multi-item warning to result", async () => {
    const products = [makeProduct({ itemNo: "006.001.01", name: "MALM Bed frame" })];
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_MULTI_ITEM));
    assert.ok(quOutput);
    const result = await findProducts({ rawQuery: query, quOutput }, [adapterReturning("ikea", products)]);
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("multiple product")));
  });

  it("cross-stage: both router and QU agree on multiple cardinality", async () => {
    const routerOutput = await routeQuery(query, llmReturning(ROUTER_MULTI_ITEM));
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_MULTI_ITEM));
    assert.ok(routerOutput);
    assert.ok(quOutput);
    assert.equal(routerOutput.itemCardinality, "multiple");
    assert.equal(quOutput.itemCardinality, "multiple");
  });
});

// ── Fixture 4: Vague query ──

const ROUTER_VAGUE: RouterOutput = {
  intent: "find_best_store",
  retailerScope: "all",
  locationRequired: true,
  locationProvided: true,
  itemCardinality: "unknown",
  nextAgent: "query_understanding",
  confidence: 0.58,
  warnings: ["Product reference is unclear."],
  reasoningSummary: "Store-oriented query with no identifiable product.",
};

const QU_VAGUE: QueryUnderstandingOutput = {
  category: "",
  keywords: ["furniture"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "unknown",
  mustBeInStock: false,
  locationTerms: ["near me"],
  itemCardinality: "unknown",
  warnings: ["Category is too vague to search effectively."],
};

describe("E2E eval: vague query", () => {
  const query = "something nice near me";

  it("router returns low confidence with warning", async () => {
    const result = await routeQuery(query, llmReturning(ROUTER_VAGUE));
    assert.ok(result);
    assert.ok(result.confidence < 0.7);
    assert.ok(result.warnings.length > 0);
  });

  it("QU returns empty category with warning", async () => {
    const result = await runQueryUnderstanding(query, llmReturning(QU_VAGUE));
    assert.ok(result);
    assert.equal(result.category, "");
    assert.ok(result.warnings.length > 0);
  });

  it("product finder still returns candidates and falls back to QU keywords", async () => {
    const products = [makeProduct({ itemNo: "007.001.01", name: "Generic Chair" })];
    const quOutput = await runQueryUnderstanding(query, llmReturning(QU_VAGUE));
    assert.ok(quOutput);
    const result = await findProducts({ rawQuery: query, quOutput }, [adapterReturning("ikea", products)]);
    // Candidates returned (not blocked by empty category)
    assert.equal(result.candidates.length, 1);
    // searchQuery is derived from QU keywords, not raw query
    assert.equal(result.searchQuery, buildSearchQuery(query, quOutput));
  });

  it("product finder emits weak-match warning when all candidates score low", async () => {
    // Product that matches none of the vague query's (nonexistent) attributes
    const products = [makeProduct({ itemNo: "007.001.01", name: "Generic Chair" })];
    // Add attributes that won't match to force low score
    const quWithAttrs: QueryUnderstandingOutput = {
      ...QU_VAGUE,
      color: "crimson",
      material: "bamboo",
      style: "baroque",
      budgetMax: 50,
    };
    const result = await findProducts({ rawQuery: query, quOutput: quWithAttrs }, [adapterReturning("ikea", products)]);
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("low match score")));
  });
});

// ── Cross-fixture: pipeline composition invariants ──

describe("E2E eval: pipeline composition invariants", () => {
  it("QU keywords always become a substring of the Product Finder search query", async () => {
    for (const [qu, query] of [
      [QU_SOFA_BED, "sofa bed query"],
      [QU_IKEA_DESK, "ikea desk query"],
    ] as [QueryUnderstandingOutput, string][]) {
      const searchQuery = buildSearchQuery(query, qu);
      for (const kw of qu.keywords) {
        assert.ok(
          searchQuery.toLowerCase().includes(kw.toLowerCase()),
          `keyword "${kw}" missing from searchQuery "${searchQuery}"`,
        );
      }
    }
  });

  it("null router output is handled gracefully by Product Finder", async () => {
    const products = [makeProduct({ itemNo: "099.001.01", name: "Test Product" })];
    // routerOutput explicitly undefined — Product Finder must not throw
    const result = await findProducts(
      { rawQuery: "sofa", routerOutput: undefined, quOutput: QU_SOFA_BED },
      [adapterReturning("ikea", products)],
    );
    assert.ok(result.candidates.length > 0);
  });

  it("null QU output falls back to raw query search", async () => {
    const rawQuery = "comfortable sofa bed";
    const products = [makeProduct({ itemNo: "099.002.01", name: "FRIHETEN Sofa" })];
    const adapter = adapterReturning("ikea", products);
    const result = await findProducts({ rawQuery, quOutput: undefined }, [adapter]);
    assert.equal(result.searchQuery, rawQuery);
    assert.equal(adapter.queriedWith[0], rawQuery);
  });

  it("failing LLM returns null from both router and QU without throwing", async () => {
    const failProvider: LlmProvider = {
      complete: async () => { throw new Error("LLM down"); },
    };
    const [ro, qu] = await Promise.all([
      routeQuery("sofa", failProvider),
      runQueryUnderstanding("sofa", failProvider),
    ]);
    assert.equal(ro, null);
    assert.equal(qu, null);
  });
});
