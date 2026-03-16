/**
 * Adapter health and contract-drift tests.
 *
 * These tests simulate realistic failure modes that arise when retailer APIs or
 * MCP tool response shapes change silently:
 *   - missing itemNo / name / storeId
 *   - malformed price or negative values
 *   - non-boolean availability flags
 *   - duplicate product explosion (pagination bug)
 *   - collapsed variants (mapping regression)
 *   - invalid coordinates (haversineKm breaks)
 *   - non-array return shapes
 *   - cart items not covered by stock responses
 *
 * All checks are deterministic — no LLM, no network, no adapters required.
 * Tests assert on `status` and `check` fields of HealthCheckResult so they
 * are resilient to message wording changes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkProductSearchResults,
  checkStoreStockResults,
  checkStoreListResults,
  checkCandidateNormalization,
  buildHealthSummary,
  logHealthResults,
} from "./adapter-health.js";
import type { HealthCheckResult } from "./adapter-health.js";
import type { ProductInfo, StoreRef, StoreStock } from "../src/core/types.js";
import type { ProductCandidate } from "../src/domain/product-finder.js";

// ── Fixture builders ──

function makeProduct(overrides: Partial<ProductInfo> & { itemNo: string; name: string }): ProductInfo {
  return {
    retailer: "ikea",
    typeName: "Furniture",
    price: { amount: 499, currency: "CAD" },
    url: "https://example.com/item",
    measureText: null,
    designText: null,
    imageUrl: null,
    ...overrides,
  };
}

function makeStore(overrides: Partial<StoreRef> & { storeId: string }): StoreRef {
  return {
    retailer: "ikea",
    label: "IKEA Store",
    coords: { lat: 43.6, lng: -79.4 },
    ...overrides,
  };
}

function makeStoreStock(storeId: string, itemNos: string[]): StoreStock {
  return {
    store: makeStore({ storeId, label: `Store ${storeId}` }),
    items: itemNos.map((itemNo) => ({
      itemNo,
      available: true,
      quantity: 5,
      stockLevel: "HIGH_IN_STOCK",
      canNotify: null,
    })),
  };
}

function makeCandidate(overrides: Partial<ProductCandidate> & { itemNo: string; name: string }): ProductCandidate {
  return {
    retailer: "ikea",
    productId: overrides.itemNo,
    variantId: null,
    typeName: "Furniture",
    price: 499,
    currency: "CAD",
    url: "https://example.com",
    imageUrl: null,
    matchScore: 0.8,
    matchedFromKeywords: [],
    warnings: [],
    measureText: null,
    designText: null,
    ...overrides,
  };
}

// ── Helper: find result by check name ──

function findCheck(results: HealthCheckResult[], check: string): HealthCheckResult | undefined {
  return results.find((r) => r.check === check);
}

function assertCheck(results: HealthCheckResult[], check: string, expectedStatus: "ok" | "warn" | "fail"): void {
  const r = findCheck(results, check);
  assert.ok(r, `Check "${check}" not found in results`);
  assert.equal(r.status, expectedStatus,
    `Check "${check}": expected ${expectedStatus}, got ${r.status} — "${r.message}"`);
}

// ────────────────────────────────────────────────
// checkProductSearchResults
// ────────────────────────────────────────────────

describe("adapter health: checkProductSearchResults — valid output", () => {
  it("all checks pass for a well-formed product list", () => {
    const products = [
      makeProduct({ itemNo: "001", name: "SÖDERHAMN Sofa", designText: "Beige" }),
      makeProduct({ itemNo: "002", name: "SÖDERHAMN Sofa", designText: "Blue" }),
    ];
    const results = checkProductSearchResults("ikea", products);
    const summary = buildHealthSummary(results);
    assert.equal(summary.fail, 0, `Unexpected failures: ${JSON.stringify(results.filter((r) => r.status === "fail"))}`);
    assert.equal(summary.warn, 0, `Unexpected warnings: ${JSON.stringify(results.filter((r) => r.status === "warn"))}`);
  });
});

describe("adapter health: checkProductSearchResults — missing itemNo", () => {
  it("warns when some items have missing itemNo", () => {
    const products = [
      makeProduct({ itemNo: "001", name: "Valid Product" }),
      { ...makeProduct({ itemNo: "002", name: "Broken Product" }), itemNo: "" },
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:itemNo-present", "warn");
  });

  it("warns when all items have empty itemNo", () => {
    const products = [
      { ...makeProduct({ itemNo: "001", name: "Product A" }), itemNo: "" },
      { ...makeProduct({ itemNo: "002", name: "Product B" }), itemNo: "" },
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:itemNo-present", "warn");
  });
});

describe("adapter health: checkProductSearchResults — missing name", () => {
  it("fails when any item has an empty name", () => {
    const products = [
      makeProduct({ itemNo: "001", name: "Valid" }),
      { ...makeProduct({ itemNo: "002", name: "Will Override" }), name: "" },
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:name-present", "fail");
  });
});

describe("adapter health: checkProductSearchResults — price shape", () => {
  it("passes for null price (allowed)", () => {
    const products = [makeProduct({ itemNo: "001", name: "No Price", price: null })];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:price-shape", "ok");
  });

  it("warns for negative price amount", () => {
    const products = [
      { ...makeProduct({ itemNo: "001", name: "Negative Price" }), price: { amount: -50, currency: "CAD" } },
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:price-shape", "warn");
  });

  it("warns for missing currency in price", () => {
    const badProduct = {
      ...makeProduct({ itemNo: "001", name: "Bad Currency" }),
      price: { amount: 100, currency: "" } as ProductInfo["price"],
    };
    const results = checkProductSearchResults("ikea", [badProduct]);
    assertCheck(results, "search:price-shape", "warn");
  });

  it("warns for non-number amount", () => {
    const badProduct = {
      ...makeProduct({ itemNo: "001", name: "String Price" }),
      price: { amount: "not-a-number", currency: "CAD" } as unknown as ProductInfo["price"],
    };
    const results = checkProductSearchResults("ikea", [badProduct]);
    assertCheck(results, "search:price-shape", "warn");
  });
});

describe("adapter health: checkProductSearchResults — duplicate explosion", () => {
  it("warns when more than 50% of itemNos are duplicates", () => {
    // 6 items, only 2 unique SKUs → 67% duplicates
    const products = Array.from({ length: 6 }, (_, i) =>
      makeProduct({ itemNo: i < 3 ? "001" : "002", name: `Product ${i}` }),
    );
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:no-duplicate-explosion", "warn");
  });

  it("passes for all-unique itemNos", () => {
    const products = [
      makeProduct({ itemNo: "001", name: "Product A" }),
      makeProduct({ itemNo: "002", name: "Product B" }),
      makeProduct({ itemNo: "003", name: "Product C" }),
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:no-duplicate-explosion", "ok");
  });
});

describe("adapter health: checkProductSearchResults — retailer field", () => {
  it("warns when product retailer does not match adapter", () => {
    const products = [
      { ...makeProduct({ itemNo: "001", name: "Product" }), retailer: "structube" },
    ];
    const results = checkProductSearchResults("ikea", products);
    assertCheck(results, "search:retailer-field", "warn");
  });
});

describe("adapter health: checkProductSearchResults — empty result", () => {
  it("warns (not fails) for empty array", () => {
    const results = checkProductSearchResults("ikea", []);
    assertCheck(results, "search:non-empty", "warn");
  });
});

describe("adapter health: checkProductSearchResults — non-array", () => {
  it("fails immediately for non-array return", () => {
    const results = checkProductSearchResults("ikea", null as unknown as ProductInfo[]);
    assertCheck(results, "search:array-shape", "fail");
    // Only one check result should exist (early return)
    assert.equal(results.length, 1);
  });
});

// ────────────────────────────────────────────────
// checkStoreStockResults
// ────────────────────────────────────────────────

describe("adapter health: checkStoreStockResults — valid output", () => {
  it("all checks pass for well-formed stock results", () => {
    const stocks = [
      makeStoreStock("store-1", ["001", "002"]),
      makeStoreStock("store-2", ["001", "002"]),
    ];
    const results = checkStoreStockResults("ikea", stocks, ["001", "002"]);
    const summary = buildHealthSummary(results);
    assert.equal(summary.fail, 0);
    assert.equal(summary.warn, 0);
  });
});

describe("adapter health: checkStoreStockResults — missing storeId", () => {
  it("fails when storeId is missing", () => {
    const stock: StoreStock = {
      store: { retailer: "ikea", storeId: "", label: "Unknown Store" },
      items: [{ itemNo: "001", available: true, quantity: 3, stockLevel: "HIGH", canNotify: null }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:store-id-present", "fail");
  });
});

describe("adapter health: checkStoreStockResults — missing store label", () => {
  it("warns when store label is empty", () => {
    const stock: StoreStock = {
      store: { retailer: "ikea", storeId: "store-1", label: "" },
      items: [{ itemNo: "001", available: true, quantity: 3, stockLevel: null, canNotify: null }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:store-label-present", "warn");
  });
});

describe("adapter health: checkStoreStockResults — non-boolean available", () => {
  it("fails when available is a string 'true' instead of boolean", () => {
    const stock: StoreStock = {
      store: makeStore({ storeId: "store-1" }),
      items: [{
        itemNo: "001",
        available: "true" as unknown as boolean,
        quantity: 3,
        stockLevel: null,
        canNotify: null,
      }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:available-is-boolean", "fail");
  });

  it("fails when available is a number 1 instead of boolean", () => {
    const stock: StoreStock = {
      store: makeStore({ storeId: "store-1" }),
      items: [{
        itemNo: "001",
        available: 1 as unknown as boolean,
        quantity: 3,
        stockLevel: null,
        canNotify: null,
      }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:available-is-boolean", "fail");
  });
});

describe("adapter health: checkStoreStockResults — negative quantity", () => {
  it("warns for negative quantity", () => {
    const stock: StoreStock = {
      store: makeStore({ storeId: "store-1" }),
      items: [{ itemNo: "001", available: false, quantity: -3, stockLevel: null, canNotify: null }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:quantity-sane", "warn");
  });

  it("passes for null quantity (unknown stock level)", () => {
    const stock: StoreStock = {
      store: makeStore({ storeId: "store-1" }),
      items: [{ itemNo: "001", available: false, quantity: null, stockLevel: "UNKNOWN", canNotify: null }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    assertCheck(results, "stock:quantity-sane", "ok");
  });
});

describe("adapter health: checkStoreStockResults — cart coverage", () => {
  it("warns when a requested cart item is absent from all store responses", () => {
    const stocks = [makeStoreStock("store-1", ["001"])]; // "002" missing
    const results = checkStoreStockResults("ikea", stocks, ["001", "002"]);
    assertCheck(results, "stock:cart-coverage", "warn");
  });

  it("passes when all cart items appear in at least one store", () => {
    const stocks = [makeStoreStock("store-1", ["001", "002"])];
    const results = checkStoreStockResults("ikea", stocks, ["001", "002"]);
    assertCheck(results, "stock:cart-coverage", "ok");
  });
});

describe("adapter health: checkStoreStockResults — non-array items", () => {
  it("fails when StoreStock.items is not an array", () => {
    const stock = {
      store: makeStore({ storeId: "store-1" }),
      items: null,
    } as unknown as StoreStock;
    const results = checkStoreStockResults("ikea", [stock], []);
    assertCheck(results, "stock:items-array-shape", "fail");
  });
});

describe("adapter health: checkStoreStockResults — empty array", () => {
  it("passes for empty stock response (no stores in range)", () => {
    const results = checkStoreStockResults("ikea", [], []);
    assertCheck(results, "stock:array-shape", "ok");
    assertCheck(results, "stock:non-empty", "ok");
  });
});

describe("adapter health: checkStoreStockResults — non-array return", () => {
  it("fails immediately for non-array response", () => {
    const results = checkStoreStockResults("ikea", null as unknown as StoreStock[], []);
    assertCheck(results, "stock:array-shape", "fail");
    assert.equal(results.length, 1);
  });
});

// ────────────────────────────────────────────────
// checkStoreListResults
// ────────────────────────────────────────────────

describe("adapter health: checkStoreListResults — valid output", () => {
  it("all checks pass for well-formed store list", () => {
    const stores = [
      makeStore({ storeId: "421", label: "IKEA Coquitlam", retailer: "ikea", coords: { lat: 49.25, lng: -122.8 } }),
      makeStore({ storeId: "422", label: "IKEA Boucherville", retailer: "ikea", coords: { lat: 45.6, lng: -73.4 } }),
    ];
    const results = checkStoreListResults("ikea", stores);
    const summary = buildHealthSummary(results);
    assert.equal(summary.fail, 0);
    assert.equal(summary.warn, 0);
  });
});

describe("adapter health: checkStoreListResults — missing storeId", () => {
  it("fails when storeId is missing", () => {
    const stores = [{ ...makeStore({ storeId: "421" }), storeId: "" }];
    const results = checkStoreListResults("ikea", stores);
    assertCheck(results, "stores:storeId-present", "fail");
  });
});

describe("adapter health: checkStoreListResults — missing label", () => {
  it("warns when label is empty", () => {
    const stores = [{ ...makeStore({ storeId: "421" }), label: "" }];
    const results = checkStoreListResults("ikea", stores);
    assertCheck(results, "stores:label-present", "warn");
  });
});

describe("adapter health: checkStoreListResults — invalid coordinates", () => {
  it("warns for latitude out of range", () => {
    const stores = [makeStore({ storeId: "421", coords: { lat: 200, lng: -79.4 } })];
    const results = checkStoreListResults("ikea", stores);
    assertCheck(results, "stores:coords-shape", "warn");
  });

  it("warns for longitude out of range", () => {
    const stores = [makeStore({ storeId: "421", coords: { lat: 43.6, lng: 999 } })];
    const results = checkStoreListResults("ikea", stores);
    assertCheck(results, "stores:coords-shape", "warn");
  });

  it("warns for NaN coordinates", () => {
    const stores = [makeStore({ storeId: "421", coords: { lat: NaN, lng: -79.4 } })];
    const results = checkStoreListResults("ikea", stores);
    assertCheck(results, "stores:coords-shape", "warn");
  });

  it("passes when coords are absent (not all adapters provide coords)", () => {
    const stores = [{ ...makeStore({ storeId: "421" }), coords: undefined }];
    const results = checkStoreListResults("ikea", stores);
    // No coords-shape check when no coords present
    assert.ok(!findCheck(results, "stores:coords-shape") || findCheck(results, "stores:coords-shape")!.status === "ok");
  });
});

describe("adapter health: checkStoreListResults — empty store list", () => {
  it("passes for empty list (valid for non-CA country codes)", () => {
    const results = checkStoreListResults("structube", []);
    assertCheck(results, "stores:array-shape", "ok");
  });
});

// ────────────────────────────────────────────────
// checkCandidateNormalization
// ────────────────────────────────────────────────

describe("adapter health: checkCandidateNormalization — valid output", () => {
  it("all checks pass for well-formed candidates", () => {
    const candidates = [
      makeCandidate({ itemNo: "001", name: "SÖDERHAMN Sofa", matchScore: 0.85 }),
      makeCandidate({ itemNo: "002", name: "EKTORP Sofa", matchScore: 0.70 }),
    ];
    const results = checkCandidateNormalization("ikea", candidates);
    const summary = buildHealthSummary(results);
    assert.equal(summary.fail, 0);
    assert.equal(summary.warn, 0);
  });
});

describe("adapter health: checkCandidateNormalization — matchScore out of range", () => {
  it("fails when matchScore exceeds 1", () => {
    const candidates = [makeCandidate({ itemNo: "001", name: "Sofa", matchScore: 1.5 })];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:matchScore-range", "fail");
  });

  it("fails when matchScore is negative", () => {
    const candidates = [makeCandidate({ itemNo: "001", name: "Sofa", matchScore: -0.1 })];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:matchScore-range", "fail");
  });

  it("fails when matchScore is NaN", () => {
    const candidates = [makeCandidate({ itemNo: "001", name: "Sofa", matchScore: NaN })];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:matchScore-range", "fail");
  });

  it("passes for matchScore at boundary values 0 and 1", () => {
    const candidates = [
      makeCandidate({ itemNo: "001", name: "A", matchScore: 0 }),
      makeCandidate({ itemNo: "002", name: "B", matchScore: 1 }),
    ];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:matchScore-range", "ok");
  });
});

describe("adapter health: checkCandidateNormalization — itemNo preserved", () => {
  it("warns when both itemNo and productId are absent", () => {
    const candidates = [{
      ...makeCandidate({ itemNo: "001", name: "Sofa" }),
      itemNo: null,
      productId: "",
    }];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:itemNo-preserved", "warn");
  });

  it("passes when only productId is set (itemNo null)", () => {
    const candidates = [makeCandidate({ itemNo: null as unknown as string, name: "Sofa" })];
    (candidates[0] as unknown as Record<string, unknown>).productId = "PROD-99";
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:itemNo-preserved", "ok");
  });
});

describe("adapter health: checkCandidateNormalization — price preserved", () => {
  it("warns when all candidates have null price (possible mapProduct regression)", () => {
    const candidates = [
      { ...makeCandidate({ itemNo: "001", name: "A" }), price: null },
      { ...makeCandidate({ itemNo: "002", name: "B" }), price: null },
    ];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:price-preserved", "warn");
  });

  it("passes when at least one candidate has a price", () => {
    const candidates = [
      { ...makeCandidate({ itemNo: "001", name: "A" }), price: 299 },
      { ...makeCandidate({ itemNo: "002", name: "B" }), price: null },
    ];
    const results = checkCandidateNormalization("ikea", candidates);
    assertCheck(results, "candidates:price-preserved", "ok");
  });
});

// ────────────────────────────────────────────────
// buildHealthSummary
// ────────────────────────────────────────────────

describe("buildHealthSummary", () => {
  it("counts ok/warn/fail correctly", () => {
    const results: HealthCheckResult[] = [
      { adapter: "ikea", check: "search:itemNo-present", status: "ok", message: "" },
      { adapter: "ikea", check: "search:name-present", status: "warn", message: "" },
      { adapter: "ikea", check: "search:array-shape", status: "fail", message: "" },
    ];
    const summary = buildHealthSummary(results);
    assert.equal(summary.total, 3);
    assert.equal(summary.ok, 1);
    assert.equal(summary.warn, 1);
    assert.equal(summary.fail, 1);
  });

  it("reports failedAdapters from fail results only", () => {
    const results: HealthCheckResult[] = [
      { adapter: "ikea", check: "search:array-shape", status: "fail", message: "" },
      { adapter: "structube", check: "search:name-present", status: "warn", message: "" },
    ];
    const summary = buildHealthSummary(results);
    assert.deepEqual(summary.failedAdapters, ["ikea"]);
  });

  it("degradedChecks includes both fail and warn check names (distinct)", () => {
    const results: HealthCheckResult[] = [
      { adapter: "ikea", check: "search:array-shape", status: "fail", message: "" },
      { adapter: "ikea", check: "search:array-shape", status: "fail", message: "" }, // duplicate
      { adapter: "ikea", check: "search:name-present", status: "warn", message: "" },
    ];
    const summary = buildHealthSummary(results);
    assert.equal(summary.degradedChecks.length, 2);
    assert.ok(summary.degradedChecks.includes("search:array-shape"));
    assert.ok(summary.degradedChecks.includes("search:name-present"));
  });

  it("totals are consistent (ok + warn + fail === total)", () => {
    const results: HealthCheckResult[] = [
      { adapter: "ikea", check: "a", status: "ok", message: "" },
      { adapter: "ikea", check: "b", status: "warn", message: "" },
      { adapter: "ikea", check: "c", status: "ok", message: "" },
      { adapter: "ikea", check: "d", status: "fail", message: "" },
    ];
    const summary = buildHealthSummary(results);
    assert.equal(summary.ok + summary.warn + summary.fail, summary.total);
  });

  it("empty results produce all-zero summary", () => {
    const summary = buildHealthSummary([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.ok, 0);
    assert.equal(summary.warn, 0);
    assert.equal(summary.fail, 0);
    assert.deepEqual(summary.failedAdapters, []);
    assert.deepEqual(summary.degradedChecks, []);
  });
});

// ────────────────────────────────────────────────
// logHealthResults
// ────────────────────────────────────────────────

describe("logHealthResults", () => {
  it("does not throw for any status value", () => {
    const results: HealthCheckResult[] = [
      { adapter: "ikea", check: "search:array-shape", status: "ok", message: "ok" },
      { adapter: "ikea", check: "search:itemNo-present", status: "warn", message: "warn", metadata: { count: 2 } },
      { adapter: "ikea", check: "search:name-present", status: "fail", message: "fail" },
    ];
    assert.doesNotThrow(() => logHealthResults(results));
  });
});

// ────────────────────────────────────────────────
// Cross-adapter scenario: Structube-style product shape
// ────────────────────────────────────────────────

describe("adapter health: Structube adapter contract shape", () => {
  it("passes all checks for Structube-style products (typeName=product, no designText)", () => {
    const products: ProductInfo[] = [
      {
        retailer: "structube",
        itemNo: "sofa-01",
        name: "Rodez Sofa",
        typeName: "product",
        price: { amount: 1299, currency: "CAD" },
        url: "https://www.structube.com/en_ca/rodez-sofa",
        measureText: null,
        designText: null,
        imageUrl: "https://cdn.structube.com/img.jpg",
      },
    ];
    const results = checkProductSearchResults("structube", products);
    const summary = buildHealthSummary(results);
    assert.equal(summary.fail, 0);
    assert.equal(summary.warn, 0);
  });

  it("catches retailer field drift — structube products tagged as ikea", () => {
    const products: ProductInfo[] = [
      {
        retailer: "ikea",  // wrong — should be structube
        itemNo: "sofa-01",
        name: "Rodez Sofa",
        typeName: "product",
        price: { amount: 1299, currency: "CAD" },
        url: "https://www.structube.com/en_ca/rodez-sofa",
        measureText: null,
        designText: null,
        imageUrl: null,
      },
    ];
    const results = checkProductSearchResults("structube", products);
    assertCheck(results, "search:retailer-field", "warn");
  });
});

// ────────────────────────────────────────────────
// Aggregate scenario: realistic drift simulation
// ────────────────────────────────────────────────

describe("adapter health: realistic drift scenario — partial contract break", () => {
  it("produces a warn summary when itemNo is missing from some products", () => {
    const products = [
      makeProduct({ itemNo: "001", name: "Good Product" }),
      { ...makeProduct({ itemNo: "002", name: "Drifted Product" }), itemNo: "" },
      makeProduct({ itemNo: "003", name: "Good Product 2" }),
    ];
    const results = checkProductSearchResults("ikea", products);
    const summary = buildHealthSummary(results);
    assert.ok(summary.warn > 0, "should have at least one warning for missing itemNo");
    assert.equal(summary.fail, 0, "missing itemNo is warn not fail");
  });

  it("produces a fail summary when name is missing (breaks downstream query building)", () => {
    const products = [
      { ...makeProduct({ itemNo: "001", name: "OK" }) },
      { ...makeProduct({ itemNo: "002", name: "" }) },
    ];
    const results = checkProductSearchResults("ikea", products);
    const summary = buildHealthSummary(results);
    assert.ok(summary.fail > 0, "missing name should be a fail");
    assert.ok(summary.failedAdapters.includes("ikea"));
  });

  it("produces a fail summary when storeId is missing from stock result", () => {
    const stock: StoreStock = {
      store: { retailer: "ikea", storeId: "", label: "Some Store" },
      items: [{ itemNo: "001", available: true, quantity: 1, stockLevel: null, canNotify: null }],
    };
    const results = checkStoreStockResults("ikea", [stock], ["001"]);
    const summary = buildHealthSummary(results);
    assert.ok(summary.fail > 0);
  });
});
