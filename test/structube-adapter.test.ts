import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { StructubeAdapter } from "../src/retailers/structube/adapter.js";
import { STRUCTUBE_STORES } from "../src/retailers/structube/stores.js";
import { KeywordRetriever } from "../src/rag/keyword-retriever.js";
import { STRUCTUBE_CORPUS } from "../src/rag/structube-corpus.js";
import { handleQuery } from "../src/orchestration/orchestrator.js";
import { ask } from "../src/api/ask.js";
import type { CopilotConfig } from "../src/api/ask.js";
import type { Response } from "undici";

// ── Mock fetch helpers ──

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return mock.fn(async (): Promise<Response> => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response);
}

const SEARCH_RESPONSE = {
  items: [
    {
      sku: "SKU-001",
      name: "KINSEY Sofa",
      type_id: "configurable",
      price: 899,
      url: "/en_ca/kinsey-sofa.html",
    },
    {
      sku: "SKU-002",
      name: "PALERMO Coffee Table",
      type_id: "simple",
      price: 299,
      url: "https://www.structube.com/en_ca/palermo-coffee-table.html",
    },
  ],
};

// ── StructubeAdapter unit tests ──

describe("StructubeAdapter — listStores", () => {
  const adapter = new StructubeAdapter();

  it("returns all stores when no country filter", async () => {
    const stores = await adapter.listStores();
    assert.equal(stores.length, STRUCTUBE_STORES.length);
    assert.equal(stores[0].retailer, "structube");
  });

  it("returns stores for CA", async () => {
    const stores = await adapter.listStores("CA");
    assert.equal(stores.length, STRUCTUBE_STORES.length);
  });

  it("returns empty for non-CA country", async () => {
    const stores = await adapter.listStores("US");
    assert.equal(stores.length, 0);
  });
});

describe("StructubeAdapter — searchProducts", () => {
  it("maps search results to ProductInfo", async () => {
    const adapter = new StructubeAdapter({ fetch: mockFetch(SEARCH_RESPONSE) });
    const results = await adapter.searchProducts("sofa");

    assert.equal(results.length, 2);
    assert.equal(results[0].retailer, "structube");
    assert.equal(results[0].itemNo, "SKU-001");
    assert.equal(results[0].name, "KINSEY Sofa");
    assert.equal(results[0].price?.amount, 899);
    assert.equal(results[0].price?.currency, "CAD");
    assert.ok(results[0].url?.includes("kinsey-sofa"));
  });

  it("constructs full URL for relative paths", async () => {
    const adapter = new StructubeAdapter({ fetch: mockFetch(SEARCH_RESPONSE) });
    const results = await adapter.searchProducts("sofa");
    // First item has relative URL
    assert.ok(results[0].url?.startsWith("https://www.structube.com"));
    // Second item has absolute URL
    assert.ok(results[1].url?.startsWith("https://www.structube.com"));
  });

  it("handles empty results", async () => {
    const adapter = new StructubeAdapter({ fetch: mockFetch({ items: [] }) });
    const results = await adapter.searchProducts("nonexistent");
    assert.equal(results.length, 0);
  });

  it("throws CopilotError on fetch failure", async () => {
    const failFetch = mock.fn(async () => { throw new Error("network timeout"); });
    const adapter = new StructubeAdapter({ fetch: failFetch as typeof globalThis.fetch });
    await assert.rejects(
      () => adapter.searchProducts("sofa"),
      (err: Error) => err.message.includes("Structube search failed"),
    );
  });

  it("throws CopilotError on HTTP error", async () => {
    const adapter = new StructubeAdapter({ fetch: mockFetch({}, 503) });
    await assert.rejects(
      () => adapter.searchProducts("sofa"),
      (err: Error) => err.message.includes("HTTP 503"),
    );
  });
});

describe("StructubeAdapter — checkStock (limited)", () => {
  it("returns UNKNOWN stock for all items", async () => {
    const adapter = new StructubeAdapter();
    const results = await adapter.checkStock(
      [{ retailer: "structube", itemNo: "SKU-001" }],
      ["st-dufferin"],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].store.storeId, "st-dufferin");
    assert.equal(results[0].items[0].stockLevel, "UNKNOWN");
    assert.equal(results[0].items[0].quantity, null);
    assert.equal(results[0].items[0].available, false);
  });
});

describe("StructubeAdapter — findStoresForCart (limited)", () => {
  it("returns stores with unknown availability", async () => {
    const adapter = new StructubeAdapter();
    const results = await adapter.findStoresForCart(
      [{ itemNo: "SKU-001", quantity: 1 }],
      { maxResults: 3 },
    );
    assert.equal(results.length, 3);
    for (const store of results) {
      assert.equal(store.store.retailer, "structube");
      assert.equal(store.items[0].available, false);
      assert.equal(store.items[0].quantity, null);
    }
  });

  it("filters by storeIds", async () => {
    const adapter = new StructubeAdapter();
    const results = await adapter.findStoresForCart(
      [{ itemNo: "SKU-001", quantity: 1 }],
      { storeIds: ["st-vancouver", "st-calgary"] },
    );
    assert.equal(results.length, 2);
    const ids = results.map((r) => r.store.storeId);
    assert.ok(ids.includes("st-vancouver"));
    assert.ok(ids.includes("st-calgary"));
  });
});

// ── Orchestration integration (Structube through full pipeline) ──

describe("Structube — full pipeline", () => {
  const adapter = new StructubeAdapter({ fetch: mockFetch(SEARCH_RESPONSE) });
  const retriever = new KeywordRetriever(STRUCTUBE_CORPUS);

  it("handles policy query through orchestrator", async () => {
    const result = await handleQuery(
      "What is the Structube return policy?",
      { adapter, retriever, maxStoreResults: 3 },
    );
    assert.equal(result.intent.type, "policy");
    assert.ok(result.retrievedKnowledge.length > 0);
    assert.equal(result.retrievedKnowledge[0].retailer, "structube");
    assert.ok(result.answer.includes("return") || result.answer.includes("Return"));
  });

  it("handles stock query with graceful degradation", async () => {
    const result = await handleQuery(
      "Is SKU-001 in stock at Structube Vancouver?",
      { adapter, retriever, maxStoreResults: 3 },
    );
    // Stock path runs but all items show as unavailable (no per-store stock data)
    assert.ok(result.intent.type === "stock" || result.intent.type === "recommendation");
  });

  it("handles recommendation with low scores (unknown stock)", async () => {
    const result = await handleQuery(
      "Which Structube store should I buy SKU-001 from?",
      { adapter, retriever, maxStoreResults: 3 },
    );
    if (result.recommendation) {
      // All stores should score 0 on stockCoverage since availability is unknown
      for (const store of result.recommendation.ranked) {
        assert.equal(store.stockCoverageScore, 0);
      }
    }
  });
});

// ── Multi-retailer routing via ask() ──

describe("Multi-retailer routing", () => {
  const ikeaMock: CopilotConfig = {
    adapter: new StructubeAdapter({ fetch: mockFetch(SEARCH_RESPONSE) }), // using structube as "default" for test
    retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
    retailers: {
      structube: {
        adapter: new StructubeAdapter({ fetch: mockFetch(SEARCH_RESPONSE) }),
        retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
      },
    },
  };

  it("routes to default retailer when no retailer specified", async () => {
    const result = await ask(
      { query: "What is the return policy?" },
      ikeaMock,
    );
    assert.ok(result.answer.length > 0);
  });

  it("routes to structube when retailer=structube", async () => {
    const result = await ask(
      { query: "What is the return policy?", retailer: "structube" },
      ikeaMock,
    );
    assert.ok(result.retrievedKnowledge.length > 0);
    assert.equal(result.retrievedKnowledge[0].retailer, "structube");
  });

  it("throws ADAPTER_NOT_FOUND for unknown retailer", async () => {
    await assert.rejects(
      () => ask({ query: "hello", retailer: "wayfair" }, ikeaMock),
      (err: Error) => err.message.includes("wayfair"),
    );
  });
});
