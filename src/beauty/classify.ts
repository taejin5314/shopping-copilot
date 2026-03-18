import type { QueryClass } from "./types.js";
import { tokenizeQuery } from "../retailers/beauty/mock-data.js";

// ──────────────────────────────────────────────
// Query classifier — deterministic, pattern-based
// No LLM. Three-class output: exact_product | brand_product | need_based
// ──────────────────────────────────────────────

/**
 * Known brand terms (lowercase, multi-word brands checked as substrings).
 * The classifier stops at brand_product if a brand is found and no exact
 * product phrase was matched.
 */
const KNOWN_BRANDS: string[] = [
  "laneige",
  "cerave",
  "neutrogena",
  "la roche-posay",
  "la roche posay",
  "lrp",
  "the ordinary",
  "eltamd",
  "nars",
  "e.l.f.",
  "elf",
  "charlotte tilbury",
  "rare beauty",
  "mac",
  "maison margiela",
  "jo malone",
  "marc jacobs",
  "dior",
  "ysl",
  "versace",
  "calvin klein",
  "aveeno",
  "summer fridays",
  "maybelline",
];

/**
 * Phrases strongly associated with a specific product.
 * Checked before brand detection — a longer phrase match takes precedence.
 */
const EXACT_PRODUCT_PHRASES: string[] = [
  // Lip
  "lip sleeping mask",
  "lip mask",
  "lip butter balm",
  // Sunscreen
  "uv clear",
  "spf 46",
  "anthelios",
  // Serums
  "niacinamide 10",
  "hyaluronic acid 2",
  "hyaluronic acid serum",
  // Complexion
  "natural radiant longwear",
  "halo glow",
  "flawless filter",
  "soft pinch",
  "studio fix",
  // Moisturizers
  "hydro boost",
  "hydra boost",
  "moisturizing cream",
  "calm restore",
  "toleriane",
  // Cleanser variants
  "hydrating facial cleanser",
  "smoothing cleanser",
  "hydrating gentle cleanser",
  // Fragrance
  "by the fireplace",
  "peony blush suede",
  "daisy edt",
  "miss dior",
  "mon paris",
  "bright crystal",
  "ck one",
];

/**
 * Classify a query into one of three structural classes.
 *
 * Priority order:
 *   1. exact_product — query contains a known product phrase
 *   2. brand_product — query contains a known brand name
 *   3. need_based    — everything else
 */
export function classifyBeautyQuery(query: string): QueryClass {
  const q = query.toLowerCase();

  // 1. Exact product phrase check (substring match)
  if (EXACT_PRODUCT_PHRASES.some((phrase) => q.includes(phrase))) {
    return "exact_product";
  }

  // 2. Brand detection
  // Multi-word brands: substring check against the full lowercased query
  // Single-word brands: token set membership (avoids partial word matches like "mac" inside "macadamia")
  const tokens = new Set(tokenizeQuery(query));

  const hasBrand = KNOWN_BRANDS.some((brand) => {
    if (brand.includes(" ")) return q.includes(brand);
    return tokens.has(brand);
  });

  if (hasBrand) return "brand_product";

  return "need_based";
}
