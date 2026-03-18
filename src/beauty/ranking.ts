import type { BeautyResult, SearchMode } from "./types.js";
import { haversineKm, distanceToScore } from "../domain/geo.js";
import type { GeoCoord } from "../domain/geo.js";

// ──────────────────────────────────────────────
// Beauty ranking — mode-aware composite scoring
// All functions are pure; no I/O, no LLM.
// ──────────────────────────────────────────────

/**
 * City-scale travel: 3 km half-life.
 * A store 3 km away scores 0.5; one 0.5 km away scores ~0.86.
 */
const TRAVEL_HALF_LIFE_KM = 3;

interface ModeWeights {
  /** Travel proximity — higher = prefers closer stores. */
  travel: number;
  /** Stock level — HIGH_IN_STOCK preferred over LOW_IN_STOCK. */
  stock: number;
  /** Keyword match quality. */
  match: number;
  /** Cheaper price preferred. */
  price: number;
}

const WEIGHTS: Record<SearchMode, ModeWeights> = {
  need_today: { travel: 0.55, stock: 0.30, match: 0.10, price: 0.05 },
  best_match: { travel: 0.20, stock: 0.15, match: 0.55, price: 0.10 },
  best_value: { travel: 0.15, stock: 0.05, match: 0.20, price: 0.60 },
};

// ── Component scorers ──────────────────────────────────────────────────────

function travelScore(result: BeautyResult): number {
  if (result.distanceKm === null) return 0.5; // neutral when location unknown
  return distanceToScore(result.distanceKm, TRAVEL_HALF_LIFE_KM);
}

function stockScore(result: BeautyResult): number {
  const level = result.availability.stockLevel;
  if (level === "HIGH_IN_STOCK") return 1.0;
  if (level === "LOW_IN_STOCK") return 0.5;
  return 0;
}

function priceScoreNormalized(results: BeautyResult[]): Map<BeautyResult, number> {
  const scores = new Map<BeautyResult, number>();
  const prices = results
    .map((r) => r.product.price?.amount ?? null)
    .filter((p): p is number => p !== null);

  if (prices.length === 0) {
    results.forEach((r) => scores.set(r, 0.5)); // neutral
    return scores;
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice;

  for (const r of results) {
    const price = r.product.price?.amount ?? null;
    if (price === null) {
      scores.set(r, 0.5);
    } else if (range === 0) {
      scores.set(r, 1.0);
    } else {
      // Cheaper = higher score
      scores.set(r, 1 - (price - minPrice) / range);
    }
  }

  return scores;
}

// ── Main ranking entry point ───────────────────────────────────────────────

/**
 * Rank a flat list of BeautyResults for a given mode.
 * Mutates each result's `.score` field, then returns them sorted descending.
 *
 * Price normalization is applied across the entire list so that the cheapest
 * result always scores 1.0 on the price dimension.
 */
export function rankBeautyResults(
  results: BeautyResult[],
  mode: SearchMode,
): BeautyResult[] {
  if (results.length === 0) return results;

  const w = WEIGHTS[mode];
  const priceScores = priceScoreNormalized(results);

  for (const r of results) {
    r.score =
      travelScore(r) * w.travel +
      stockScore(r) * w.stock +
      r.matchScore * w.match +
      (priceScores.get(r) ?? 0.5) * w.price;
  }

  return results.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    // Tie-break: prefer HIGH_IN_STOCK, then closer store, then alphabetical
    const stockDiff = stockScore(b) - stockScore(a);
    if (stockDiff !== 0) return stockDiff;
    return a.store.storeId.localeCompare(b.store.storeId);
  });
}

// ── Explanation generation ─────────────────────────────────────────────────

/**
 * Generate a one-line user-facing rank reason for a result.
 * The reason adapts to mode and available data.
 */
export function generateRankReason(
  result: BeautyResult,
  mode: SearchMode,
  rank: number,
): string {
  const price = result.product.price?.amount;
  const stock = result.availability.stockLevel;
  const isLow = stock === "LOW_IN_STOCK";
  const distKm = result.distanceKm;

  const distLabel =
    distKm === null
      ? null
      : distKm < 0.5
      ? "steps away"
      : distKm < 1
      ? `${Math.round(distKm * 1000)} m away`
      : `${distKm.toFixed(1)} km away`;

  if (result.matchKind === "substitute") {
    return result.substituteReason ?? "Alternative product with similar benefits";
  }

  if (mode === "need_today") {
    if (rank === 0 && distLabel) return `Closest option — ${distLabel}`;
    if (distLabel) return `${isLow ? "Low stock — " : ""}${distLabel}`;
    if (isLow) return "Low stock — grab it now";
    return "In stock nearby";
  }

  if (mode === "best_match") {
    if (rank === 0) return isLow ? "Best match — only a few left" : "Best match for your search";
    return isLow ? "Good match — low stock" : "Good match";
  }

  // best_value
  if (price !== null) {
    const priceStr = `$${price}`;
    if (rank === 0) return `Best value at ${priceStr}`;
    if (distLabel) return `${priceStr} — ${distLabel}`;
    return `${priceStr}`;
  }
  return "Good value option";
}

// ── Distance helper ────────────────────────────────────────────────────────

/**
 * Compute distance from user to store, in km.
 * Returns null if either coordinate is missing.
 */
export function computeDistance(
  userLocation: GeoCoord | undefined,
  storeCoords: { lat: number; lng: number } | undefined,
): number | null {
  if (!userLocation || !storeCoords) return null;
  return haversineKm(userLocation, storeCoords);
}
