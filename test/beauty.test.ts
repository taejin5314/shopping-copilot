import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleBeautyQuery } from "../src/beauty/orchestrator.js";
import { classifyBeautyQuery } from "../src/beauty/classify.js";
import { resolveSubstitutes } from "../src/beauty/substitutes.js";
import { SephoraAdapter } from "../src/retailers/sephora/adapter.js";
import { ShoppersAdapter } from "../src/retailers/shoppers/adapter.js";
import {
  SEPHORA_PRODUCTS,
  SHOPPERS_PRODUCTS,
} from "../src/retailers/beauty/mock-data.js";
import type { RetailerAdapter } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, ItemAvailability } from "../src/core/types.js";
import type { BeautyQuery } from "../src/beauty/types.js";

// ──────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────

const adapters: RetailerAdapter[] = [new SephoraAdapter(), new ShoppersAdapter()];
const ALL_PRODUCTS: ProductInfo[] = [...SEPHORA_PRODUCTS, ...SHOPPERS_PRODUCTS];

/** User located at Yonge & Bloor — closest to sdm-bloor-yonge and sdm-bay-st. */
const YONGE_BLOOR = { lat: 43.6710, lng: -79.3863 };

// ──────────────────────────────────────────────
// Query classifier
// ──────────────────────────────────────────────

describe("classifyBeautyQuery", () => {
  it("classifies specific product phrase as exact_product", () => {
    assert.equal(classifyBeautyQuery("laneige lip sleeping mask"), "exact_product");
    assert.equal(classifyBeautyQuery("EltaMD UV Clear SPF 46"), "exact_product");
    assert.equal(classifyBeautyQuery("charlotte tilbury flawless filter"), "exact_product");
  });

  it("classifies brand + category as brand_product", () => {
    assert.equal(classifyBeautyQuery("cerave cleanser"), "brand_product");
    assert.equal(classifyBeautyQuery("the ordinary serum"), "brand_product");
    assert.equal(classifyBeautyQuery("neutrogena moisturizer"), "brand_product");
  });

  it("classifies general descriptions as need_based", () => {
    assert.equal(classifyBeautyQuery("hydrating moisturizer for dry skin"), "need_based");
    assert.equal(classifyBeautyQuery("sunscreen for sensitive skin"), "need_based");
    assert.equal(classifyBeautyQuery("gift fragrance under 50"), "need_based");
  });

  it("prefers exact_product over brand when a product phrase is present", () => {
    // "cerave" is a known brand, but "hydrating facial cleanser" is also an exact phrase
    assert.equal(classifyBeautyQuery("cerave hydrating facial cleanser"), "exact_product");
  });
});

// ──────────────────────────────────────────────
// Substitute resolution (synchronous — no adapters needed)
// ──────────────────────────────────────────────

describe("resolveSubstitutes", () => {
  it("returns same-product substitutes across retailers", () => {
    const subs = resolveSubstitutes("ordinary-niacinamide", "sephora", ALL_PRODUCTS);
    assert.ok(subs.length > 0, "should have at least one substitute");
    const sdmSub = subs.find((s) => s.product.itemNo === "ordinary-niacinamide-sdm");
    assert.ok(sdmSub, "should find the Shoppers version as a substitute");
    assert.equal(sdmSub!.relation.similarityScore, 1.0);
  });

  it("resolves cleanser substitutes", () => {
    const subs = resolveSubstitutes("cerave-hydrating-cleanser", "shoppers", ALL_PRODUCTS);
    assert.ok(subs.length > 0);
    const lrpSub = subs.find((s) => s.product.itemNo === "lrp-toleriane-cleanser");
    assert.ok(lrpSub, "CeraVe should substitute to La Roche-Posay Toleriane");
    assert.ok(lrpSub!.relation.similarityScore >= 0.8);
  });

  it("returns empty array for a product with no substitutes defined", () => {
    const subs = resolveSubstitutes("rare-beauty-blush", "sephora", ALL_PRODUCTS);
    assert.equal(subs.length, 0);
  });

  it("substitute reasons are non-empty strings", () => {
    const subs = resolveSubstitutes("charlotte-tilbury-flawless", "sephora", ALL_PRODUCTS);
    assert.ok(subs.length > 0);
    for (const s of subs) {
      assert.ok(s.relation.reason.length > 0);
      assert.ok(s.relation.similarityScore > 0 && s.relation.similarityScore <= 1);
    }
  });
});

// ──────────────────────────────────────────────
// Case 1: Exact product query
// "laneige lip sleeping mask" → laneige-lip-mask at Sephora stores
// ──────────────────────────────────────────────

describe("handleBeautyQuery — exact product", () => {
  it("returns exact results for a known product name", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "best_match" },
      adapters,
    );
    assert.equal(response.queryClass, "exact_product");
    assert.ok(response.exactResults.length > 0, "should have exact results");
    // Laneige Lip Mask should be the top result (highest match score)
    assert.equal(response.exactResults[0].product.itemNo, "laneige-lip-mask",
      "top result should be laneige-lip-mask");
    assert.ok(
      response.exactResults.every((r) => r.matchKind === "exact"),
    );
  });

  it("sorts results by score descending", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "best_match" },
      adapters,
    );
    const scores = response.exactResults.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i] - 1e-9, "results must be sorted descending");
    }
  });

  it("computes distanceKm when userLocation is provided", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "need_today", userLocation: YONGE_BLOOR },
      adapters,
    );
    assert.ok(response.exactResults.length > 0);
    for (const r of response.exactResults) {
      assert.ok(r.distanceKm !== null, "distanceKm should be set when userLocation given");
      assert.ok(r.distanceKm! >= 0);
    }
  });

  it("caps exact results at 4", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "best_match" },
      adapters,
    );
    assert.ok(response.exactResults.length <= 4);
  });

  it("all rank reasons are non-empty", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "best_match" },
      adapters,
    );
    for (const r of response.exactResults) {
      assert.ok(r.rankReason.length > 0, `rankReason must not be empty for ${r.store.storeId}`);
    }
  });
});

// ──────────────────────────────────────────────
// Case 2: Brand + product query
// "cerave cleanser" → CeraVe products from Shoppers
// ──────────────────────────────────────────────

describe("handleBeautyQuery — brand + product", () => {
  it("classifies cerave query as brand_product", async () => {
    const response = await handleBeautyQuery(
      { query: "cerave cleanser", mode: "best_value" },
      adapters,
    );
    assert.equal(response.queryClass, "brand_product");
  });

  it("returns CeraVe products from Shoppers", async () => {
    const response = await handleBeautyQuery(
      { query: "cerave cleanser", mode: "best_value" },
      adapters,
    );
    assert.ok(response.exactResults.length > 0, "should have results");
    const ceravePicks = response.exactResults.filter((r) =>
      r.product.name.toLowerCase().includes("cerave"),
    );
    assert.ok(ceravePicks.length > 0, "should find CeraVe products");
    assert.ok(
      ceravePicks.every((r) => r.store.retailer === "shoppers"),
      "CeraVe products should come from Shoppers",
    );
  });

  it("ranks cheapest results highly in best_value mode", async () => {
    const response = await handleBeautyQuery(
      { query: "cerave cleanser", mode: "best_value" },
      adapters,
    );
    assert.ok(response.exactResults.length > 0);
    // In best_value mode, the first result's price should be ≤ the last result's price
    const prices = response.exactResults
      .map((r) => r.product.price?.amount ?? Infinity);
    const minPrice = Math.min(...prices);
    // Top result should be priced within 50% of the global minimum
    assert.ok(prices[0] <= minPrice * 1.5, "cheapest should rank near top in best_value");
  });
});

// ──────────────────────────────────────────────
// Case 3: General need-based query
// Matches based on tag and category scoring across both retailers
// ──────────────────────────────────────────────

describe("handleBeautyQuery — need-based query", () => {
  it("classifies a general description as need_based", async () => {
    const response = await handleBeautyQuery(
      { query: "hydrating moisturizer dry skin", mode: "best_match" },
      adapters,
    );
    assert.equal(response.queryClass, "need_based");
  });

  it("returns moisturizer results for a hydration query", async () => {
    const response = await handleBeautyQuery(
      { query: "hydrating moisturizer dry skin", mode: "best_match" },
      adapters,
    );
    assert.ok(response.exactResults.length > 0, "should find products");
    const uniqueItems = new Set(response.exactResults.map((r) => r.product.itemNo));
    assert.ok(uniqueItems.size >= 1);
  });

  it("returns fragrance results for a gift query", async () => {
    const response = await handleBeautyQuery(
      { query: "floral fragrance gift", mode: "best_match" },
      adapters,
    );
    assert.ok(response.exactResults.length > 0, "fragrance query should return results");
    // All products tagged with "floral", "fragrance", and "gift"
    const fragranceIds = new Set([
      "jo-malone-peony", "marc-jacobs-daisy", "dior-miss-dior",
      "mmr-by-fireplace", "ysl-mon-paris", "versace-bright-crystal", "calvin-klein-ck-one",
    ]);
    const hasFragrance = response.exactResults.some((r) => fragranceIds.has(r.product.itemNo));
    assert.ok(hasFragrance, "should match at least one fragrance product");
  });

  it("returns empty for a completely unrelated query", async () => {
    const response = await handleBeautyQuery(
      { query: "sofa table lamp floor rug", mode: "best_match" },
      adapters,
    );
    assert.equal(response.isEmpty, true);
    assert.equal(response.exactResults.length, 0);
    assert.equal(response.substituteResults.length, 0);
  });

  it("returns empty for a blank query", async () => {
    const response = await handleBeautyQuery(
      { query: "   ", mode: "best_match" },
      adapters,
    );
    assert.equal(response.isEmpty, true);
  });
});

// ──────────────────────────────────────────────
// Case 4: OOS + substitute
//
// We inject a mock adapter that returns the primary product as OOS everywhere.
// The real ShoppersAdapter provides availability for the substitute product.
// ──────────────────────────────────────────────

describe("handleBeautyQuery — OOS + substitute", () => {
  /** Build a minimal adapter that reports a single product as OOS at one store. */
  function oosAdapter(retailerId: string, product: ProductInfo): RetailerAdapter {
    const store: StoreRef = {
      retailer: retailerId,
      storeId: `mock-${retailerId}`,
      label: `Mock ${retailerId}`,
      coords: { lat: 43.67, lng: -79.39 },
    };
    const oosEntry: ItemAvailability = {
      itemNo: product.itemNo,
      available: false,
      quantity: 0,
      stockLevel: "OUT_OF_STOCK",
      canNotify: true,
    };
    return {
      retailerId,
      async listStores() { return [store]; },
      async searchProducts() { return [product]; },
      async checkStock(_items, storeIds) {
        return storeIds.map((sid) => ({
          store: { ...store, storeId: sid },
          items: [{ ...oosEntry }],
        }));
      },
      async findStoresForCart() {
        return [{ store, items: [{ ...oosEntry }] }];
      },
    };
  }

  /** Minimal no-op adapter for the other retailer. */
  const emptyAdapter = (retailerId: string): RetailerAdapter => ({
    retailerId,
    async listStores() { return []; },
    async searchProducts() { return []; },
    async checkStock() { return []; },
    async findStoresForCart() { return []; },
  });

  it("sets hasOosProducts when primary product is OOS everywhere", async () => {
    const ceraveProduct = SHOPPERS_PRODUCTS.find((p) => p.itemNo === "cerave-hydrating-cleanser")!;
    const response = await handleBeautyQuery(
      { query: "cerave hydrating facial cleanser", mode: "best_match" },
      [emptyAdapter("sephora"), oosAdapter("shoppers", ceraveProduct)],
    );
    assert.equal(response.hasOosProducts, true);
    assert.equal(response.exactResults.length, 0, "no exact results when all OOS");
  });

  it("substitute results have correct matchKind and substituteFor", async () => {
    // charlotte-tilbury-flawless IS in stock at some stores — so we get exact results.
    // Among those stores where it's OOS, halo-glow should appear as a substitute.
    // We query with real adapters and check any substitute results are shaped correctly.
    const response = await handleBeautyQuery(
      { query: "charlotte tilbury flawless filter", mode: "best_match" },
      adapters,
    );
    // Some Sephora stores carry it (eaton-centre IN, yorkdale LOW)
    assert.ok(response.exactResults.length > 0, "should have exact results at stocked stores");

    // If any subs were generated for the OOS stores, verify their structure
    for (const r of response.substituteResults) {
      assert.equal(r.matchKind, "substitute");
      assert.ok(r.substituteFor !== undefined, "substituteFor must be set");
      assert.ok(typeof r.substituteReason === "string" && r.substituteReason.length > 0,
        "substituteReason must be a non-empty string");
    }
  });

  it("substitute results are not duplicated from exact results", async () => {
    const response = await handleBeautyQuery(
      { query: "charlotte tilbury flawless filter", mode: "best_match" },
      adapters,
    );
    const exactItemNos = new Set(
      response.exactResults.map((r) => `${r.product.retailer}::${r.product.itemNo}`),
    );
    for (const r of response.substituteResults) {
      assert.ok(
        !exactItemNos.has(`${r.product.retailer}::${r.product.itemNo}`),
        "substitute products should not repeat exact result products",
      );
    }
  });

  it("caps substitute results at 3", async () => {
    const response = await handleBeautyQuery(
      { query: "laneige lip sleeping mask", mode: "best_match" },
      adapters,
    );
    assert.ok(response.substituteResults.length <= 3);
  });
});

// ──────────────────────────────────────────────
// Invariants — hold across all queries and modes
// ──────────────────────────────────────────────

describe("handleBeautyQuery — invariants", () => {
  const testCases: Array<[string, BeautyQuery]> = [
    ["exact product / need_today",    { query: "laneige lip sleeping mask", mode: "need_today" }],
    ["exact product / best_value",    { query: "laneige lip sleeping mask", mode: "best_value" }],
    ["brand+product / best_value",    { query: "cerave cleanser", mode: "best_value" }],
    ["brand+product / need_today",    { query: "cerave cleanser", mode: "need_today" }],
    ["need based / best_match",       { query: "sunscreen sensitive skin", mode: "best_match" }],
    ["need based with location",      { query: "moisturizer", mode: "need_today", userLocation: YONGE_BLOOR }],
    ["empty query",                   { query: "   ", mode: "best_match" }],
    ["no results query",              { query: "sofa bookshelf lamp", mode: "best_match" }],
  ];

  for (const [name, query] of testCases) {
    it(`response shape is valid: ${name}`, async () => {
      const response = await handleBeautyQuery(query, adapters);

      assert.equal(typeof response.query, "string");
      assert.equal(response.mode, query.mode);
      assert.ok(Array.isArray(response.exactResults));
      assert.ok(Array.isArray(response.substituteResults));
      assert.ok(response.exactResults.length <= 4, "max 4 exact results");
      assert.ok(response.substituteResults.length <= 3, "max 3 substitute results");

      for (const r of response.exactResults) {
        assert.ok(r.availability.available, "exact results must be available");
        assert.equal(r.matchKind, "exact");
        assert.ok(r.score >= 0 && r.score <= 1, `score out of range: ${r.score}`);
        assert.ok(r.matchScore >= 0);
        assert.ok(r.rankReason.length > 0, "rankReason must not be empty");
      }

      // Exact results sorted descending by score
      const scores = response.exactResults.map((r) => r.score);
      for (let i = 1; i < scores.length; i++) {
        assert.ok(scores[i - 1] >= scores[i] - 1e-9,
          `score order violated at index ${i}: ${scores[i - 1]} < ${scores[i]}`);
      }

      for (const r of response.substituteResults) {
        assert.ok(r.availability.available, "substitute results must be available");
        assert.equal(r.matchKind, "substitute");
        assert.ok(r.score >= 0 && r.score <= 1);
      }

      // isEmpty must reflect reality
      const actuallyEmpty =
        response.exactResults.length === 0 && response.substituteResults.length === 0;
      assert.equal(response.isEmpty, actuallyEmpty);
    });
  }
});
