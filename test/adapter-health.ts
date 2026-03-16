/**
 * Adapter health check helpers — deterministic contract-drift detection.
 *
 * Validates that adapter outputs conform to the shapes expected by downstream
 * pipeline stages (Product Finder scoring, auto-rank, explanation, store ranking).
 * No LLM calls, no network calls — pure structural validation against runtime values.
 *
 * Use cases:
 *   - Run against mock adapter outputs to catch silent shape regressions.
 *   - Extend to real adapter outputs in integration/smoke tests.
 *   - Add checks as new downstream contracts are discovered.
 */

import type { ProductInfo, StoreRef, StoreStock } from "../src/core/types.js";
import type { ProductCandidate } from "../src/domain/product-finder.js";

// ── Health model ──

export type HealthStatus = "ok" | "warn" | "fail";

export interface HealthCheckResult {
  /** Retailer adapter being checked. */
  adapter: string;
  /** Short name identifying the specific contract being validated. */
  check: string;
  status: HealthStatus;
  message: string;
  /** Optional structured detail for debugging. */
  metadata?: Record<string, unknown>;
}

export interface HealthSummary {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  /** Distinct adapter names that produced at least one fail. */
  failedAdapters: string[];
  /** Check names that produced at least one fail or warn. */
  degradedChecks: string[];
}

// ── Product search result checks ──

/**
 * Validate a `searchProducts` response.
 * Checks shape, field presence, price sanity, and duplicate explosion.
 *
 * Downstream breakage paths guarded:
 *   - missing itemNo → ProductFinder dedup and auto-rank SKU lookup break
 *   - missing name → explanation summary and search query building break
 *   - retailer mismatch → fan-out candidate attribution is wrong
 *   - malformed price → budget scoring produces incorrect match scores
 *   - duplicate explosion → inventory lookups are redundant / quota-wasteful
 */
export function checkProductSearchResults(
  adapter: string,
  products: ProductInfo[],
): HealthCheckResult[] {
  const results: HealthCheckResult[] = [];
  const tag = (check: string) => `search:${check}`;

  // 1. Array shape
  if (!Array.isArray(products)) {
    results.push(fail(adapter, tag("array-shape"), "searchProducts did not return an array", {
      type: typeof products,
    }));
    return results; // can't proceed
  }
  results.push(ok(adapter, tag("array-shape"), `returned array with ${products.length} item(s)`));

  // 2. Non-empty (warn only — empty is sometimes valid, e.g. no results)
  if (products.length === 0) {
    results.push(warn(adapter, tag("non-empty"), "searchProducts returned empty array — may be expected or a silent failure"));
    return results;
  }

  // 3. itemNo present on every item
  const missingItemNo = products.filter((p) => !p.itemNo || typeof p.itemNo !== "string" || p.itemNo.trim() === "");
  if (missingItemNo.length > 0) {
    results.push(warn(adapter, tag("itemNo-present"),
      `${missingItemNo.length}/${products.length} item(s) have missing or empty itemNo — dedup and inventory lookup will break`,
      { missingIndexes: missingItemNo.map((_, i) => i).slice(0, 5) },
    ));
  } else {
    results.push(ok(adapter, tag("itemNo-present"), `all ${products.length} item(s) have non-empty itemNo`));
  }

  // 4. Name present on every item
  const missingName = products.filter((p) => !p.name || typeof p.name !== "string" || p.name.trim() === "");
  if (missingName.length > 0) {
    results.push(fail(adapter, tag("name-present"),
      `${missingName.length}/${products.length} item(s) have missing or empty name — explanation and search query building break`,
    ));
  } else {
    results.push(ok(adapter, tag("name-present"), `all ${products.length} item(s) have non-empty name`));
  }

  // 5. retailer field matches expected adapter
  const retailerMismatch = products.filter((p) => p.retailer !== adapter);
  if (retailerMismatch.length > 0) {
    results.push(warn(adapter, tag("retailer-field"),
      `${retailerMismatch.length}/${products.length} item(s) have retailer "${retailerMismatch[0].retailer}" instead of "${adapter}" — candidate attribution will be wrong`,
      { expectedRetailer: adapter, foundRetailers: [...new Set(retailerMismatch.map((p) => p.retailer))] },
    ));
  } else {
    results.push(ok(adapter, tag("retailer-field"), `all item(s) have retailer="${adapter}"`));
  }

  // 6. Price shape — when non-null, must be { amount: number >= 0, currency: string }
  const malformedPrice = products.filter((p) => {
    if (p.price === null) return false; // null is allowed
    const pr = p.price as unknown as Record<string, unknown>;
    return (
      typeof pr.amount !== "number" ||
      (pr.amount as number) < 0 ||
      typeof pr.currency !== "string" ||
      (pr.currency as string).trim() === ""
    );
  });
  if (malformedPrice.length > 0) {
    results.push(warn(adapter, tag("price-shape"),
      `${malformedPrice.length}/${products.length} item(s) have malformed price — budget scoring will produce wrong scores`,
      { examples: malformedPrice.slice(0, 2).map((p) => ({ itemNo: p.itemNo, price: p.price })) },
    ));
  } else {
    results.push(ok(adapter, tag("price-shape"), "all non-null prices have valid shape"));
  }

  // 7. Duplicate explosion — if >50% of itemNos are duplicates, likely a pagination or mapping bug
  const itemNos = products.map((p) => p.itemNo).filter(Boolean);
  const uniqueItemNos = new Set(itemNos);
  const dupeRatio = itemNos.length > 0 ? 1 - uniqueItemNos.size / itemNos.length : 0;
  if (dupeRatio > 0.5) {
    results.push(warn(adapter, tag("no-duplicate-explosion"),
      `${Math.round(dupeRatio * 100)}% of returned itemNos are duplicates — possible pagination or mapping regression`,
      { total: itemNos.length, unique: uniqueItemNos.size },
    ));
  } else if (dupeRatio > 0) {
    results.push(warn(adapter, tag("no-duplicate-explosion"),
      `${Math.round(dupeRatio * 100)}% of returned itemNos are duplicates — minor duplication detected`,
      { total: itemNos.length, unique: uniqueItemNos.size },
    ));
  } else {
    results.push(ok(adapter, tag("no-duplicate-explosion"), `all itemNos are unique (${uniqueItemNos.size} distinct)`));
  }

  return results;
}

// ── Store stock result checks ──

/**
 * Validate a `findStoresForCart` response.
 * Checks structure, required fields, and downstream-usable values.
 *
 * Downstream breakage paths guarded:
 *   - missing storeId/label → recommendation cannot identify or display stores
 *   - items not an array → rankStores throws or produces zero coverage
 *   - missing itemNo in items → per-item stock matching breaks
 *   - available not boolean → rankStores coverage score is NaN
 *   - negative quantity → store ranking compares invalid quantities
 */
export function checkStoreStockResults(
  adapter: string,
  stocks: StoreStock[],
  cartItemNos: string[],
): HealthCheckResult[] {
  const results: HealthCheckResult[] = [];
  const tag = (check: string) => `stock:${check}`;

  // 1. Array shape
  if (!Array.isArray(stocks)) {
    results.push(fail(adapter, tag("array-shape"), "findStoresForCart did not return an array", {
      type: typeof stocks,
    }));
    return results;
  }
  results.push(ok(adapter, tag("array-shape"), `returned array with ${stocks.length} store(s)`));

  // 2. Empty is valid (no stores in range or no stock data)
  if (stocks.length === 0) {
    results.push(ok(adapter, tag("non-empty"), "returned empty array — valid when no stores match"));
    return results;
  }

  // 3. storeId present
  const missingStoreId = stocks.filter((s) => !s.store?.storeId || s.store.storeId.trim() === "");
  if (missingStoreId.length > 0) {
    results.push(fail(adapter, tag("store-id-present"),
      `${missingStoreId.length}/${stocks.length} store(s) missing storeId — recommendation cannot identify stores`));
  } else {
    results.push(ok(adapter, tag("store-id-present"), `all ${stocks.length} store(s) have storeId`));
  }

  // 4. store label present
  const missingLabel = stocks.filter((s) => !s.store?.label || s.store.label.trim() === "");
  if (missingLabel.length > 0) {
    results.push(warn(adapter, tag("store-label-present"),
      `${missingLabel.length}/${stocks.length} store(s) have missing label — UI display will be broken`));
  } else {
    results.push(ok(adapter, tag("store-label-present"), `all ${stocks.length} store(s) have a label`));
  }

  // 5. items is an array on every StoreStock
  const notArrayItems = stocks.filter((s) => !Array.isArray(s.items));
  if (notArrayItems.length > 0) {
    results.push(fail(adapter, tag("items-array-shape"),
      `${notArrayItems.length}/${stocks.length} StoreStock(s) have non-array items — rankStores will throw`));
    return results; // can't check item-level fields
  }
  results.push(ok(adapter, tag("items-array-shape"), "all StoreStock items fields are arrays"));

  // 6. itemNo present in every item
  const allItems = stocks.flatMap((s) => s.items);
  const missingItemNo = allItems.filter((i) => !i.itemNo || i.itemNo.trim() === "");
  if (missingItemNo.length > 0) {
    results.push(fail(adapter, tag("itemNo-present"),
      `${missingItemNo.length}/${allItems.length} stock item(s) have missing itemNo — per-item matching breaks`));
  } else {
    results.push(ok(adapter, tag("itemNo-present"), `all ${allItems.length} stock item(s) have itemNo`));
  }

  // 7. available is boolean
  const nonBoolAvailable = allItems.filter((i) => typeof i.available !== "boolean");
  if (nonBoolAvailable.length > 0) {
    results.push(fail(adapter, tag("available-is-boolean"),
      `${nonBoolAvailable.length}/${allItems.length} stock item(s) have non-boolean available — rankStores coverage score will be wrong`,
      { examples: nonBoolAvailable.slice(0, 2).map((i) => ({ itemNo: i.itemNo, available: i.available })) },
    ));
  } else {
    results.push(ok(adapter, tag("available-is-boolean"), "all available fields are boolean"));
  }

  // 8. Quantity sane (null or non-negative number)
  const badQuantity = allItems.filter((i) => i.quantity !== null && (typeof i.quantity !== "number" || i.quantity < 0));
  if (badQuantity.length > 0) {
    results.push(warn(adapter, tag("quantity-sane"),
      `${badQuantity.length}/${allItems.length} stock item(s) have negative or invalid quantity`,
      { examples: badQuantity.slice(0, 2).map((i) => ({ itemNo: i.itemNo, quantity: i.quantity })) },
    ));
  } else {
    results.push(ok(adapter, tag("quantity-sane"), "all quantities are null or non-negative"));
  }

  // 9. Cart coverage — every requested itemNo appears in at least one store
  if (cartItemNos.length > 0) {
    const coveredItemNos = new Set(allItems.map((i) => i.itemNo));
    const uncovered = cartItemNos.filter((no) => !coveredItemNos.has(no));
    if (uncovered.length > 0) {
      results.push(warn(adapter, tag("cart-coverage"),
        `${uncovered.length}/${cartItemNos.length} cart item(s) not present in any store's stock response`,
        { uncovered },
      ));
    } else {
      results.push(ok(adapter, tag("cart-coverage"), `all ${cartItemNos.length} cart item(s) covered by store responses`));
    }
  }

  return results;
}

// ── Store list result checks ──

/**
 * Validate a `listStores` response.
 * Checks required fields and coordinate sanity.
 *
 * Downstream breakage paths guarded:
 *   - missing storeId → radius filter and stock lookup cannot target stores
 *   - missing label → UI cannot display store names
 *   - invalid coords → haversineKm returns NaN, distance scoring breaks
 */
export function checkStoreListResults(
  adapter: string,
  stores: StoreRef[],
): HealthCheckResult[] {
  const results: HealthCheckResult[] = [];
  const tag = (check: string) => `stores:${check}`;

  // 1. Array shape
  if (!Array.isArray(stores)) {
    results.push(fail(adapter, tag("array-shape"), "listStores did not return an array", {
      type: typeof stores,
    }));
    return results;
  }
  results.push(ok(adapter, tag("array-shape"), `returned array with ${stores.length} store(s)`));

  if (stores.length === 0) {
    results.push(ok(adapter, tag("non-empty"), "empty store list — valid for country-scoped queries"));
    return results;
  }

  // 2. storeId present
  const missingId = stores.filter((s) => !s.storeId || s.storeId.trim() === "");
  if (missingId.length > 0) {
    results.push(fail(adapter, tag("storeId-present"),
      `${missingId.length}/${stores.length} store(s) missing storeId — radius filter and stock lookup break`));
  } else {
    results.push(ok(adapter, tag("storeId-present"), `all ${stores.length} store(s) have storeId`));
  }

  // 3. label present
  const missingLabel = stores.filter((s) => !s.label || s.label.trim() === "");
  if (missingLabel.length > 0) {
    results.push(warn(adapter, tag("label-present"),
      `${missingLabel.length}/${stores.length} store(s) have empty label — UI display will be broken`));
  } else {
    results.push(ok(adapter, tag("label-present"), `all ${stores.length} store(s) have label`));
  }

  // 4. retailer field set
  const missingRetailer = stores.filter((s) => !s.retailer || s.retailer.trim() === "");
  if (missingRetailer.length > 0) {
    results.push(warn(adapter, tag("retailer-field"),
      `${missingRetailer.length}/${stores.length} store(s) missing retailer field`));
  } else {
    results.push(ok(adapter, tag("retailer-field"), "all stores have retailer field"));
  }

  // 5. Coordinate sanity (when present)
  const storesWithCoords = stores.filter((s) => s.coords !== undefined);
  const badCoords = storesWithCoords.filter((s) => {
    const { lat, lng } = s.coords!;
    return (
      typeof lat !== "number" || typeof lng !== "number" ||
      Number.isNaN(lat) || Number.isNaN(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    );
  });
  if (badCoords.length > 0) {
    results.push(warn(adapter, tag("coords-shape"),
      `${badCoords.length}/${storesWithCoords.length} store(s) with coords have invalid lat/lng — haversineKm returns NaN`,
      { examples: badCoords.slice(0, 2).map((s) => ({ storeId: s.storeId, coords: s.coords })) },
    ));
  } else if (storesWithCoords.length > 0) {
    results.push(ok(adapter, tag("coords-shape"), `all ${storesWithCoords.length} coord-bearing stores have valid lat/lng`));
  }

  return results;
}

// ── Candidate normalization checks ──

/**
 * Validate ProductCandidate outputs from the Product Finder.
 * Checks that normalization preserved required fields and that scoring is in range.
 *
 * Downstream breakage paths guarded:
 *   - matchScore out of [0,1] → auto-rank comparison produces wrong ordering
 *   - itemNo lost → inventory lookup cart build fails
 *   - price not extracted → budget scoring skips always (silent degradation)
 */
export function checkCandidateNormalization(
  adapter: string,
  candidates: ProductCandidate[],
): HealthCheckResult[] {
  const results: HealthCheckResult[] = [];
  const tag = (check: string) => `candidates:${check}`;

  if (!Array.isArray(candidates)) {
    results.push(fail(adapter, tag("array-shape"), "findProducts did not return an array"));
    return results;
  }
  results.push(ok(adapter, tag("array-shape"), `${candidates.length} candidate(s) returned`));

  if (candidates.length === 0) return results;

  // 1. matchScore in [0, 1]
  const badScore = candidates.filter((c) =>
    typeof c.matchScore !== "number" || c.matchScore < 0 || c.matchScore > 1 || Number.isNaN(c.matchScore),
  );
  if (badScore.length > 0) {
    results.push(fail(adapter, tag("matchScore-range"),
      `${badScore.length}/${candidates.length} candidate(s) have matchScore outside [0,1]`,
      { examples: badScore.slice(0, 3).map((c) => ({ itemNo: c.itemNo, score: c.matchScore })) },
    ));
  } else {
    results.push(ok(adapter, tag("matchScore-range"), "all matchScores are within [0,1]"));
  }

  // 2. itemNo preserved
  const missingItemNo = candidates.filter((c) => !c.itemNo && !c.productId);
  if (missingItemNo.length > 0) {
    results.push(warn(adapter, tag("itemNo-preserved"),
      `${missingItemNo.length}/${candidates.length} candidate(s) have neither itemNo nor productId — inventory cart build will skip them`));
  } else {
    results.push(ok(adapter, tag("itemNo-preserved"), "all candidates have itemNo or productId"));
  }

  // 3. Price preserved (when original product had a price)
  const hasNullPrice = candidates.filter((c) => c.price === null);
  if (hasNullPrice.length === candidates.length) {
    results.push(warn(adapter, tag("price-preserved"),
      "all candidates have null price — budget scoring will never apply (check adapter mapProduct)"));
  } else {
    const withPrice = candidates.filter((c) => c.price !== null);
    results.push(ok(adapter, tag("price-preserved"), `${withPrice.length}/${candidates.length} candidate(s) have a price`));
  }

  return results;
}

// ── Health summary ──

/**
 * Aggregate a slice of health check results into a concise summary.
 * Use `summary.fail > 0` as a regression gate.
 */
export function buildHealthSummary(results: HealthCheckResult[]): HealthSummary {
  const failResults = results.filter((r) => r.status === "fail");
  const warnResults = results.filter((r) => r.status === "warn");
  return {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    warn: warnResults.length,
    fail: failResults.length,
    failedAdapters: [...new Set(failResults.map((r) => r.adapter))],
    degradedChecks: [...new Set([...failResults, ...warnResults].map((r) => r.check))],
  };
}

/**
 * Emit a single structured log line per health check result.
 * Output: [adapter-health] {"adapter":"...","check":"...","status":"...","message":"..."}
 */
export function logHealthResults(results: HealthCheckResult[]): void {
  for (const r of results) {
    console.error("[adapter-health]", JSON.stringify({
      adapter: r.adapter,
      check: r.check,
      status: r.status,
      message: r.message,
      ...(r.metadata ? { metadata: r.metadata } : {}),
    }));
  }
}

// ── Internal builders ──

function ok(adapter: string, check: string, message: string, metadata?: Record<string, unknown>): HealthCheckResult {
  return { adapter, check, status: "ok", message, ...(metadata ? { metadata } : {}) };
}

function warn(adapter: string, check: string, message: string, metadata?: Record<string, unknown>): HealthCheckResult {
  return { adapter, check, status: "warn", message, ...(metadata ? { metadata } : {}) };
}

function fail(adapter: string, check: string, message: string, metadata?: Record<string, unknown>): HealthCheckResult {
  return { adapter, check, status: "fail", message, ...(metadata ? { metadata } : {}) };
}
