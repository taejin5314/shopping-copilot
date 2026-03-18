import type { RetailerAdapter } from "../core/adapter.js";
import type { ProductInfo, StoreRef, ItemAvailability } from "../core/types.js";
import {
  SEPHORA_PRODUCTS,
  SHOPPERS_PRODUCTS,
  scoreBeautyProduct,
  tokenizeQuery,
} from "../retailers/beauty/mock-data.js";
import type { BeautyQuery, BeautyResult, BeautyResponse, SearchMode } from "./types.js";
import { classifyBeautyQuery } from "./classify.js";
import { resolveSubstitutes } from "./substitutes.js";
import { rankBeautyResults, generateRankReason, computeDistance } from "./ranking.js";

// ──────────────────────────────────────────────
// Beauty orchestrator
// Coordinates SephoraAdapter + ShoppersAdapter into a unified result set.
// Pure TypeScript domain logic — no LLM, no network I/O.
// ──────────────────────────────────────────────

const MAX_EXACT_RESULTS = 4;
const MAX_SUBSTITUTE_RESULTS = 3;
const SEARCH_RESULTS_PER_ADAPTER = 6;
const MATCH_THRESHOLD = 0.15;

// Full product catalogue — used for substitute resolution.
const ALL_PRODUCTS: ProductInfo[] = [...SEPHORA_PRODUCTS, ...SHOPPERS_PRODUCTS];

// ── Types internal to the orchestrator ────────────────────────────────────

interface ScoredProduct {
  product: ProductInfo;
  matchScore: number;
}

interface AvailableSlot {
  product: ProductInfo;
  store: StoreRef;
  availability: ItemAvailability;
  matchScore: number;
}

// ── Core logic ─────────────────────────────────────────────────────────────

/**
 * Search both adapters and return scored product matches above threshold.
 * Uses scoreBeautyProduct directly to obtain numeric scores alongside results.
 */
async function searchAll(
  query: string,
  adapters: RetailerAdapter[],
): Promise<ScoredProduct[]> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  // Score every product in the full catalogue against query tokens.
  // This is O(products) = ~28 items — negligible. We don't call adapter.searchProducts
  // so we can get exact scores; the adapter's method doesn't expose them.
  const scored: ScoredProduct[] = ALL_PRODUCTS
    .map((product) => ({ product, matchScore: scoreBeautyProduct(product as any, tokens) }))
    .filter(({ matchScore }) => matchScore >= MATCH_THRESHOLD)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, SEARCH_RESULTS_PER_ADAPTER * adapters.length);

  return scored;
}

/**
 * Check availability for a set of products at their respective retailer's stores.
 * Returns only slots where the product is actually available.
 */
async function fetchAvailableSlots(
  scoredProducts: ScoredProduct[],
  adapters: RetailerAdapter[],
): Promise<{ available: AvailableSlot[]; oosItemNos: Set<string> }> {
  const available: AvailableSlot[] = [];
  const oosItemNos = new Set<string>(); // products with zero available stores

  // Group products by retailer
  const byRetailer = new Map<string, ScoredProduct[]>();
  for (const sp of scoredProducts) {
    const retailer = sp.product.retailer;
    const list = byRetailer.get(retailer) ?? [];
    list.push(sp);
    byRetailer.set(retailer, list);
  }

  // For each retailer, call findStoresForCart
  for (const adapter of adapters) {
    const group = byRetailer.get(adapter.retailerId);
    if (!group || group.length === 0) continue;

    const items = group.map((sp) => ({ itemNo: sp.product.itemNo, quantity: 1 }));
    const storeStocks = await adapter.findStoresForCart(items);

    // Invert: product → [ {store, availability} ]
    for (const sp of group) {
      let foundAny = false;

      for (const ss of storeStocks) {
        const avail = ss.items.find((a) => a.itemNo === sp.product.itemNo);
        if (!avail || !avail.available) continue;

        foundAny = true;
        available.push({
          product: sp.product,
          store: ss.store,
          availability: avail,
          matchScore: sp.matchScore,
        });
      }

      if (!foundAny) {
        oosItemNos.add(`${sp.product.retailer}::${sp.product.itemNo}`);
      }
    }
  }

  return { available, oosItemNos };
}

/**
 * Resolve substitutes for products that are OOS everywhere.
 * Returns available slots for substitute products.
 */
async function fetchSubstituteSlots(
  oosProducts: ScoredProduct[],
  adapters: RetailerAdapter[],
): Promise<AvailableSlot[]> {
  if (oosProducts.length === 0) return [];

  // Collect all (substituteProduct, relation) pairs, deduplicated by itemNo
  const seenSubItemNos = new Set<string>();
  const substituteCandidates: Array<{
    product: ProductInfo;
    primaryMatchScore: number;
    similarityScore: number;
    reason: string;
    substituteFor: ProductInfo;
  }> = [];

  for (const sp of oosProducts) {
    const subs = resolveSubstitutes(sp.product.itemNo, sp.product.retailer, ALL_PRODUCTS);
    for (const { product, relation } of subs) {
      const key = `${product.retailer}::${product.itemNo}`;
      if (seenSubItemNos.has(key)) continue;
      seenSubItemNos.add(key);
      substituteCandidates.push({
        product,
        primaryMatchScore: sp.matchScore,
        similarityScore: relation.similarityScore,
        reason: relation.reason,
        substituteFor: sp.product,
      });
    }
  }

  if (substituteCandidates.length === 0) return [];

  // Convert to ScoredProduct for fetchAvailableSlots
  const scoredSubs: ScoredProduct[] = substituteCandidates.map((sc) => ({
    product: sc.product,
    matchScore: sc.primaryMatchScore * sc.similarityScore,
  }));

  const { available: subSlots } = await fetchAvailableSlots(scoredSubs, adapters);

  // Attach substituteFor + reason to each slot via a parallel map
  // We use a Map keyed by `retailer::itemNo` to look up original candidate info
  const candidateMap = new Map(
    substituteCandidates.map((sc) => [
      `${sc.product.retailer}::${sc.product.itemNo}`,
      sc,
    ]),
  );

  return subSlots.map((slot) => {
    const candidate = candidateMap.get(`${slot.product.retailer}::${slot.product.itemNo}`);
    return {
      ...slot,
      substituteFor: candidate?.substituteFor,
      substituteReason: candidate?.reason,
    };
  });
}

/** Convert an AvailableSlot into a BeautyResult (sans score and rankReason). */
function buildResult(
  slot: AvailableSlot & { substituteFor?: ProductInfo; substituteReason?: string },
  query: BeautyQuery,
  matchKind: "exact" | "substitute",
): BeautyResult {
  const distanceKm = computeDistance(query.userLocation, slot.store.coords);
  return {
    product: slot.product,
    store: slot.store,
    availability: slot.availability,
    matchKind,
    substituteFor: slot.substituteFor,
    substituteReason: slot.substituteReason,
    matchScore: slot.matchScore,
    score: 0, // filled by rankBeautyResults
    distanceKm,
    rankReason: "", // filled after ranking
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Handle a beauty query end-to-end.
 *
 * @param query   The structured query (text, mode, optional location).
 * @param adapters Array of retailer adapters to search — typically [SephoraAdapter, ShoppersAdapter].
 */
export async function handleBeautyQuery(
  query: BeautyQuery,
  adapters: RetailerAdapter[],
): Promise<BeautyResponse> {
  if (!query.query.trim()) {
    return emptyResponse(query);
  }

  const queryClass = classifyBeautyQuery(query.query);

  // 1. Score products against the query
  const scoredProducts = await searchAll(query.query, adapters);
  if (scoredProducts.length === 0) {
    return emptyResponse(query, queryClass);
  }

  // 2. Check availability — get available slots and OOS product keys
  const { available: exactSlots, oosItemNos } = await fetchAvailableSlots(
    scoredProducts,
    adapters,
  );

  // 3. Identify OOS products (zero available stores)
  const oosProducts = scoredProducts.filter(
    (sp) => oosItemNos.has(`${sp.product.retailer}::${sp.product.itemNo}`),
  );
  const hasOosProducts = oosProducts.length > 0;

  // 4. Build exact result objects
  const exactResults = exactSlots.map((slot) =>
    buildResult(slot, query, "exact"),
  );

  // 5. Substitutes: always computed for OOS products, shown only when useful
  const substituteSlots = await fetchSubstituteSlots(oosProducts, adapters);

  // Exclude substitute slots whose product already appears as an exact result
  const exactProductKeys = new Set(
    exactResults.map((r) => `${r.product.retailer}::${r.product.itemNo}`),
  );
  const filteredSubSlots = substituteSlots.filter(
    (slot) => !exactProductKeys.has(`${slot.product.retailer}::${slot.product.itemNo}`),
  );

  const substituteResults = filteredSubSlots.map((slot) =>
    buildResult(slot as any, query, "substitute"),
  );

  // 6. Rank both lists independently
  const rankedExact = rankBeautyResults(exactResults, query.mode).slice(
    0,
    MAX_EXACT_RESULTS,
  );
  const rankedSubs = rankBeautyResults(substituteResults, query.mode).slice(
    0,
    MAX_SUBSTITUTE_RESULTS,
  );

  // 7. Attach rank reasons
  const finalExact = rankedExact.map((r, i) => ({
    ...r,
    rankReason: generateRankReason(r, query.mode, i),
  }));
  const finalSubs = rankedSubs.map((r, i) => ({
    ...r,
    rankReason: generateRankReason(r, query.mode, i),
  }));

  return {
    query: query.query,
    mode: query.mode,
    queryClass,
    exactResults: finalExact,
    substituteResults: finalSubs,
    hasOosProducts,
    isEmpty: finalExact.length === 0 && finalSubs.length === 0,
  };
}

function emptyResponse(query: BeautyQuery, queryClass: import("./types.js").QueryClass = "need_based"): BeautyResponse {
  return {
    query: query.query,
    mode: query.mode,
    queryClass,
    exactResults: [],
    substituteResults: [],
    hasOosProducts: false,
    isEmpty: true,
  };
}
