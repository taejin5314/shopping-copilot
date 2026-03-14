import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { haversineKm, distanceToScore } from "../src/domain/geo.js";
import { scoreStore, rankStores } from "../src/domain/scoring.js";
import type { StoreStock } from "../src/core/types.js";
import type { GeoCoord } from "../src/domain/geo.js";

// ── Haversine tests ──

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    const p: GeoCoord = { lat: 43.65, lng: -79.38 };
    assert.equal(haversineKm(p, p), 0);
  });

  it("computes Toronto → Montreal (~504 km)", () => {
    const toronto: GeoCoord = { lat: 43.6532, lng: -79.3832 };
    const montreal: GeoCoord = { lat: 45.5017, lng: -73.5673 };
    const d = haversineKm(toronto, montreal);
    assert.ok(d > 490 && d < 520, `Expected ~504 km, got ${d.toFixed(1)}`);
  });

  it("computes Toronto → Vancouver (~3350 km)", () => {
    const toronto: GeoCoord = { lat: 43.6532, lng: -79.3832 };
    const vancouver: GeoCoord = { lat: 49.2827, lng: -123.1207 };
    const d = haversineKm(toronto, vancouver);
    assert.ok(d > 3300 && d < 3400, `Expected ~3350 km, got ${d.toFixed(1)}`);
  });
});

// ── distanceToScore tests ──

describe("distanceToScore", () => {
  it("returns 1.0 for 0 km", () => {
    assert.equal(distanceToScore(0), 1.0);
  });

  it("returns 0.5 at half-life distance (default 50 km)", () => {
    const score = distanceToScore(50);
    assert.ok(Math.abs(score - 0.5) < 0.001, `Expected 0.5, got ${score}`);
  });

  it("returns ~0.33 at 100 km", () => {
    const score = distanceToScore(100);
    assert.ok(Math.abs(score - 1 / 3) < 0.01, `Expected ~0.33, got ${score}`);
  });

  it("approaches 0 at large distances", () => {
    assert.ok(distanceToScore(10_000) < 0.01);
  });

  it("respects custom half-life", () => {
    const score = distanceToScore(100, 100);
    assert.ok(Math.abs(score - 0.5) < 0.001);
  });

  it("handles negative distance as 1.0", () => {
    assert.equal(distanceToScore(-5), 1.0);
  });
});

// ── Score store with distance ──

function makeStoreStock(
  storeId: string,
  items: Array<{ itemNo: string; quantity: number }>,
  coords?: GeoCoord,
): StoreStock {
  return {
    store: { retailer: "test", storeId, label: `Store ${storeId}`, coords },
    items: items.map((i) => ({
      itemNo: i.itemNo,
      available: i.quantity > 0,
      quantity: i.quantity,
      stockLevel: null,
      canNotify: null,
    })),
  };
}

describe("scoreStore with distance", () => {
  const user: GeoCoord = { lat: 43.65, lng: -79.38 }; // Toronto downtown
  const cart = [{ itemNo: "001", quantity: 1 }];

  it("computes distanceScore when both coords present", () => {
    const nearby: GeoCoord = { lat: 43.66, lng: -79.40 }; // ~2 km away
    const stock = makeStoreStock("A", [{ itemNo: "001", quantity: 5 }], nearby);
    const result = scoreStore(stock, cart, undefined, { userLocation: user });
    assert.ok(result.distanceScore !== null);
    assert.ok(result.distanceScore! > 0.9, `Expected >0.9 for nearby, got ${result.distanceScore}`);
  });

  it("returns null distanceScore when user location missing", () => {
    const stock = makeStoreStock("A", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 });
    const result = scoreStore(stock, cart);
    assert.equal(result.distanceScore, null);
  });

  it("returns null distanceScore when store coords missing", () => {
    const stock = makeStoreStock("A", [{ itemNo: "001", quantity: 5 }]);
    const result = scoreStore(stock, cart, undefined, { userLocation: user });
    assert.equal(result.distanceScore, null);
  });

  it("far store gets lower distanceScore than near store", () => {
    const near = makeStoreStock("near", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 });
    const far = makeStoreStock("far", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 }); // Vancouver

    const nearScore = scoreStore(near, cart, undefined, { userLocation: user });
    const farScore = scoreStore(far, cart, undefined, { userLocation: user });

    assert.ok(nearScore.distanceScore! > farScore.distanceScore!);
  });

  it("distance affects totalScore", () => {
    const near = makeStoreStock("near", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 });
    const far = makeStoreStock("far", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 });

    const nearResult = scoreStore(near, cart, undefined, { userLocation: user });
    const farResult = scoreStore(far, cart, undefined, { userLocation: user });

    // Both have 100% stock coverage, but near should have higher total due to distance
    assert.ok(nearResult.totalScore > farResult.totalScore);
  });
});

// ── Ranking with distance ──

describe("rankStores with distance", () => {
  const user: GeoCoord = { lat: 43.65, lng: -79.38 };
  const cart = [{ itemNo: "001", quantity: 1 }];

  it("nearby store outranks farther store with equal stock", () => {
    const stores = [
      makeStoreStock("far", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 }),
      makeStoreStock("near", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 }),
    ];
    const ranked = rankStores(stores, cart, undefined, { userLocation: user });
    assert.equal(ranked[0].store.storeId, "near");
    assert.equal(ranked[1].store.storeId, "far");
  });

  it("better stock still beats closer distance", () => {
    const stores = [
      // Near but no stock
      makeStoreStock("near-empty", [{ itemNo: "001", quantity: 0 }], { lat: 43.66, lng: -79.40 }),
      // Far but has stock
      makeStoreStock("far-stocked", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 }),
    ];
    const ranked = rankStores(stores, cart, undefined, { userLocation: user });
    assert.equal(ranked[0].store.storeId, "far-stocked");
  });

  it("works with mixed stores — some with coords, some without", () => {
    const stores = [
      makeStoreStock("no-coords", [{ itemNo: "001", quantity: 5 }]),
      makeStoreStock("with-coords", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 }),
    ];
    const ranked = rankStores(stores, cart, undefined, { userLocation: user });
    // Store with coords gets distanceScore boost; store without gets 0
    assert.equal(ranked[0].store.storeId, "with-coords");
    assert.equal(ranked[0].distanceScore !== null, true);
    assert.equal(ranked[1].distanceScore, null);
  });

  it("ranking is stable when no user location provided", () => {
    const stores = [
      makeStoreStock("B", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 }),
      makeStoreStock("A", [{ itemNo: "001", quantity: 5 }], { lat: 43.66, lng: -79.40 }),
    ];
    // Without location, distance weight has no effect → tie-break by storeId
    const ranked = rankStores(stores, cart);
    assert.equal(ranked[0].store.storeId, "A");
    assert.equal(ranked[1].store.storeId, "B");
    assert.equal(ranked[0].distanceScore, null);
  });
});
