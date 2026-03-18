import type { ProductInfo } from "../core/types.js";

// ──────────────────────────────────────────────
// Substitute graph — static directional relations
// ──────────────────────────────────────────────

export interface SubstituteRelation {
  /** Item number of the product to substitute from. */
  fromItemNo: string;
  fromRetailer: string;
  /** Item number of the suggested alternative. */
  toItemNo: string;
  toRetailer: string;
  /** User-facing explanation shown on the result card. */
  reason: string;
  /** How similar the substitute is, 0–1. Used to discount its match score. */
  similarityScore: number;
}

/**
 * Directional substitute graph.
 * Add relations in both directions when substitution makes sense both ways.
 *
 * Relation categories:
 *   - Same product, different retailer (score 1.0)
 *   - Category match, similar formula (score 0.7–0.9)
 *   - Broader category match (score 0.5–0.7)
 */
export const SUBSTITUTE_GRAPH: SubstituteRelation[] = [
  // ── Same product across retailers ──────────────────────────────────────────
  {
    fromItemNo: "ordinary-niacinamide", fromRetailer: "sephora",
    toItemNo: "ordinary-niacinamide-sdm", toRetailer: "shoppers",
    reason: "Same product — also stocked at Shoppers Drug Mart",
    similarityScore: 1.0,
  },
  {
    fromItemNo: "ordinary-niacinamide-sdm", fromRetailer: "shoppers",
    toItemNo: "ordinary-niacinamide", toRetailer: "sephora",
    reason: "Same product — also stocked at Sephora",
    similarityScore: 1.0,
  },
  {
    fromItemNo: "ordinary-ha-serum", fromRetailer: "sephora",
    toItemNo: "ordinary-ha-serum-sdm", toRetailer: "shoppers",
    reason: "Same product — also stocked at Shoppers Drug Mart",
    similarityScore: 1.0,
  },
  {
    fromItemNo: "ordinary-ha-serum-sdm", fromRetailer: "shoppers",
    toItemNo: "ordinary-ha-serum", toRetailer: "sephora",
    reason: "Same product — also stocked at Sephora",
    similarityScore: 1.0,
  },
  {
    fromItemNo: "elf-halo-glow", fromRetailer: "sephora",
    toItemNo: "elf-halo-glow-sdm", toRetailer: "shoppers",
    reason: "Same product — also stocked at Shoppers Drug Mart",
    similarityScore: 1.0,
  },
  {
    fromItemNo: "elf-halo-glow-sdm", fromRetailer: "shoppers",
    toItemNo: "elf-halo-glow", toRetailer: "sephora",
    reason: "Same product — also stocked at Sephora",
    similarityScore: 1.0,
  },

  // ── Lip care ──────────────────────────────────────────────────────────────
  {
    fromItemNo: "laneige-lip-mask", fromRetailer: "sephora",
    toItemNo: "summer-fri-lip-butter", toRetailer: "sephora",
    reason: "Both are rich overnight lip treatments — Summer Fridays is glossier with a sheer tint",
    similarityScore: 0.85,
  },
  {
    fromItemNo: "summer-fri-lip-butter", fromRetailer: "sephora",
    toItemNo: "laneige-lip-mask", toRetailer: "sephora",
    reason: "Laneige is the classic overnight lip mask with a thicker, more occlusive texture",
    similarityScore: 0.85,
  },

  // ── Sunscreen ─────────────────────────────────────────────────────────────
  {
    fromItemNo: "eltamd-uv-clear", fromRetailer: "sephora",
    toItemNo: "lr-anthelios-spf50", toRetailer: "shoppers",
    reason: "Both are mineral tinted SPF 50+ for sensitive and acne-prone skin",
    similarityScore: 0.82,
  },
  {
    fromItemNo: "lr-anthelios-spf50", fromRetailer: "shoppers",
    toItemNo: "eltamd-uv-clear", toRetailer: "sephora",
    reason: "Both are mineral tinted SPFs for sensitive skin — EltaMD is dermatologist-favourite",
    similarityScore: 0.82,
  },

  // ── Complexion / Filter ───────────────────────────────────────────────────
  {
    fromItemNo: "charlotte-tilbury-flawless", fromRetailer: "sephora",
    toItemNo: "elf-halo-glow", toRetailer: "sephora",
    reason: "e.l.f. Halo Glow delivers the same glass-skin filter effect at a fraction of the price",
    similarityScore: 0.82,
  },
  {
    fromItemNo: "charlotte-tilbury-flawless", fromRetailer: "sephora",
    toItemNo: "elf-halo-glow-sdm", toRetailer: "shoppers",
    reason: "Same e.l.f. Halo Glow formula available at Shoppers — great value alternative",
    similarityScore: 0.82,
  },
  {
    fromItemNo: "elf-halo-glow", fromRetailer: "sephora",
    toItemNo: "charlotte-tilbury-flawless", toRetailer: "sephora",
    reason: "Charlotte Tilbury Flawless Filter is the premium version of this glow-filter formula",
    similarityScore: 0.80,
  },

  // ── Foundation ────────────────────────────────────────────────────────────
  {
    fromItemNo: "nars-natural-radiant", fromRetailer: "sephora",
    toItemNo: "mac-studio-fix", toRetailer: "sephora",
    reason: "MAC Studio Fix offers comparable full coverage with a more matte finish",
    similarityScore: 0.72,
  },
  {
    fromItemNo: "mac-studio-fix", fromRetailer: "sephora",
    toItemNo: "nars-natural-radiant", toRetailer: "sephora",
    reason: "NARS Natural Radiant gives similar coverage with a more luminous, skin-like finish",
    similarityScore: 0.72,
  },
  {
    fromItemNo: "mac-studio-fix", fromRetailer: "sephora",
    toItemNo: "maybelline-fit-me", toRetailer: "shoppers",
    reason: "Maybelline Fit Me is a drugstore matte foundation with similar coverage at $14",
    similarityScore: 0.65,
  },
  {
    fromItemNo: "maybelline-fit-me", fromRetailer: "shoppers",
    toItemNo: "mac-studio-fix", toRetailer: "sephora",
    reason: "MAC Studio Fix is the premium step-up with a wider shade range",
    similarityScore: 0.65,
  },

  // ── Cleanser ──────────────────────────────────────────────────────────────
  {
    fromItemNo: "cerave-hydrating-cleanser", fromRetailer: "shoppers",
    toItemNo: "lrp-toleriane-cleanser", toRetailer: "shoppers",
    reason: "La Roche-Posay Toleriane is equally gentle with a ceramide formula for sensitive skin",
    similarityScore: 0.85,
  },
  {
    fromItemNo: "lrp-toleriane-cleanser", fromRetailer: "shoppers",
    toItemNo: "cerave-hydrating-cleanser", toRetailer: "shoppers",
    reason: "CeraVe Hydrating Cleanser covers the same gentle niche — larger size, better value",
    similarityScore: 0.85,
  },
  {
    fromItemNo: "cerave-sa-cleanser", fromRetailer: "shoppers",
    toItemNo: "cerave-hydrating-cleanser", toRetailer: "shoppers",
    reason: "If you want less exfoliation, the hydrating version is a gentler daily option",
    similarityScore: 0.70,
  },

  // ── Fragrance — luxury ────────────────────────────────────────────────────
  {
    fromItemNo: "jo-malone-peony", fromRetailer: "sephora",
    toItemNo: "mmr-by-fireplace", toRetailer: "sephora",
    reason: "Both are Sephora luxury fragrances in the gift tier — By the Fireplace is warmer and more unisex",
    similarityScore: 0.55,
  },
  {
    fromItemNo: "mmr-by-fireplace", fromRetailer: "sephora",
    toItemNo: "jo-malone-peony", toRetailer: "sephora",
    reason: "Jo Malone Peony is lighter and more floral — classic luxury gift fragrance",
    similarityScore: 0.55,
  },

  // ── Fragrance — mid-range ─────────────────────────────────────────────────
  {
    fromItemNo: "marc-jacobs-daisy", fromRetailer: "shoppers",
    toItemNo: "dior-miss-dior", toRetailer: "shoppers",
    reason: "Both are classic floral feminines — Miss Dior is slightly richer and more romantic",
    similarityScore: 0.72,
  },
  {
    fromItemNo: "dior-miss-dior", fromRetailer: "shoppers",
    toItemNo: "marc-jacobs-daisy", toRetailer: "shoppers",
    reason: "Both are classic floral feminines — Daisy is fresher and lighter",
    similarityScore: 0.72,
  },
  {
    fromItemNo: "ysl-mon-paris", fromRetailer: "shoppers",
    toItemNo: "dior-miss-dior", toRetailer: "shoppers",
    reason: "Both are romantic floral fragrances — Miss Dior is a bit softer for daytime",
    similarityScore: 0.65,
  },

  // ── Fragrance — affordable ────────────────────────────────────────────────
  {
    fromItemNo: "versace-bright-crystal", fromRetailer: "shoppers",
    toItemNo: "calvin-klein-ck-one", toRetailer: "shoppers",
    reason: "Both are light affordable everyday fragrances under $50",
    similarityScore: 0.70,
  },
  {
    fromItemNo: "calvin-klein-ck-one", fromRetailer: "shoppers",
    toItemNo: "versace-bright-crystal", toRetailer: "shoppers",
    reason: "Both are light affordable everyday fragrances under $50",
    similarityScore: 0.70,
  },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────

/** Returns all substitute relations for a given product. */
export function getSubstitutes(itemNo: string, retailer: string): SubstituteRelation[] {
  return SUBSTITUTE_GRAPH.filter(
    (r) => r.fromItemNo === itemNo && r.fromRetailer === retailer,
  );
}

/**
 * Given a set of products (the pool to look up in), resolve substitute
 * ProductInfo objects for a primary product.
 * Returns only substitutes whose toItemNo is present in productPool.
 */
export function resolveSubstitutes(
  primaryItemNo: string,
  primaryRetailer: string,
  productPool: ProductInfo[],
): Array<{ product: ProductInfo; relation: SubstituteRelation }> {
  const relations = getSubstitutes(primaryItemNo, primaryRetailer);
  const results: Array<{ product: ProductInfo; relation: SubstituteRelation }> = [];

  for (const rel of relations) {
    const product = productPool.find(
      (p) => p.itemNo === rel.toItemNo && p.retailer === rel.toRetailer,
    );
    if (product) {
      results.push({ product, relation: rel });
    }
  }

  return results;
}
