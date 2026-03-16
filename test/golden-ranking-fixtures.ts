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
 *
 * NOTE: Real capture logs (CaptureRecord) do not include StoreStock[] arrays —
 * store inventory is a live API response and is not persisted. Scenarios labelled
 * [log:*] are hand-authored to reflect the query/intent pattern from that log entry,
 * not extracted verbatim. When log capture is extended to include store stock data,
 * replace hand-authored fixtures with extracted ones.
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
 * Scenario 8 [hand]: Quantity threshold — insufficient quantity ranks below sufficient.
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

// ── Export ──

export const ALL_GOLDEN_SCENARIOS: GoldenScenario[] = [
  CLOSER_WINS,
  FULL_STOCK_FAR_BEATS_PARTIAL_NEAR,
  CHEAPER_WINS,
  THREE_WAY,
  UNKNOWN_STOCK_BY_DISTANCE,
  NO_LOCATION_STOCK_ONLY,
  MULTI_ITEM_CART_FULL_BEATS_PARTIAL,
  QUANTITY_THRESHOLD,
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
    ctx: undefined, // user location is not persisted in CaptureRecord
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
