import type { StoreRef, ProductInfo, ItemAvailability } from "../../core/types.js";

// ──────────────────────────────────────────────────────────────────
// Beauty mock data — Toronto Sephora + Shoppers Drug Mart
// Reference point: Yonge & Bloor (43.6710, -79.3863)
// Used by SephoraAdapter and ShoppersAdapter.
// Replace individual availability entries with real API calls later.
// ──────────────────────────────────────────────────────────────────

// ── Stores ────────────────────────────────────────────────────────

export const SEPHORA_STORES: StoreRef[] = [
  {
    retailer: "sephora",
    storeId: "sep-eaton-centre",
    label: "Sephora — CF Eaton Centre",
    coords: { lat: 43.6544, lng: -79.3807 },
  },
  {
    retailer: "sephora",
    storeId: "sep-yorkdale",
    label: "Sephora — Yorkdale Shopping Centre",
    coords: { lat: 43.7255, lng: -79.4513 },
  },
  {
    retailer: "sephora",
    storeId: "sep-fairview",
    label: "Sephora — Fairview Mall",
    coords: { lat: 43.7728, lng: -79.3344 },
  },
  {
    retailer: "sephora",
    storeId: "sep-scarborough",
    label: "Sephora — Scarborough Town Centre",
    coords: { lat: 43.7756, lng: -79.2571 },
  },
];

export const SHOPPERS_STORES: StoreRef[] = [
  {
    retailer: "shoppers",
    storeId: "sdm-bloor-yonge",
    label: "Shoppers Drug Mart — Bloor & Yonge",
    coords: { lat: 43.6706, lng: -79.3863 },
  },
  {
    retailer: "shoppers",
    storeId: "sdm-bay-st",
    label: "Shoppers Drug Mart — Bay St",
    coords: { lat: 43.6676, lng: -79.3864 },
  },
  {
    retailer: "shoppers",
    storeId: "sdm-college",
    label: "Shoppers Drug Mart — College St",
    coords: { lat: 43.6568, lng: -79.4089 },
  },
  {
    retailer: "shoppers",
    storeId: "sdm-queen-west",
    label: "Shoppers Drug Mart — Queen West",
    coords: { lat: 43.6489, lng: -79.4022 },
  },
  {
    retailer: "shoppers",
    storeId: "sdm-danforth",
    label: "Shoppers Drug Mart — Danforth",
    coords: { lat: 43.6776, lng: -79.3488 },
  },
];

// ── Products ──────────────────────────────────────────────────────

/**
 * Extended ProductInfo with search tags (internal to the beauty adapters).
 * Tags are not part of the core ProductInfo shape, so we store them separately.
 */
export interface BeautyProduct extends ProductInfo {
  /** Comma-joined search terms: ingredients, skin concerns, texture, use case */
  readonly _tags: string;
}

function p(
  retailer: "sephora" | "shoppers",
  itemNo: string,
  name: string,
  brand: string,
  typeName: string,
  price: number,
  variant: string,
  url: string,
  tags: string,
): BeautyProduct {
  return {
    retailer,
    itemNo,
    name: `${brand} ${name}`,
    typeName,
    price: { amount: price, currency: "CAD" },
    url,
    measureText: variant,
    designText: null,
    imageUrl: null,
    _tags: tags,
  };
}

export const SEPHORA_PRODUCTS: BeautyProduct[] = [
  // ── Lip care ──
  p("sephora", "laneige-lip-mask", "Lip Sleeping Mask", "Laneige",
    "Lip Care", 32, "Berry · 20 ml",
    "https://www.sephora.com/product/lip-sleeping-mask",
    "lip mask sleeping overnight hydrating moisturizing berry vitamin c laneige korean plumping repair dry lips"),

  p("sephora", "summer-fri-lip-butter", "Lip Butter Balm", "Summer Fridays",
    "Lip Care", 28, "Brown Sugar · 11 g",
    "https://www.sephora.com/product/lip-butter-balm",
    "lip balm butter hydrating glossy tinted non-sticky shea peptides plumping daily"),

  // ── Sunscreen ──
  p("sephora", "eltamd-uv-clear", "UV Clear SPF 46", "EltaMD",
    "Sunscreen", 55, "Tinted · 48 g",
    "https://www.sephora.com/product/uv-clear-broad-spectrum-spf-46",
    "sunscreen spf mineral zinc oxide tinted acne oily sensitive rosacea dermatologist lightweight"),

  // ── Serums ──
  p("sephora", "ordinary-niacinamide", "Niacinamide 10% + Zinc 1%", "The Ordinary",
    "Serum", 12, "30 ml",
    "https://www.sephora.com/product/niacinamide-10-zinc-1",
    "niacinamide zinc serum pores oily acne brightening dark spots hyperpigmentation texture affordable"),

  p("sephora", "ordinary-ha-serum", "Hyaluronic Acid 2% + B5", "The Ordinary",
    "Serum", 10, "30 ml",
    "https://www.sephora.com/product/hyaluronic-acid-2-b5",
    "hyaluronic acid serum hydrating plumping vitamin b5 dehydrated lightweight affordable"),

  // ── Makeup: complexion ──
  p("sephora", "nars-natural-radiant", "Natural Radiant Longwear Foundation", "NARS",
    "Foundation", 68, "30 ml · 40 shades",
    "https://www.sephora.com/product/natural-radiant-longwear-foundation",
    "foundation radiant glow luminous full coverage longwear dewy premium all skin types"),

  p("sephora", "elf-halo-glow", "Halo Glow Liquid Filter", "e.l.f.",
    "Complexion Booster", 18, "40 ml",
    "https://www.sephora.com/product/halo-glow-liquid-filter",
    "foundation filter glow luminous glass skin serum affordable dewy skincare makeup tint"),

  p("sephora", "charlotte-tilbury-flawless", "Flawless Filter", "Charlotte Tilbury",
    "Complexion Booster", 58, "30 ml",
    "https://www.sephora.com/product/flawless-filter",
    "foundation filter glow glass skin luminous premium dewy soft focus skincare makeup tint"),

  p("sephora", "rare-beauty-blush", "Soft Pinch Liquid Blush", "Rare Beauty",
    "Blush", 38, "7.5 ml · Various shades",
    "https://www.sephora.com/product/soft-pinch-liquid-blush",
    "blush liquid flushed natural glow buildable dewy cheeks viral tiktok premium selena gomez"),

  p("sephora", "mac-studio-fix", "Studio Fix Fluid SPF 15", "MAC",
    "Foundation", 54, "30 ml · Full coverage",
    "https://www.sephora.com/product/studio-fix-fluid-spf-15",
    "foundation full coverage matte longwear professional spf buildable"),

  // ── Fragrance ──
  p("sephora", "mmr-by-fireplace", "Replica By the Fireplace EDP", "Maison Margiela",
    "Fragrance", 215, "100 ml EDP",
    "https://www.sephora.com/product/replica-by-the-fireplace",
    "fragrance perfume woody warm cosy smoke vanilla chestnut unisex winter gift luxury premium"),

  p("sephora", "jo-malone-peony", "Peony & Blush Suede Cologne", "Jo Malone London",
    "Fragrance", 238, "100 ml Cologne",
    "https://www.sephora.com/product/peony-blush-suede-cologne",
    "fragrance perfume floral peony feminine romantic suede gift luxury light spring premium"),
];

export const SHOPPERS_PRODUCTS: BeautyProduct[] = [
  // ── Cleansers ──
  p("shoppers", "cerave-hydrating-cleanser", "Hydrating Facial Cleanser", "CeraVe",
    "Cleanser", 18, "473 ml · All skin types",
    "https://www.shoppersdrugmart.ca/beauty/skincare/cerave-hydrating-facial-cleanser",
    "cleanser hydrating gentle fragrance-free ceramide hyaluronic acid non-foaming dry normal sensitive drugstore daily affordable"),

  p("shoppers", "cerave-sa-cleanser", "Smoothing Cleanser", "CeraVe",
    "Cleanser", 20, "236 ml · SA formula",
    "https://www.shoppersdrugmart.ca/beauty/skincare/cerave-smoothing-cleanser",
    "cleanser exfoliating salicylic acid rough bumpy keratosis pilaris kp texture ceramide drugstore"),

  p("shoppers", "lrp-toleriane-cleanser", "Toleriane Hydrating Gentle Cleanser", "La Roche-Posay",
    "Cleanser", 22, "400 ml · Sensitive skin",
    "https://www.shoppersdrugmart.ca/beauty/skincare/la-roche-posay-toleriane",
    "cleanser hydrating gentle sensitive ceramide fragrance-free redness reactive dermatologist drugstore daily"),

  // ── Serums (also at Shoppers) ──
  p("shoppers", "ordinary-niacinamide-sdm", "Niacinamide 10% + Zinc 1%", "The Ordinary",
    "Serum", 12, "30 ml",
    "https://www.shoppersdrugmart.ca/beauty/skincare/the-ordinary-niacinamide",
    "niacinamide zinc serum pores oily acne brightening dark spots hyperpigmentation texture affordable"),

  p("shoppers", "ordinary-ha-serum-sdm", "Hyaluronic Acid 2% + B5", "The Ordinary",
    "Serum", 10, "30 ml",
    "https://www.shoppersdrugmart.ca/beauty/skincare/the-ordinary-hyaluronic-acid",
    "hyaluronic acid serum hydrating plumping vitamin b5 dehydrated lightweight affordable"),

  // ── Moisturizers ──
  p("shoppers", "cerave-moisturizing-cream", "Moisturizing Cream", "CeraVe",
    "Moisturizer", 22, "454 g · Dry to very dry",
    "https://www.shoppersdrugmart.ca/beauty/skincare/cerave-moisturizing-cream",
    "moisturizer cream rich ceramide hyaluronic acid dry very dry fragrance-free non-comedogenic drugstore affordable face body"),

  p("shoppers", "neutrogena-hydro-boost-gel", "Hydro Boost Water Gel", "Neutrogena",
    "Moisturizer", 28, "50 ml · Gel moisturizer",
    "https://www.shoppersdrugmart.ca/beauty/skincare/neutrogena-hydro-boost-water-gel",
    "moisturizer gel hydrating hyaluronic acid lightweight oil-free oily combination non-comedogenic drugstore daily"),

  p("shoppers", "aveeno-calm-restore", "Calm + Restore Oat Gel Moisturizer", "Aveeno",
    "Moisturizer", 24, "48 g · Sensitive skin",
    "https://www.shoppersdrugmart.ca/beauty/skincare/aveeno-calm-restore",
    "moisturizer gel oat calming sensitive redness fragrance-free hypoallergenic drugstore lightweight soothing"),

  // ── Sunscreen ──
  p("shoppers", "lr-anthelios-spf50", "Anthelios Mineral Tinted SPF 50+", "La Roche-Posay",
    "Sunscreen", 38, "45 ml · Mineral",
    "https://www.shoppersdrugmart.ca/beauty/suncare/la-roche-posay-anthelios-spf50",
    "sunscreen spf mineral zinc oxide titanium dioxide tinted sensitive dermatologist daily uv broad spectrum oily acne-prone"),

  // ── Makeup ──
  p("shoppers", "maybelline-fit-me", "Fit Me Matte + Poreless Foundation", "Maybelline",
    "Foundation", 14, "30 ml · Various shades",
    "https://www.shoppersdrugmart.ca/beauty/makeup/maybelline-fit-me",
    "foundation matte pore-minimizing medium coverage affordable drugstore oily combination everyday lightweight"),

  p("shoppers", "elf-halo-glow-sdm", "Halo Glow Liquid Filter", "e.l.f.",
    "Complexion Booster", 18, "40 ml",
    "https://www.shoppersdrugmart.ca/beauty/makeup/elf-halo-glow",
    "foundation filter glow luminous glass skin serum affordable dewy tint"),

  // ── Fragrance ──
  p("shoppers", "marc-jacobs-daisy", "Daisy EDT", "Marc Jacobs",
    "Fragrance", 112, "50 ml EDT",
    "https://www.shoppersdrugmart.ca/beauty/fragrance/marc-jacobs-daisy",
    "fragrance perfume floral fresh feminine daisy light classic iconic everyday spring gift"),

  p("shoppers", "dior-miss-dior", "Miss Dior Blooming Bouquet EDT", "Dior",
    "Fragrance", 155, "50 ml EDT",
    "https://www.shoppersdrugmart.ca/beauty/fragrance/dior-miss-dior",
    "fragrance perfume floral feminine romantic rose luxury gift classic light fresh powder"),

  p("shoppers", "ysl-mon-paris", "Mon Paris EDP", "YSL",
    "Fragrance", 148, "50 ml EDP",
    "https://www.shoppersdrugmart.ca/beauty/fragrance/ysl-mon-paris",
    "fragrance perfume floral fruity feminine romantic vibrant intense date night gift"),

  p("shoppers", "versace-bright-crystal", "Bright Crystal EDT", "Versace",
    "Fragrance", 42, "30 ml EDT",
    "https://www.shoppersdrugmart.ca/beauty/fragrance/versace-bright-crystal",
    "fragrance perfume floral fresh light feminine affordable under 50 everyday spring summer gift"),

  p("shoppers", "calvin-klein-ck-one", "CK One EDT", "Calvin Klein",
    "Fragrance", 35, "100 ml EDT",
    "https://www.shoppersdrugmart.ca/beauty/fragrance/calvin-klein-ck-one",
    "fragrance perfume fresh clean unisex citrus affordable under 50 classic everyday gift"),
];

// ── Availability matrix ────────────────────────────────────────────
// Maps storeId → itemNo → ItemAvailability.
// "UNKNOWN" stock level means per-store data not available; we show it as available.

type StockStatus = "HIGH_IN_STOCK" | "LOW_IN_STOCK" | "OUT_OF_STOCK";

function avail(
  available: boolean,
  quantity: number | null,
  level: StockStatus,
): ItemAvailability {
  return { itemNo: "", available, quantity, stockLevel: level, canNotify: !available };
}

const IN = (qty?: number) => avail(true, qty ?? null, "HIGH_IN_STOCK");
const LOW = (qty?: number) => avail(true, qty ?? null, "LOW_IN_STOCK");
const OOS = () => avail(false, 0, "OUT_OF_STOCK");

/**
 * SEPHORA_AVAILABILITY[storeId][itemNo] → ItemAvailability (without itemNo set).
 * The adapter fills in itemNo before returning.
 */
export const SEPHORA_AVAILABILITY: Record<string, Record<string, ItemAvailability>> = {
  "sep-eaton-centre": {
    "laneige-lip-mask":              IN(24),
    "summer-fri-lip-butter":         IN(18),
    "eltamd-uv-clear":               IN(12),
    "ordinary-niacinamide":          IN(40),
    "ordinary-ha-serum":             IN(35),
    "nars-natural-radiant":          IN(20),
    "elf-halo-glow":                 IN(30),
    "charlotte-tilbury-flawless":    IN(15),
    "rare-beauty-blush":             IN(22),
    "mac-studio-fix":                IN(18),
    "mmr-by-fireplace":              IN(8),
    "jo-malone-peony":               LOW(3),
  },
  "sep-yorkdale": {
    "laneige-lip-mask":              IN(16),
    "summer-fri-lip-butter":         IN(10),
    "eltamd-uv-clear":               OOS(),
    "ordinary-niacinamide":          IN(28),
    "ordinary-ha-serum":             OOS(),
    "nars-natural-radiant":          IN(14),
    "elf-halo-glow":                 IN(22),
    "charlotte-tilbury-flawless":    LOW(4),
    "rare-beauty-blush":             IN(16),
    "mac-studio-fix":                IN(12),
    "mmr-by-fireplace":              LOW(2),
    "jo-malone-peony":               OOS(),
  },
  "sep-fairview": {
    "laneige-lip-mask":              OOS(),
    "summer-fri-lip-butter":         LOW(2),
    "eltamd-uv-clear":               LOW(3),
    "ordinary-niacinamide":          IN(20),
    "ordinary-ha-serum":             IN(18),
    "nars-natural-radiant":          IN(10),
    "elf-halo-glow":                 IN(14),
    "charlotte-tilbury-flawless":    OOS(),
    "rare-beauty-blush":             LOW(5),
    "mac-studio-fix":                IN(8),
    "mmr-by-fireplace":              OOS(),
    "jo-malone-peony":               OOS(),
  },
  "sep-scarborough": {
    "laneige-lip-mask":              LOW(4),
    "summer-fri-lip-butter":         OOS(),
    "eltamd-uv-clear":               OOS(),
    "ordinary-niacinamide":          IN(18),
    "ordinary-ha-serum":             IN(14),
    "nars-natural-radiant":          LOW(6),
    "elf-halo-glow":                 IN(16),
    "charlotte-tilbury-flawless":    OOS(),
    "rare-beauty-blush":             OOS(),
    "mac-studio-fix":                IN(10),
    "mmr-by-fireplace":              OOS(),
    "jo-malone-peony":               OOS(),
  },
};

export const SHOPPERS_AVAILABILITY: Record<string, Record<string, ItemAvailability>> = {
  "sdm-bloor-yonge": {
    "cerave-hydrating-cleanser":    IN(30),
    "cerave-sa-cleanser":           IN(20),
    "lrp-toleriane-cleanser":       IN(18),
    "ordinary-niacinamide-sdm":     IN(35),
    "ordinary-ha-serum-sdm":        IN(28),
    "cerave-moisturizing-cream":    IN(24),
    "neutrogena-hydro-boost-gel":   IN(22),
    "aveeno-calm-restore":          IN(16),
    "lr-anthelios-spf50":           IN(20),
    "maybelline-fit-me":            IN(30),
    "elf-halo-glow-sdm":            IN(18),
    "marc-jacobs-daisy":            LOW(4),
    "dior-miss-dior":               IN(6),
    "ysl-mon-paris":                IN(5),
    "versace-bright-crystal":       IN(14),
    "calvin-klein-ck-one":          IN(20),
  },
  "sdm-bay-st": {
    "cerave-hydrating-cleanser":    IN(26),
    "cerave-sa-cleanser":           IN(16),
    "lrp-toleriane-cleanser":       IN(14),
    "ordinary-niacinamide-sdm":     IN(28),
    "ordinary-ha-serum-sdm":        LOW(8),
    "cerave-moisturizing-cream":    IN(20),
    "neutrogena-hydro-boost-gel":   IN(18),
    "aveeno-calm-restore":          IN(12),
    "lr-anthelios-spf50":           IN(16),
    "maybelline-fit-me":            IN(24),
    "elf-halo-glow-sdm":            IN(14),
    "marc-jacobs-daisy":            LOW(3),
    "dior-miss-dior":               LOW(3),
    "ysl-mon-paris":                LOW(4),
    "versace-bright-crystal":       IN(12),
    "calvin-klein-ck-one":          IN(16),
  },
  "sdm-college": {
    "cerave-hydrating-cleanser":    IN(22),
    "cerave-sa-cleanser":           LOW(6),
    "lrp-toleriane-cleanser":       LOW(5),
    "ordinary-niacinamide-sdm":     IN(20),
    "ordinary-ha-serum-sdm":        LOW(4),
    "cerave-moisturizing-cream":    IN(18),
    "neutrogena-hydro-boost-gel":   IN(16),
    "aveeno-calm-restore":          IN(10),
    "lr-anthelios-spf50":           IN(14),
    "maybelline-fit-me":            IN(20),
    "elf-halo-glow-sdm":            LOW(6),
    "marc-jacobs-daisy":            OOS(),
    "dior-miss-dior":               LOW(2),
    "ysl-mon-paris":                OOS(),
    "versace-bright-crystal":       IN(10),
    "calvin-klein-ck-one":          IN(14),
  },
  "sdm-queen-west": {
    "cerave-hydrating-cleanser":    IN(20),
    "cerave-sa-cleanser":           OOS(),
    "lrp-toleriane-cleanser":       OOS(),
    "ordinary-niacinamide-sdm":     LOW(8),
    "ordinary-ha-serum-sdm":        OOS(),
    "cerave-moisturizing-cream":    IN(16),
    "neutrogena-hydro-boost-gel":   LOW(6),
    "aveeno-calm-restore":          LOW(4),
    "lr-anthelios-spf50":           IN(12),
    "maybelline-fit-me":            IN(18),
    "elf-halo-glow-sdm":            LOW(4),
    "marc-jacobs-daisy":            OOS(),
    "dior-miss-dior":               OOS(),
    "ysl-mon-paris":                OOS(),
    "versace-bright-crystal":       IN(8),
    "calvin-klein-ck-one":          IN(12),
  },
  "sdm-danforth": {
    "cerave-hydrating-cleanser":    IN(18),
    "cerave-sa-cleanser":           IN(14),
    "lrp-toleriane-cleanser":       IN(10),
    "ordinary-niacinamide-sdm":     IN(16),
    "ordinary-ha-serum-sdm":        OOS(),
    "cerave-moisturizing-cream":    IN(14),
    "neutrogena-hydro-boost-gel":   LOW(6),
    "aveeno-calm-restore":          OOS(),
    "lr-anthelios-spf50":           LOW(5),
    "maybelline-fit-me":            IN(16),
    "elf-halo-glow-sdm":            OOS(),
    "marc-jacobs-daisy":            OOS(),
    "dior-miss-dior":               OOS(),
    "ysl-mon-paris":                LOW(2),
    "versace-bright-crystal":       IN(8),
    "calvin-klein-ck-one":          IN(10),
  },
};

// ── Search helpers ────────────────────────────────────────────────

/** Score a BeautyProduct against query tokens. Returns 0–1. */
export function scoreBeautyProduct(product: BeautyProduct, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const name = product.name.toLowerCase();
  // Split tags into a Set for whole-word matching — prevents "rug" from matching "drugstore",
  // "fragrance" from matching "fragrance-free", etc.
  const tagWords = new Set(product._tags.split(" "));
  const type = product.typeName.toLowerCase();
  const variant = (product.measureText ?? "").toLowerCase();
  const nameWords = name.split(" ");

  let matched = 0;

  for (const token of tokens) {
    if (name.includes(token)) { matched += 1.0; continue; }
    if (tagWords.has(token)) { matched += 0.75; continue; }
    if (type.includes(token) || variant.includes(token)) { matched += 0.5; continue; }
    // Partial prefix match (length ≥ 3 prevents single-char noise)
    if (nameWords.some((w) => w.startsWith(token) && token.length >= 3)) {
      matched += 0.4; continue;
    }
    if ([...tagWords].some((w) => w.startsWith(token) && token.length >= 3)) {
      matched += 0.35;
    }
  }

  return Math.min(1, matched / tokens.length);
}

/** Tokenise a query into lowercase words longer than 2 chars. */
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
