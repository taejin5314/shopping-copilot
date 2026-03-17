import type {
  StoreStock,
  ScoredStore,
  ItemScoreDetail,
  RecommendationResult,
} from "../core/types.js";
import type { GeoCoord } from "./geo.js";
import { haversineKm, distanceToScore } from "./geo.js";

// ──────────────────────────────────────────────
// Deterministic scoring engine — pure functions
// ──────────────────────────────────────────────

export interface ScoringWeights {
  stockCoverage: number;
  convenience: number;
  distance: number;
  price: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  stockCoverage: 0.5,
  convenience: 0.25,
  distance: 0.1,
  price: 0.15,
};

export interface CartItem {
  itemNo: string;
  quantity: number;
}

export interface ScoringContext {
  /** User's location for distance scoring. */
  userLocation?: GeoCoord;
  /** Resolve unit price for an item at a specific store. Return null if unknown. */
  getItemPrice?: (storeId: string, itemNo: string) => number | null;
}

/**
 * Score a single store against a cart.
 * All inputs are plain data — no I/O, no LLM.
 */
export function scoreStore(
  storeStock: StoreStock,
  cart: CartItem[],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  ctx?: ScoringContext,
): ScoredStore {
  const itemDetails: ItemScoreDetail[] = cart.map((cartItem) => {
    const match = storeStock.items.find((a) => a.itemNo === cartItem.itemNo);
    const qty = match?.quantity ?? null;
    // When quantity is unknown (e.g. Structube doesn't expose counts), fall back
    // to the boolean `available` flag set by the adapter from status fields.
    const sufficient = qty !== null
      ? qty >= cartItem.quantity
      : (match?.available ?? false);
    return {
      itemNo: cartItem.itemNo,
      requested: cartItem.quantity,
      available: qty,
      sufficient,
    };
  });

  const fulfilledCount = itemDetails.filter((d) => d.sufficient).length;
  // "UNKNOWN" means the retailer API does not expose per-store inventory (e.g. Structube).
  // This is distinct from out-of-stock (quantity === 0) or missing data (item not returned).
  // Treat it as a neutral 0.5 so these retailers aren't penalised relative to retailers
  // with real stock data — this is a product heuristic, not a true availability signal.
  const allUnknown =
    storeStock.items.length > 0 &&
    storeStock.items.every((item) => item.stockLevel === "UNKNOWN");
  const stockCoverageScore =
    cart.length === 0 ? 0
    : allUnknown ? 0.5
    : fulfilledCount / cart.length;
  const convenienceScore = stockCoverageScore;

  // Distance scoring: requires both user location and store coordinates
  let distanceScore: number | null = null;
  let distanceKm: number | null = null;
  if (ctx?.userLocation && storeStock.store.coords) {
    distanceKm = haversineKm(ctx.userLocation, storeStock.store.coords);
    distanceScore = distanceToScore(distanceKm);
  }

  const priceScore: number | null = null; // placeholder

  const totalScore =
    stockCoverageScore * weights.stockCoverage +
    convenienceScore * weights.convenience +
    (distanceScore ?? 0) * weights.distance +
    (priceScore ?? 0) * weights.price;

  return {
    store: storeStock.store,
    stockCoverageScore,
    convenienceScore,
    distanceScore,
    distanceKm,
    priceScore,
    totalScore,
    itemDetails,
  };
}

/**
 * Rank multiple stores for a cart. Returns sorted by totalScore descending.
 */
export function rankStores(
  storeStocks: StoreStock[],
  cart: CartItem[],
  weights?: ScoringWeights,
  ctx?: ScoringContext,
): ScoredStore[] {
  const w = weights ?? DEFAULT_WEIGHTS;
  const scored = storeStocks.map((ss) => scoreStore(ss, cart, w, ctx));

  // Price normalization: requires getItemPrice and non-zero weight
  if (ctx?.getItemPrice && w.price > 0) {
    applyPriceScores(scored, cart, ctx.getItemPrice, w);
  }

  return scored.sort((a, b) => {
    const scoreDiff = b.totalScore - a.totalScore;
    if (scoreDiff !== 0) return scoreDiff;
    // Tie-break: alphabetical by storeId
    return a.store.storeId.localeCompare(b.store.storeId);
  });
}

/**
 * Post-process: normalize price scores across candidates.
 * Cheapest store gets 1.0, most expensive gets 0.0.
 * Equal prices all get 1.0. Stores without prices are left null.
 */
function applyPriceScores(
  scored: ScoredStore[],
  cart: CartItem[],
  getPrice: (storeId: string, itemNo: string) => number | null,
  weights: ScoringWeights,
): void {
  const costs: (number | null)[] = scored.map((s) => {
    let total = 0;
    let hasPrice = false;
    for (const item of cart) {
      const price = getPrice(s.store.storeId, item.itemNo);
      if (price !== null) {
        total += price * item.quantity;
        hasPrice = true;
      }
    }
    return hasPrice ? total : null;
  });

  const validCosts = costs.filter((c): c is number => c !== null);
  if (validCosts.length < 2) return;

  const minCost = Math.min(...validCosts);
  const maxCost = Math.max(...validCosts);
  const range = maxCost - minCost;

  for (let i = 0; i < scored.length; i++) {
    const cost = costs[i];
    if (cost === null) continue;
    const ps = range === 0 ? 1.0 : 1 - (cost - minCost) / range;
    scored[i].priceScore = ps;
    scored[i].totalScore =
      scored[i].stockCoverageScore * weights.stockCoverage +
      scored[i].convenienceScore * weights.convenience +
      (scored[i].distanceScore ?? 0) * weights.distance +
      ps * weights.price;
  }
}

/**
 * Build a full recommendation result with explanations and warnings.
 */
export function buildRecommendation(
  ranked: ScoredStore[],
  cart: CartItem[],
  maxResults: number = 3,
): RecommendationResult {
  const top = ranked.slice(0, maxResults);
  const explanationPoints: string[] = [];
  const warnings: string[] = [];

  if (top.length === 0) {
    warnings.push("No stores found with any of the requested items in stock.");
    return { ranked: top, explanationPoints, warnings };
  }

  const best = top[0];
  const fulfilledCount = best.itemDetails.filter((d) => d.sufficient).length;
  const totalItems = cart.length;
  const isSingleItem = totalItems === 1;
  const isFullMatch = fulfilledCount === totalItems;
  const hasDistance = best.distanceKm !== null;

  // Point 1: stock coverage (always present)
  if (isSingleItem) {
    explanationPoints.push("In stock");
  } else if (isFullMatch) {
    explanationPoints.push(`All ${totalItems} items in stock`);
  } else {
    explanationPoints.push(`${fulfilledCount} of ${totalItems} items in stock`);
  }

  // Points 2–3: quantity and/or distance qualifier
  if (isSingleItem) {
    const detail = best.itemDetails[0];
    if (hasDistance) {
      const isClosest = top.every((s) => (s.distanceKm ?? Infinity) >= best.distanceKm!);
      if (isClosest) {
        // Concise two-point form — skip raw quantity
        explanationPoints.push("Closest available option");
      } else {
        if (detail.available !== null && detail.available > 1) {
          explanationPoints.push(`${detail.available} units available`);
        }
        explanationPoints.push(`About ${Math.round(best.distanceKm!)} km away`);
      }
    } else {
      // No distance — show quantity if useful
      if (detail.available !== null && detail.available > 1) {
        explanationPoints.push(`${detail.available} units available`);
      }
    }
  } else {
    // Multi-item cart
    if (hasDistance) {
      explanationPoints.push(
        isFullMatch ? "Best nearby full-match option" : "Good nearby option",
      );
    } else if (isFullMatch) {
      explanationPoints.push("Strong stock match");
    }
    // Partial match with no distance: only the stock coverage point is shown
  }

  // Warn about items missing at the top store
  const missingItems = best.itemDetails.filter((d) => !d.sufficient);
  if (missingItems.length > 0) {
    const missingNos = missingItems.map((d) => d.itemNo).join(", ");
    warnings.push(`Item(s) ${missingNos} not available in sufficient quantity at the top store.`);
  }

  // Warn if no store covers the full cart
  const anyFullCoverage = top.some((s) => s.itemDetails.every((d) => d.sufficient));
  if (!anyFullCoverage) {
    warnings.push("No single store has all items in sufficient quantity. Consider splitting across stores.");
  }

  return { ranked: top, explanationPoints, warnings };
}
