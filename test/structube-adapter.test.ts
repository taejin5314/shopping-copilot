import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { StructubeAdapter } from "../src/retailers/structube/adapter.js";
import { KeywordRetriever } from "../src/rag/keyword-retriever.js";
import { STRUCTUBE_CORPUS } from "../src/rag/structube-corpus.js";
import { handleQuery } from "../src/orchestration/orchestrator.js";
import { ask } from "../src/api/ask.js";
import type { CopilotConfig } from "../src/api/ask.js";
import type { Response } from "undici";

// ── Mock helpers ──

/**
 * Routes GraphQL queries by inspecting the request body.
 * Keeps adapters fully mocked without hitting the network.
 */
function gqlMock(overrides: {
  stores?: unknown;
  inventory?: unknown;
  products?: unknown;
  status?: number;
} = {}): typeof globalThis.fetch {
  const status = overrides.status ?? 200;
  const stores  = overrides.stores   ?? GQL_STORES;
  const inventory = overrides.inventory ?? GQL_INVENTORY;
  const products  = overrides.products  ?? GQL_PRODUCTS;

  return mock.fn(async (_url: unknown, init: { body?: unknown }): Promise<Response> => {
    const q = (JSON.parse(init.body as string) as { query: string }).query;
    const data = q.includes("absoStores") ? stores
      : q.includes("inventory") ? inventory
      : products;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
    } as Response;
  });
}

// ── Shared fixture data ──

const MOCK_STORES = [
  { identifier: "COLL", short_name: "Toronto - College Street", city: "Toronto",   region: "Ontario",          country_id: "CA", latitude: 43.655677, longitude: -79.410497 },
  { identifier: "GRAN", short_name: "Vancouver - Granville",    city: "Vancouver", region: "British Columbia", country_id: "CA", latitude: 49.264347, longitude: -123.138912 },
  { identifier: "GATE", short_name: "Calgary - Heritage Gate",  city: "Calgary",   region: "Alberta",          country_id: "CA", latitude: 50.989200, longitude: -114.044150 },
];

const GQL_STORES   = { data: { absoStores: { items: MOCK_STORES } } };
const GQL_PRODUCTS = {
  data: { products: { items: [
    { sku: "SKU-001", name: "KINSEY Sofa",          url_key: "kinsey-sofa",          url_suffix: "", price: { regularPrice: { amount: { value: 899, currency: "CAD" } } } },
    { sku: "SKU-002", name: "PALERMO Coffee Table", url_key: "palermo-coffee-table", url_suffix: "", price: { regularPrice: { amount: { value: 299, currency: "CAD" } } } },
  ] } },
};
const GQL_INVENTORY = {
  data: { inventory: { items: [
    { sku: "SKU-001", region_id: 74, quantity: 5, status: "IN_STOCK" },    // Ontario → COLL
    { sku: "SKU-001", region_id: 67, quantity: 2, status: "IN_STOCK" },    // BC     → GRAN
    { sku: "SKU-001", region_id: 66, quantity: 0, status: "OUT_OF_STOCK" }, // AB     → GATE
  ] } },
};
const GQL_INVENTORY_EMPTY = { data: { inventory: { items: [] } } };

// ── listStores ──

describe("StructubeAdapter — listStores", () => {
  it("returns stores fetched from GraphQL", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const stores = await adapter.listStores();
    assert.equal(stores.length, MOCK_STORES.length);
    assert.equal(stores[0].retailer, "structube");
    assert.ok(stores[0].coords != null);
  });

  it("returns stores for CA", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const stores = await adapter.listStores("CA");
    assert.equal(stores.length, MOCK_STORES.length);
  });

  it("returns empty for non-CA country (no network call)", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const stores = await adapter.listStores("US");
    assert.equal(stores.length, 0);
  });
});

// ── searchProducts ──

describe("StructubeAdapter — searchProducts", () => {
  it("maps GraphQL products to ProductInfo", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.searchProducts("sofa");
    assert.equal(results.length, 2);
    assert.equal(results[0].retailer, "structube");
    assert.equal(results[0].itemNo, "SKU-001");
    assert.equal(results[0].name, "KINSEY Sofa");
    assert.equal(results[0].price?.amount, 899);
    assert.equal(results[0].price?.currency, "CAD");
  });

  it("constructs full URL from url_key", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.searchProducts("sofa");
    assert.ok(results[0].url?.startsWith("https://www.structube.com/en_ca/"));
    assert.ok(results[0].url?.includes("kinsey-sofa"));
  });

  it("handles empty results", async () => {
    const empty = { data: { products: { items: [] } } };
    const adapter = new StructubeAdapter({ fetch: gqlMock({ products: empty }) });
    const results = await adapter.searchProducts("nonexistent");
    assert.equal(results.length, 0);
  });

  it("throws CopilotError on network failure", async () => {
    const failFetch = mock.fn(async () => { throw new Error("network timeout"); });
    const adapter = new StructubeAdapter({ fetch: failFetch as typeof globalThis.fetch });
    await assert.rejects(
      () => adapter.searchProducts("sofa"),
      (err: Error) => err.message.includes("Structube search failed"),
    );
  });

  it("throws CopilotError on HTTP error", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock({ status: 503 }) });
    await assert.rejects(
      () => adapter.searchProducts("sofa"),
      (err: Error) => err.message.includes("HTTP 503"),
    );
  });
});

// ── checkStock ──

describe("StructubeAdapter — checkStock", () => {
  it("returns real stock levels from inventory API", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    // COLL = Ontario (region 74) → IN_STOCK with qty 5
    const results = await adapter.checkStock(
      [{ retailer: "structube", itemNo: "SKU-001" }],
      ["COLL"],
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].store.storeId, "COLL");
    assert.equal(results[0].items[0].stockLevel, "IN_STOCK");
    assert.equal(results[0].items[0].quantity, 5);
  });

  it("returns UNKNOWN when inventory has no data for that region", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock({ inventory: GQL_INVENTORY_EMPTY }) });
    const results = await adapter.checkStock(
      [{ retailer: "structube", itemNo: "SKU-001" }],
      ["COLL"],
    );
    assert.equal(results[0].items[0].stockLevel, "UNKNOWN");
    assert.equal(results[0].items[0].quantity, null);
  });
});

// ── findStoresForCart ──

describe("StructubeAdapter — findStoresForCart", () => {
  it("returns stores with real inventory data", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.findStoresForCart([{ itemNo: "SKU-001", quantity: 1 }]);
    assert.equal(results.length, MOCK_STORES.length);
    for (const store of results) {
      assert.equal(store.store.retailer, "structube");
    }
  });

  it("Ontario store (COLL) shows IN_STOCK", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.findStoresForCart([{ itemNo: "SKU-001", quantity: 1 }]);
    const coll = results.find((r) => r.store.storeId === "COLL");
    assert.ok(coll != null, "COLL should be present");
    assert.equal(coll!.items[0].stockLevel, "IN_STOCK");
    assert.equal(coll!.items[0].quantity, 5);
    assert.equal(coll!.items[0].available, true);
  });

  it("Alberta store (GATE) shows OUT_OF_STOCK", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.findStoresForCart([{ itemNo: "SKU-001", quantity: 1 }]);
    const gate = results.find((r) => r.store.storeId === "GATE");
    assert.ok(gate != null, "GATE should be present");
    assert.equal(gate!.items[0].stockLevel, "OUT_OF_STOCK");
    assert.equal(gate!.items[0].quantity, 0);
    assert.equal(gate!.items[0].available, false);
  });

  it("filters by storeIds", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.findStoresForCart(
      [{ itemNo: "SKU-001", quantity: 1 }],
      { storeIds: ["GRAN", "GATE"] },
    );
    assert.equal(results.length, 2);
    const ids = results.map((r) => r.store.storeId);
    assert.ok(ids.includes("GRAN"));
    assert.ok(ids.includes("GATE"));
  });

  it("returns empty for non-CA countryCode", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const results = await adapter.findStoresForCart(
      [{ itemNo: "SKU-001", quantity: 1 }],
      { countryCode: "US" },
    );
    assert.equal(results.length, 0);
  });
});

// ── Full orchestration pipeline ──

describe("Structube — full pipeline", () => {
  it("handles policy query through orchestrator", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const retriever = new KeywordRetriever(STRUCTUBE_CORPUS);
    const result = await handleQuery(
      "What is the Structube return policy?",
      { adapter, retriever, maxStoreResults: 3 },
    );
    assert.equal(result.intent.type, "policy");
    assert.ok(result.retrievedKnowledge.length > 0);
    assert.equal(result.retrievedKnowledge[0].retailer, "structube");
  });

  it("stock query returns recommendation with real data", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const retriever = new KeywordRetriever(STRUCTUBE_CORPUS);
    const result = await handleQuery(
      "Which Structube store has SKU-001?",
      { adapter, retriever, maxStoreResults: 3 },
      { cart: [{ itemNo: "SKU-001", quantity: 1 }] },
    );
    assert.equal(result.intent.type, "stock");
    assert.ok(result.recommendation != null);
    // IN_STOCK stores should have positive stockCoverageScore
    const inStock = result.recommendation!.ranked.filter((s) => s.stockCoverageScore > 0);
    assert.ok(inStock.length > 0, "at least one store should have IN_STOCK items");
  });
});

// ── Multi-retailer routing via ask() ──

describe("Multi-retailer routing", () => {
  it("routes to default retailer when no retailer specified", async () => {
    const cfg: CopilotConfig = {
      adapter: new StructubeAdapter({ fetch: gqlMock() }),
      retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
      retailers: { structube: { adapter: new StructubeAdapter({ fetch: gqlMock() }), retriever: new KeywordRetriever(STRUCTUBE_CORPUS) } },
    };
    const result = await ask({ query: "What is the return policy?" }, cfg);
    assert.ok(result.answer.length > 0);
  });

  it("routes to structube when retailer=structube", async () => {
    const cfg: CopilotConfig = {
      adapter: new StructubeAdapter({ fetch: gqlMock() }),
      retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
      retailers: { structube: { adapter: new StructubeAdapter({ fetch: gqlMock() }), retriever: new KeywordRetriever(STRUCTUBE_CORPUS) } },
    };
    const result = await ask({ query: "What is the return policy?", retailer: "structube" }, cfg);
    assert.ok(result.retrievedKnowledge.length > 0);
    assert.equal(result.retrievedKnowledge[0].retailer, "structube");
  });

  it("throws ADAPTER_NOT_FOUND for unknown retailer", async () => {
    const cfg: CopilotConfig = {
      adapter: new StructubeAdapter({ fetch: gqlMock() }),
      retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
    };
    await assert.rejects(
      () => ask({ query: "hello", retailer: "wayfair" }, cfg),
      (err: Error) => err.message.includes("wayfair"),
    );
  });
});

// ── Cart overrides unknown intent ──

describe("Cart overrides unknown intent", () => {
  it("non-English query with cart triggers stock path", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const retriever = new KeywordRetriever(STRUCTUBE_CORPUS);
    const result = await handleQuery(
      "가장 저렴하지만 퀄리티 좋은 소파 침대 찾아줘",
      { adapter, retriever, maxStoreResults: 3 },
      { cart: [{ itemNo: "SKU-001", quantity: 1 }] },
    );
    assert.equal(result.intent.type, "stock");
    assert.ok(result.recommendation != null);
  });

  it("unknown query without cart falls back to product search", async () => {
    const adapter = new StructubeAdapter({ fetch: gqlMock() });
    const retriever = new KeywordRetriever(STRUCTUBE_CORPUS);
    const result = await handleQuery(
      "가장 저렴하지만 퀄리티 좋은 소파 침대 찾아줘",
      { adapter, retriever, maxStoreResults: 3 },
    );
    assert.equal(result.intent.type, "product_info");
    assert.ok(result.citations.length > 0, "should have product citations");
    assert.ok(result.toolCallsUsed.some((t) => t.tool === "search_products"));
  });
});
