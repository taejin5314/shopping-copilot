import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreStore, rankStores, buildRecommendation } from "../src/domain/scoring.js";
import type { StoreStock } from "../src/core/types.js";
import { ALL_GOLDEN_SCENARIOS, makeStock } from "./golden-ranking-fixtures.js";

function makeStoreStock(
  storeId: string,
  items: Array<{ itemNo: string; quantity: number | null; available?: boolean }>,
): StoreStock {
  return {
    store: { retailer: "test", storeId, label: `Store ${storeId}` },
    items: items.map((i) => ({
      itemNo: i.itemNo,
      available: i.available ?? (i.quantity !== null && i.quantity > 0),
      quantity: i.quantity,
      stockLevel: null,
      canNotify: null,
    })),
  };
}

describe("scoreStore", () => {
  it("returns 1.0 coverage when all items sufficient", () => {
    const stock = makeStoreStock("A", [
      { itemNo: "001", quantity: 5 },
      { itemNo: "002", quantity: 3 },
    ]);
    const cart = [
      { itemNo: "001", quantity: 2 },
      { itemNo: "002", quantity: 1 },
    ];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 1.0);
    assert.ok(result.totalScore > 0);
    assert.equal(result.itemDetails.every((d) => d.sufficient), true);
  });

  it("returns 0.5 coverage when half the cart is satisfied", () => {
    const stock = makeStoreStock("B", [
      { itemNo: "001", quantity: 5 },
      { itemNo: "002", quantity: 0, available: false },
    ]);
    const cart = [
      { itemNo: "001", quantity: 2 },
      { itemNo: "002", quantity: 1 },
    ];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 0.5);
  });

  it("returns 0 coverage when no items available", () => {
    const stock = makeStoreStock("C", [
      { itemNo: "001", quantity: 0, available: false },
    ]);
    const cart = [{ itemNo: "001", quantity: 1 }];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 0);
    assert.equal(result.totalScore, 0);
  });

  it("handles null quantity as insufficient", () => {
    const stock = makeStoreStock("D", [
      { itemNo: "001", quantity: null, available: false },
    ]);
    const cart = [{ itemNo: "001", quantity: 1 }];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 0);
    assert.equal(result.itemDetails[0].sufficient, false);
  });

  it("treats missing item as insufficient", () => {
    const stock = makeStoreStock("E", []);
    const cart = [{ itemNo: "001", quantity: 1 }];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 0);
    assert.equal(result.itemDetails[0].available, null);
  });

  it("handles empty cart gracefully", () => {
    const stock = makeStoreStock("F", []);
    const result = scoreStore(stock, []);
    assert.equal(result.stockCoverageScore, 0);
    assert.equal(result.itemDetails.length, 0);
  });

  it("insufficient when quantity < requested", () => {
    const stock = makeStoreStock("G", [{ itemNo: "001", quantity: 2 }]);
    const cart = [{ itemNo: "001", quantity: 5 }];
    const result = scoreStore(stock, cart);
    assert.equal(result.stockCoverageScore, 0);
    assert.equal(result.itemDetails[0].sufficient, false);
  });
});

describe("rankStores", () => {
  it("sorts by totalScore descending", () => {
    const stores = [
      makeStoreStock("low", [{ itemNo: "001", quantity: 0, available: false }]),
      makeStoreStock("high", [{ itemNo: "001", quantity: 10 }]),
      makeStoreStock("mid", [{ itemNo: "001", quantity: 0, available: false }]),
    ];
    const cart = [{ itemNo: "001", quantity: 1 }];
    const ranked = rankStores(stores, cart);
    assert.equal(ranked[0].store.storeId, "high");
  });

  it("tie-breaks by storeId lexicographic", () => {
    const stores = [
      makeStoreStock("B", [{ itemNo: "001", quantity: 5 }]),
      makeStoreStock("A", [{ itemNo: "001", quantity: 5 }]),
    ];
    const cart = [{ itemNo: "001", quantity: 1 }];
    const ranked = rankStores(stores, cart);
    assert.equal(ranked[0].store.storeId, "A");
    assert.equal(ranked[1].store.storeId, "B");
  });
});

// ──────────────────────────────────────────────
// Golden ranking scenarios — regression guard for DEFAULT_WEIGHTS
//
// Scenarios are defined in test/golden-ranking-fixtures.ts and shared
// with scripts/scoring-tuner.ts. Adding a scenario there registers it here.
// ──────────────────────────────────────────────
describe("golden ranking scenarios", () => {
  for (const scenario of ALL_GOLDEN_SCENARIOS) {
    it(scenario.name, () => {
      const ranked = rankStores(scenario.stores, scenario.cart, undefined, scenario.ctx);
      scenario.expectedOrder.forEach((expectedId, i) => {
        assert.equal(
          ranked[i]?.store.storeId,
          expectedId,
          `[${scenario.name}] position ${i}: expected "${expectedId}", ` +
          `got "${ranked[i]?.store.storeId}" — ` +
          `scores: ${ranked.map(r => `${r.store.storeId}=${r.totalScore.toFixed(3)}`).join(", ")}`,
        );
      });
    });
  }
});

describe("buildRecommendation", () => {
  it("returns explanations for full coverage", () => {
    const stores = [
      makeStoreStock("A", [{ itemNo: "001", quantity: 5 }]),
    ];
    const cart = [{ itemNo: "001", quantity: 1 }];
    const ranked = rankStores(stores, cart);
    const rec = buildRecommendation(ranked, cart);
    assert.ok(rec.explanationPoints.some((p) => p.includes("all 1 item")));
    assert.equal(rec.warnings.length, 0);
  });

  it("warns when no store has full coverage", () => {
    const stores = [
      makeStoreStock("A", [
        { itemNo: "001", quantity: 5 },
        { itemNo: "002", quantity: 0, available: false },
      ]),
    ];
    const cart = [
      { itemNo: "001", quantity: 1 },
      { itemNo: "002", quantity: 1 },
    ];
    const ranked = rankStores(stores, cart);
    const rec = buildRecommendation(ranked, cart);
    assert.ok(rec.warnings.some((w) => w.includes("002")));
    assert.ok(rec.warnings.some((w) => w.includes("splitting")));
  });

  it("returns empty with warning when no stores", () => {
    const rec = buildRecommendation([], [{ itemNo: "001", quantity: 1 }]);
    assert.equal(rec.ranked.length, 0);
    assert.ok(rec.warnings.some((w) => w.includes("No stores found")));
  });

  it("respects maxResults", () => {
    const stores = [
      makeStoreStock("A", [{ itemNo: "001", quantity: 5 }]),
      makeStoreStock("B", [{ itemNo: "001", quantity: 4 }]),
      makeStoreStock("C", [{ itemNo: "001", quantity: 3 }]),
    ];
    const cart = [{ itemNo: "001", quantity: 1 }];
    const ranked = rankStores(stores, cart);
    const rec = buildRecommendation(ranked, cart, 2);
    assert.equal(rec.ranked.length, 2);
  });
});
