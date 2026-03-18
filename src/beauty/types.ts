import type { ProductInfo, StoreRef, ItemAvailability } from "../core/types.js";
import type { GeoCoord } from "../domain/geo.js";

// ──────────────────────────────────────────────
// Beauty orchestrator — domain types
// ──────────────────────────────────────────────

/** The three search modes surfaced in the UI. */
export type SearchMode = "need_today" | "best_match" | "best_value";

/** Whether this result is a direct hit or a suggested alternative. */
export type MatchKind = "exact" | "substitute";

/**
 * Structural class of the incoming query.
 * Determines how the orchestrator expands and scores candidates.
 *
 *   exact_product  — user named a specific product ("laneige lip sleeping mask")
 *   brand_product  — user named a brand + category ("cerave cleanser")
 *   need_based     — user described a need ("hydrating moisturizer for dry skin")
 */
export type QueryClass = "exact_product" | "brand_product" | "need_based";

/** Inputs to the beauty orchestrator. */
export interface BeautyQuery {
  query: string;
  mode: SearchMode;
  /** Optional — enables distance scoring and "closest" explanations. */
  userLocation?: GeoCoord;
}

/** A single ranked result card. */
export interface BeautyResult {
  product: ProductInfo;
  store: StoreRef;
  availability: ItemAvailability;
  matchKind: MatchKind;
  /** Populated only when matchKind === "substitute". */
  substituteFor?: ProductInfo;
  /** User-facing reason why this substitute is relevant. */
  substituteReason?: string;
  /**
   * Keyword match score against the query, 0–1.
   * For substitutes, this is similarity_score × primary_match_score.
   */
  matchScore: number;
  /** Composite mode-weighted rank score, 0–1. Assigned during ranking. */
  score: number;
  /** Distance to store in km. Null when userLocation is not provided. */
  distanceKm: number | null;
  /** One-line user-facing explanation for why this result appears here. */
  rankReason: string;
}

/** Full response from handleBeautyQuery(). */
export interface BeautyResponse {
  query: string;
  mode: SearchMode;
  queryClass: QueryClass;
  /** Available stores for products that directly match the query. */
  exactResults: BeautyResult[];
  /**
   * Available stores for substitute products.
   * Populated when exactResults is empty (primary product OOS everywhere),
   * or always as alternatives for the primary product.
   */
  substituteResults: BeautyResult[];
  /** True when the top-ranked matched product had no available store. */
  hasOosProducts: boolean;
  isEmpty: boolean;
}
