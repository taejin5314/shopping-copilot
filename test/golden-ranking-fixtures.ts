/**
 * Shared golden ranking scenarios for scoring tests and the offline tuner.
 *
 * Adding a scenario here automatically registers it in both:
 *   - test/scoring.test.ts  (regression guard via node:test)
 *   - scripts/scoring-tuner.ts (coordinate-descent objective)
 *
 * Scenario sources:
 *   [hand] — logically derived from scoring design intent
 *   [log:ci-sample-001] — pattern from ci/sample-review-input.json record 001
 *   [log:ci-sample-002] — pattern from ci/sample-review-input.json record 002
 *   [log:ci-sample-003] — pattern from ci/sample-review-input.json record 003
 *   [log:fixture-001]   — ci/fix-001.json, extracted via extract-ranking-scenarios CLI
 *   [log:fixture-002]   — ci/fix-002.json, extracted via extract-ranking-scenarios CLI
 *   [log:fixture-003]   — ci/fix-003.json, extracted via extract-ranking-scenarios CLI
 *
 * Scenarios labelled [log:ci-sample-*] are hand-authored to reflect query/intent
 * patterns. Scenarios labelled [log:fixture-*] were created as structured JSON
 * fixtures (ci/fix-*.json) and processed through the extract-ranking-scenarios CLI,
 * validating the full log→import→extract→promote pipeline end-to-end.
 */

import type { StoreStock } from "../src/core/types.js";
import type { ScoringContext } from "../src/domain/scoring.js";
import type { CaptureRecord } from "../src/capture/capture-record.js";

// ── Types ──

export interface GoldenScenario {
  name: string;
  /** Query pattern this scenario was derived from, for traceability. */
  source: string;
  stores: StoreStock[];
  cart: Array<{ itemNo: string; quantity: number }>;
  ctx?: ScoringContext;
  /** Required rank order: index 0 = best store. Must match ranked output exactly. */
  expectedOrder: string[];
}

// ── Helpers ──

/** Reference user location: downtown Vancouver. */
export const USER_VANCOUVER = { lat: 49.24, lng: -123.12 };

/** Reference user location: Midtown Manhattan, NYC. */
export const USER_NYC = { lat: 40.71, lng: -73.96 };

export function makeStock(
  storeId: string,
  items: Array<{ itemNo: string; quantity: number | null; stockLevel?: string }>,
  coords?: { lat: number; lng: number },
): StoreStock {
  return {
    store: { retailer: "test", storeId, label: `Store ${storeId}`, coords },
    items: items.map((i) => ({
      itemNo: i.itemNo,
      available: i.quantity !== null && i.quantity > 0,
      quantity: i.quantity,
      stockLevel: i.stockLevel ?? null,
      canNotify: null,
    })),
  };
}

// ── Scenarios ──

/**
 * Scenario 1 [hand]: Closer store wins when stock is equal.
 * near (~5 km) vs far (~60 km) — identical stock → distance decides.
 */
const CLOSER_WINS: GoldenScenario = {
  name: "closer-wins",
  source: "hand",
  stores: [
    makeStock("near", [{ itemNo: "001", quantity: 10 }], { lat: 49.28, lng: -123.12 }),
    makeStock("far", [{ itemNo: "001", quantity: 10 }], { lat: 49.82, lng: -123.12 }),
  ],
  cart: [{ itemNo: "001", quantity: 1 }],
  ctx: { userLocation: USER_VANCOUVER },
  expectedOrder: ["near", "far"],
};

/**
 * Scenario 2 [hand]: Full-stock far store beats partial-stock near store.
 * stockCoverage weight (0.5) dominates distance weight (0.1).
 */
const FULL_STOCK_FAR_BEATS_PARTIAL_NEAR: GoldenScenario = {
  name: "full-stock-far-beats-partial-near",
  source: "hand",
  stores: [
    makeStock("full", [{ itemNo: "001", quantity: 5 }, { itemNo: "002", quantity: 5 }], { lat: 49.82, lng: -123.12 }),
    makeStock("partial", [{ itemNo: "001", quantity: 5 }, { itemNo: "002", quantity: 0 }], { lat: 49.28, lng: -123.12 }),
  ],
  cart: [{ itemNo: "001", quantity: 1 }, { itemNo: "002", quantity: 1 }],
  ctx: { userLocation: USER_VANCOUVER },
  expectedOrder: ["full", "partial"],
};

/**
 * Scenario 3 [hand]: Cheaper store wins when stock and distance are equal.
 * Exercises applyPriceScores — minCost store gets priceScore=1.0.
 */
const CHEAPER_WINS: GoldenScenario = {
  name: "cheaper-wins",
  source: "hand",
  stores: [
    makeStock("cheap", [{ itemNo: "001", quantity: 10 }], { lat: 49.28, lng: -123.12 }),
    makeStock("expensive", [{ itemNo: "001", quantity: 10 }], { lat: 49.28, lng: -123.12 }),
  ],
  cart: [{ itemNo: "001", quantity: 1 }],
  ctx: {
    userLocation: USER_VANCOUVER,
    getItemPrice: (storeId: string, _itemNo: string) => storeId === "cheap" ? 199 : 499,
  },
  expectedOrder: ["cheap", "expensive"],
};

/**
 * Scenario 4 [hand]: Three-way ranking sanity check.
 * full+near > full+far > no-stock+far
 */
const THREE_WAY: GoldenScenario = {
  name: "three-way",
  source: "hand",
  stores: [
    makeStock("best", [{ itemNo: "001", quantity: 10 }], { lat: 49.28, lng: -123.12 }),
    makeStock("mid", [{ itemNo: "001", quantity: 10 }], { lat: 49.82, lng: -123.12 }),
    makeStock("worst", [{ itemNo: "001", quantity: 0 }], { lat: 49.82, lng: -123.12 }),
  ],
  cart: [{ itemNo: "001", quantity: 2 }],
  ctx: { userLocation: USER_VANCOUVER },
  expectedOrder: ["best", "mid", "worst"],
};

/**
 * Scenario 5 [log:ci-sample-002]: UNKNOWN stock (Structube-style) ranked by distance.
 *
 * Pattern: find_best_store for a retailer that does not expose per-store inventory
 * (stockLevel="UNKNOWN"). Both stores score 0.5 stockCoverage → distance decides.
 * Exercises the allUnknown→0.5 branch in scoreStore.
 */
const UNKNOWN_STOCK_BY_DISTANCE: GoldenScenario = {
  name: "unknown-stock-ranked-by-distance",
  source: "log:ci-sample-002",
  stores: [
    makeStock("near-unknown", [{ itemNo: "SB-100", quantity: null, stockLevel: "UNKNOWN" }], { lat: 49.28, lng: -123.12 }),
    makeStock("far-unknown", [{ itemNo: "SB-100", quantity: null, stockLevel: "UNKNOWN" }], { lat: 49.82, lng: -123.12 }),
  ],
  cart: [{ itemNo: "SB-100", quantity: 1 }],
  ctx: { userLocation: USER_VANCOUVER },
  expectedOrder: ["near-unknown", "far-unknown"],
};

/**
 * Scenario 6 [log:ci-sample-003]: No user location — stock-only ranking.
 *
 * Pattern: find_best_store or check_cart where user omitted location.
 * No distanceScore → stockCoverage is the only signal.
 * Full-stock store beats zero-stock store regardless of position.
 */
const NO_LOCATION_STOCK_ONLY: GoldenScenario = {
  name: "no-location-stock-only",
  source: "log:ci-sample-003",
  stores: [
    makeStock("full-noloc", [{ itemNo: "DT-200", quantity: 8 }]),
    makeStock("empty-noloc", [{ itemNo: "DT-200", quantity: 0 }]),
  ],
  cart: [{ itemNo: "DT-200", quantity: 2 }],
  ctx: undefined, // no userLocation — no coords needed either
  expectedOrder: ["full-noloc", "empty-noloc"],
};

/**
 * Scenario 7 [log:ci-sample-001]: Multi-item cart (check_cart pattern).
 *
 * Pattern: user has a 3-item cart (sofa bed under $800 + side table + lamp).
 * Store A covers all 3 but is far; Store B covers 2/3 and is near.
 * stockCoverage (0.5) >> distance (0.1): full-cart store wins.
 */
const MULTI_ITEM_CART_FULL_BEATS_PARTIAL: GoldenScenario = {
  name: "multi-item-cart-full-beats-partial",
  source: "log:ci-sample-001",
  stores: [
    makeStock(
      "full-cart",
      [
        { itemNo: "LYCK-001", quantity: 3 },
        { itemNo: "LACK-002", quantity: 5 },
        { itemNo: "LAMP-003", quantity: 2 },
      ],
      { lat: 49.82, lng: -123.12 }, // far (~60 km)
    ),
    makeStock(
      "partial-cart",
      [
        { itemNo: "LYCK-001", quantity: 3 },
        { itemNo: "LACK-002", quantity: 5 },
        { itemNo: "LAMP-003", quantity: 0 }, // missing lamp
      ],
      { lat: 49.28, lng: -123.12 }, // near (~5 km)
    ),
  ],
  cart: [
    { itemNo: "LYCK-001", quantity: 1 },
    { itemNo: "LACK-002", quantity: 1 },
    { itemNo: "LAMP-003", quantity: 1 },
  ],
  ctx: { userLocation: USER_VANCOUVER },
  expectedOrder: ["full-cart", "partial-cart"],
};

/**
 * Scenario 8 [hand]: Cheap-far beats expensive-near — price weight (0.15) overrides
 * distance weight (0.1) when stock is equal on both sides.
 *
 * Stock is identical (same item, same qty ≥ requested) so stockCoverageScore and
 * convenienceScore are 1.0 for both stores. The only signals that differ are
 * distanceScore and priceScore.
 *
 * Math (DEFAULT_WEIGHTS, USER_VANCOUVER lat=49.24):
 *   cheap-far  (lat=49.82, price= 99): dist≈64.5 km → distScore≈0.437, priceScore=1.0
 *              total = 1.0×0.5 + 1.0×0.25 + 0.437×0.1 + 1.0×0.15 ≈ 0.944
 *   exp-near   (lat=49.28, price=499): dist≈4.4 km  → distScore≈0.918, priceScore=0.0
 *              total = 1.0×0.5 + 1.0×0.25 + 0.918×0.1 + 0.0×0.15 ≈ 0.842
 *   margin = 0.102 → deterministic under current weights.
 *
 * Exercises: the price-wins-over-distance tradeoff; distinct from CHEAPER_WINS
 * (equal distance) and CLOSER_WINS (no price signal).
 */
const CHEAP_FAR_BEATS_EXPENSIVE_NEAR: GoldenScenario = {
  name: "cheap-far-beats-expensive-near",
  source: "hand",
  stores: [
    makeStock("cheap-far",    [{ itemNo: "001", quantity: 5 }], { lat: 49.82, lng: -123.12 }),
    makeStock("expensive-near", [{ itemNo: "001", quantity: 5 }], { lat: 49.28, lng: -123.12 }),
  ],
  cart: [{ itemNo: "001", quantity: 1 }],
  ctx: {
    userLocation: USER_VANCOUVER,
    getItemPrice: (storeId: string, _itemNo: string) => storeId === "cheap-far" ? 99 : 499,
  },
  expectedOrder: ["cheap-far", "expensive-near"],
};

/**
 * Scenario 9 [hand]: Quantity threshold — insufficient quantity ranks below sufficient.
 *
 * User needs 3 units. Store A has only 2 (insufficient), Store B has 5 (sufficient).
 * Covers the quantity < requested → insufficient branch.
 */
const QUANTITY_THRESHOLD: GoldenScenario = {
  name: "quantity-threshold",
  source: "hand",
  stores: [
    makeStock("has-enough", [{ itemNo: "SHELF-001", quantity: 5 }]),
    makeStock("too-few", [{ itemNo: "SHELF-001", quantity: 2 }]),
  ],
  cart: [{ itemNo: "SHELF-001", quantity: 3 }],
  ctx: undefined,
  expectedOrder: ["has-enough", "too-few"],
};

/**
 * Scenario 9 [log:fixture-001]: 3-store coverage gradient — 3/3 > 2/3 > 1/3 items.
 *
 * Source: ci/fix-001.json (extracted via scripts/extract-ranking-scenarios.ts)
 * Pattern: find_best_store for a 3-item cart; stores stock different subsets.
 * burnaby covers all 3 items, richmond misses LACK (70210433), langley misses LACK+BILLY.
 * No user location → stockCoverage is the sole signal; gradient is strict (1.0 > 0.67 > 0.33).
 * New shape: 3-store, 3-item, continuous stockCoverage gradient without distance.
 */
const COVERAGE_GRADIENT_THREE_STORES: GoldenScenario = {
  name: "coverage-gradient-three-stores",
  source: "log:fixture-001",
  stores: [
    {
      store: { retailer: "ikea", storeId: "burnaby", label: "IKEA Burnaby" },
      items: [
        { itemNo: "20275885", available: true,  quantity: 3, stockLevel: "HIGH_IN_STOCK", canNotify: null },
        { itemNo: "70210433", available: true,  quantity: 2, stockLevel: "LOW_IN_STOCK",  canNotify: null },
        { itemNo: "90301843", available: true,  quantity: 4, stockLevel: "HIGH_IN_STOCK", canNotify: null },
      ],
    },
    {
      store: { retailer: "ikea", storeId: "richmond", label: "IKEA Richmond" },
      items: [
        { itemNo: "20275885", available: true,  quantity: 2, stockLevel: "LOW_IN_STOCK",  canNotify: null },
        { itemNo: "70210433", available: false, quantity: 0, stockLevel: "OUT_OF_STOCK",  canNotify: true  },
        { itemNo: "90301843", available: true,  quantity: 3, stockLevel: "HIGH_IN_STOCK", canNotify: null },
      ],
    },
    {
      store: { retailer: "ikea", storeId: "langley", label: "IKEA Langley" },
      items: [
        { itemNo: "20275885", available: true,  quantity: 1, stockLevel: "LOW_IN_STOCK",  canNotify: null },
        { itemNo: "70210433", available: false, quantity: 0, stockLevel: "OUT_OF_STOCK",  canNotify: true  },
        { itemNo: "90301843", available: false, quantity: 0, stockLevel: "OUT_OF_STOCK",  canNotify: true  },
      ],
    },
  ],
  cart: [
    { itemNo: "20275885", quantity: 1 },
    { itemNo: "70210433", quantity: 1 },
    { itemNo: "90301843", quantity: 1 },
  ],
  ctx: undefined,
  expectedOrder: ["burnaby", "richmond", "langley"],
};

/**
 * Scenario 10 [log:fixture-002]: Quantity threshold + 2-item cart + 3-store gradient.
 *
 * Source: ci/fix-002.json (extracted via scripts/extract-ranking-scenarios.ts)
 * Pattern: user needs 3 of each item; stores vary in whether they meet the quantity threshold.
 * depot: both items sufficient (5≥3, 4≥3) → coverage 2/2=1.0
 * branch: first sufficient (5≥3), second not (2<3) → coverage 1/2=0.5
 * outlet: neither sufficient (2<3, 1<3) → coverage 0/2=0.0
 * New shape: quantity requirement combined with 2-item multi-cart 3-store gradient.
 * Distinct from QUANTITY_THRESHOLD (1 item, 2 stores) and MULTI_ITEM_CART (3 items, no qty req).
 */
const QUANTITY_THRESHOLD_MULTI_ITEM_GRADIENT: GoldenScenario = {
  name: "quantity-threshold-multi-item-gradient",
  source: "log:fixture-002",
  stores: [
    {
      store: { retailer: "ikea", storeId: "depot",  label: "IKEA Coquitlam"      },
      items: [
        { itemNo: "90408138", available: true, quantity: 5, stockLevel: "HIGH_IN_STOCK", canNotify: null },
        { itemNo: "50308847", available: true, quantity: 4, stockLevel: "HIGH_IN_STOCK", canNotify: null },
      ],
    },
    {
      store: { retailer: "ikea", storeId: "branch", label: "IKEA North Vancouver" },
      items: [
        { itemNo: "90408138", available: true, quantity: 5, stockLevel: "HIGH_IN_STOCK", canNotify: null },
        { itemNo: "50308847", available: true, quantity: 2, stockLevel: "LOW_IN_STOCK",  canNotify: null },
      ],
    },
    {
      store: { retailer: "ikea", storeId: "outlet", label: "IKEA Abbotsford"      },
      items: [
        { itemNo: "90408138", available: true, quantity: 2, stockLevel: "LOW_IN_STOCK",  canNotify: null },
        { itemNo: "50308847", available: true, quantity: 1, stockLevel: "LOW_IN_STOCK",  canNotify: null },
      ],
    },
  ],
  cart: [
    { itemNo: "90408138", quantity: 3 },
    { itemNo: "50308847", quantity: 3 },
  ],
  ctx: undefined,
  expectedOrder: ["depot", "branch", "outlet"],
};

/**
 * Scenario 11 [log:fixture-003]: Real stock beats UNKNOWN stock.
 *
 * Source: ci/fix-003.json (extracted via scripts/extract-ranking-scenarios.ts)
 * Pattern: cross-retailer check — one store (IKEA) has confirmed stock, another (Structube)
 * returns UNKNOWN (no per-store inventory exposed by their API).
 * real-stock: stockCoverage=1.0 (item available, quantity=8)
 * unknown-stock: allUnknown=true → stockCoverage=0.5 (neutral heuristic)
 * New shape: mixed-retailer single-item, real-stock vs UNKNOWN-stock.
 * Distinct from UNKNOWN_STOCK_BY_DISTANCE (both stores UNKNOWN, distance decides).
 */
const REAL_STOCK_BEATS_UNKNOWN: GoldenScenario = {
  name: "real-stock-beats-unknown",
  source: "log:fixture-003",
  stores: [
    {
      store: { retailer: "ikea",     storeId: "real-stock",    label: "IKEA Richmond"    },
      items: [
        { itemNo: "20275885", available: true, quantity: 8, stockLevel: "HIGH_IN_STOCK", canNotify: null },
      ],
    },
    {
      store: { retailer: "structube", storeId: "unknown-stock", label: "Structube Robson" },
      items: [
        { itemNo: "20275885", available: null, quantity: null, stockLevel: "UNKNOWN", canNotify: null },
      ],
    },
  ],
  cart: [{ itemNo: "20275885", quantity: 1 }],
  ctx: undefined,
  expectedOrder: ["real-stock", "unknown-stock"],
};

/**
 * Scenario 13 [live:live-001]: Distance-only ranking from NYC.
 * All 5 US stores fully stocked with BILLY (20522046) — ranking is purely by
 * haversine distance from Midtown Manhattan. Extracted from a live capture
 * that persists userLocation (ci/live-001.json).
 * Expected: NJ (closest) > MA > MD > FL×2 (farthest).
 */
const NYC_DISTANCE_ORDER: GoldenScenario = {
  name: "nyc-distance-order",
  source: "live:live-001",
  stores: [
    makeStock("154", [{ itemNo: "20522046", quantity: 141 }], { lat: 40.678,  lng: -74.1709 }), // Elizabeth, NJ
    makeStock("158", [{ itemNo: "20522046", quantity: 237 }], { lat: 42.1145, lng: -71.0904 }), // Stoughton, MA
    makeStock("411", [{ itemNo: "20522046", quantity: 168 }], { lat: 38.9953, lng: -76.9137 }), // College Park, MD
    makeStock("145", [{ itemNo: "20522046", quantity: 189 }], { lat: 28.3884, lng: -81.4239 }), // Orlando, FL
    makeStock("042", [{ itemNo: "20522046", quantity: 159 }], { lat: 27.9614, lng: -82.4931 }), // Tampa, FL
  ],
  cart: [{ itemNo: "20522046", quantity: 1 }],
  ctx: { userLocation: USER_NYC },
  expectedOrder: ["154", "158", "411", "145", "042"],
};

/**
 * Scenario 14 [live:live-002]: Stock coverage beats proximity (NYC).
 * 2-item cart: MORABO sofa (89318321) + KALLAX (20275885).
 * 921 (Brooklyn) is the CLOSEST store but has MORABO qty=0 → coverage=0.5.
 * 154 (Elizabeth NJ) and 409 (Paramus NJ) both have full coverage=1.0 and
 * rank above 921 despite being farther. Within the 1.0 group, distance decides.
 * Extracted from ci/live-002.json. Scoring engine verified.
 */
const NYC_STOCK_BEATS_PROXIMITY: GoldenScenario = {
  name: "nyc-stock-beats-proximity",
  source: "live:live-002",
  stores: [
    makeStock("409", [{ itemNo: "89318321", quantity: 4 }, { itemNo: "20275885", quantity: 21 }], { lat: 40.9291, lng: -74.0760 }), // Paramus, NJ
    makeStock("154", [{ itemNo: "89318321", quantity: 3 }, { itemNo: "20275885", quantity: 15 }], { lat: 40.6780, lng: -74.1709 }), // Elizabeth, NJ
    makeStock("921", [{ itemNo: "89318321", quantity: 0 }, { itemNo: "20275885", quantity: 18 }], { lat: 40.6729, lng: -73.9961 }), // Brooklyn, NY — MORABO out of stock
  ],
  cart: [{ itemNo: "89318321", quantity: 1 }, { itemNo: "20275885", quantity: 1 }],
  ctx: { userLocation: USER_NYC },
  expectedOrder: ["154", "409", "921"],
};

// ── Export ──

export const ALL_GOLDEN_SCENARIOS: GoldenScenario[] = [
  CLOSER_WINS,
  FULL_STOCK_FAR_BEATS_PARTIAL_NEAR,
  CHEAPER_WINS,
  THREE_WAY,
  UNKNOWN_STOCK_BY_DISTANCE,
  NO_LOCATION_STOCK_ONLY,
  MULTI_ITEM_CART_FULL_BEATS_PARTIAL,
  CHEAP_FAR_BEATS_EXPENSIVE_NEAR,
  QUANTITY_THRESHOLD,
  COVERAGE_GRADIENT_THREE_STORES,
  QUANTITY_THRESHOLD_MULTI_ITEM_GRADIENT,
  REAL_STOCK_BEATS_UNKNOWN,
  NYC_DISTANCE_ORDER,
  NYC_STOCK_BEATS_PROXIMITY,
];

// ── Log extraction ──
//
// Convert CaptureRecord objects (with rankingSnapshot populated) into
// GoldenScenario instances. The expectedOrder is the rankedIds from the
// live run — i.e. we treat the actual ranking as ground truth.
//
// Usage:
//   const scenarios = extractScenariosFromCaptures(capturedRecords);
//   // review/filter manually, then add to ALL_GOLDEN_SCENARIOS

/**
 * Convert one CaptureRecord into a GoldenScenario.
 * Returns null when rankingSnapshot is absent.
 *
 * The caller is responsible for reviewing expectedOrder before promoting
 * a log-derived scenario to ALL_GOLDEN_SCENARIOS — the live ranking is used
 * as ground truth, which is correct only if the run was correct.
 */
export function scenarioFromCapture(record: CaptureRecord, name?: string): GoldenScenario | null {
  const snap = record.rankingSnapshot;
  if (!snap || snap.stores.length === 0 || snap.rankedIds.length === 0) return null;
  return {
    name: name ?? `log:${record.id ?? record.timestamp}`,
    source: `log:${record.id ?? "captured"}`,
    stores: snap.stores,
    cart: snap.cart,
    ctx: snap.userLocation ? { userLocation: snap.userLocation } : undefined,
    expectedOrder: snap.rankedIds,
  };
}

/**
 * Convert a batch of CaptureRecords into GoldenScenarios, filtering out
 * records without a rankingSnapshot.
 */
export function extractScenariosFromCaptures(records: CaptureRecord[]): GoldenScenario[] {
  return records.flatMap((r) => {
    const s = scenarioFromCapture(r);
    return s ? [s] : [];
  });
}
