import type {
  StoreStock,
  ScoredStore,
  ItemScoreDetail,
  RecommendationResult,
} from "../core/types.js";

// ──────────────────────────────────────────────
// Deterministic scoring engine — pure functions
// ──────────────────────────────────────────────

export interface ScoringWeights {
  stockCoverage: number;
  convenience: number;
  distance: number;
  price: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  stockCoverage: 0.6,
  convenience: 0.3,
  distance: 0.1,
  price: 0.0, // not yet implemented
};

export interface CartItem {
  itemNo: string;
  quantity: number;
}

/**
 * Score a single store against a cart.
 * All inputs are plain data — no I/O, no LLM.
 */
export function scoreStore(
  storeStock: StoreStock,
  cart: CartItem[],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ScoredStore {
  const itemDetails: ItemScoreDetail[] = cart.map((cartItem) => {
    const match = storeStock.items.find((a) => a.itemNo === cartItem.itemNo);
    const available = match?.quantity ?? null;
    return {
      itemNo: cartItem.itemNo,
      requested: cartItem.quantity,
      available,
      sufficient: available !== null && available >= cartItem.quantity,
    };
  });

  const fulfilledCount = itemDetails.filter((d) => d.sufficient).length;
  const stockCoverageScore = cart.length > 0 ? fulfilledCount / cart.length : 0;

  // Convenience: 1.0 if this single store covers everything, decays otherwise.
  // For single-store scoring, it's simply the coverage ratio.
  const convenienceScore = stockCoverageScore;

  const distanceScore: number | null = null; // placeholder
  const priceScore: number | null = null;    // placeholder

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
): ScoredStore[] {
  return storeStocks
    .map((ss) => scoreStore(ss, cart, weights))
    .sort((a, b) => {
      const scoreDiff = b.totalScore - a.totalScore;
      if (scoreDiff !== 0) return scoreDiff;
      // Tie-break: alphabetical by storeId
      return a.store.storeId.localeCompare(b.store.storeId);
    });
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

  // Explain the top pick
  const fulfilledCount = best.itemDetails.filter((d) => d.sufficient).length;
  const totalItems = cart.length;

  if (fulfilledCount === totalItems) {
    explanationPoints.push(
      `${best.store.label} has all ${totalItems} item(s) in sufficient quantity.`,
    );
  } else {
    explanationPoints.push(
      `${best.store.label} has ${fulfilledCount} of ${totalItems} item(s) in sufficient quantity.`,
    );
  }

  explanationPoints.push(
    `Stock coverage score: ${(best.stockCoverageScore * 100).toFixed(0)}%`,
  );

  // Warn about missing items
  const missingItems = best.itemDetails.filter((d) => !d.sufficient);
  if (missingItems.length > 0) {
    const missingNos = missingItems.map((d) => d.itemNo).join(", ");
    warnings.push(`Item(s) ${missingNos} not available in sufficient quantity at the top-ranked store.`);
  }

  // Warn if no store covers the full cart
  const anyFullCoverage = top.some(
    (s) => s.itemDetails.every((d) => d.sufficient),
  );
  if (!anyFullCoverage) {
    warnings.push("No single store has all items in sufficient quantity. Consider splitting across stores.");
  }

  return { ranked: top, explanationPoints, warnings };
}
