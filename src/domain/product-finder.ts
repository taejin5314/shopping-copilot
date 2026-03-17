import { z } from "zod";
import type { RetailerAdapter } from "../core/adapter.js";
import type { ProductInfo } from "../core/types.js";
import type { RouterOutput } from "../llm/router.js";
import type { QueryUnderstandingOutput } from "../llm/query-understanding.js";

// ──────────────────────────────────────────────
// Product Finder — fan-out to retailer adapters, normalize and score candidates
//
// Responsibilities:
//   - Build a search query from QU output (or raw query fallback)
//   - Fan out to relevant retailer adapters (respects retailerScope)
//   - Normalize ProductInfo → ProductCandidate with attribute match scoring
//   - Deduplicate by retailer+itemNo
//   - Warn when match is weak or results are mixed-type
//
// Non-responsibilities (handled downstream):
//   - Checking store inventory
//   - Ranking stores
//   - Generating user-facing prose
// ──────────────────────────────────────────────

// ── Schema ──

export const ProductCandidateSchema = z.object({
  /** Retailer identifier (e.g. "ikea", "structube"). */
  retailer: z.string(),
  /** Primary product identifier — always set (same as itemNo for current retailers). */
  productId: z.string(),
  /** Variant descriptor from the retailer (e.g. "Dark blue", "Beige"). Null when no design variant. */
  variantId: z.string().nullable(),
  /** Item / SKU number — used for cart and inventory lookups. */
  itemNo: z.string().nullable(),
  name: z.string(),
  typeName: z.string(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /** 0–1 match score computed against QU attributes (budget, color, material, size, style). */
  matchScore: z.number().min(0).max(1),
  /** Which QU keywords were found in the product name / description. */
  matchedFromKeywords: z.array(z.string()),
  /** Per-candidate warnings (e.g. over budget, weak attribute match). */
  warnings: z.array(z.string()),
  /** Variant size/dimension text (e.g. "90x200 cm"). Null if not provided. */
  measureText: z.string().nullable(),
  /** Variant color/design text forwarded from ProductInfo. */
  designText: z.string().nullable(),
});

export type ProductCandidate = z.infer<typeof ProductCandidateSchema>;

// ── Input / output ──

export interface ProductFinderInput {
  rawQuery: string;
  /** Routing decision from the Router Agent (optional). */
  routerOutput?: RouterOutput;
  /** Structured shopping fields from the Query Understanding Agent (optional). */
  quOutput?: QueryUnderstandingOutput;
  /**
   * Which retailers to search.
   * If a specific retailer ("ikea" | "structube"), only query matching adapters.
   * "all" / "unknown" / undefined → query all provided adapters.
   */
  retailerScope?: string;
}

export interface ProductFinderOpts {
  maxResults?: number;
  countryCode?: string;
}

export interface ProductFinderResult {
  candidates: ProductCandidate[];
  /** The search query that was actually sent to the retailer adapter(s). */
  searchQuery: string;
  warnings: string[];
}

// ── Structured logging ──

function pfLog(fields: Record<string, unknown>): void {
  console.error("[product-finder]", JSON.stringify(fields));
}

// ── Scoring constants ──

const BASE_SCORE = 0.8;
const ATTRIBUTE_HIT_BONUS = 0.05;
const ATTRIBUTE_MISS_PENALTY = 0.15;
const KEYWORD_MISS_PENALTY = 0.10; // per unmatched keyword
const BUDGET_OVER_PENALTY = 0.25;
const BUDGET_WAY_OVER_PENALTY = 0.50;
const WEAK_MATCH_THRESHOLD = 0.5;
/** Candidates below this score are filtered out entirely (wrong product type). */
const MIN_SCORE_THRESHOLD = 0.4;

// ── Main function ──

/**
 * Fan-out to relevant retailer adapters, normalize results into scored ProductCandidates.
 * Never throws — errors per-adapter are captured as warnings.
 */
export async function findProducts(
  input: ProductFinderInput,
  adapters: RetailerAdapter[],
  opts?: ProductFinderOpts,
): Promise<ProductFinderResult> {
  const { rawQuery, routerOutput, quOutput, retailerScope } = input;
  const maxResults = opts?.maxResults ?? 5;
  const countryCode = opts?.countryCode;

  const searchQuery = buildSearchQuery(rawQuery, quOutput);
  const warnings: string[] = [];

  // Scope adapters to the requested retailer if a specific one was named.
  const scopedAdapters = scopeAdapters(adapters, retailerScope);
  if (scopedAdapters.length === 0) {
    warnings.push(`No adapters available for retailerScope "${retailerScope ?? "all"}". Falling back to all adapters.`);
  }
  const targetAdapters = scopedAdapters.length > 0 ? scopedAdapters : adapters;

  pfLog({
    event: "search_started",
    searchQuery,
    adapterCount: targetAdapters.length,
    retailerScope: retailerScope ?? "all",
    itemCardinality: quOutput?.itemCardinality ?? null,
    routerIntent: routerOutput?.intent ?? null,
  });

  // Multi-item warning — results may span multiple product types.
  if (quOutput?.itemCardinality === "multiple") {
    warnings.push(
      "Query references multiple product types — results may contain mixed categories. " +
      "Use separate queries per item for precise inventory lookup.",
    );
  }

  // Fan out to adapters in parallel.
  const perAdapterResults = await Promise.all(
    targetAdapters.map(async (adapter) => {
      try {
        const products = await adapter.searchProducts(searchQuery, { maxResults, countryCode });
        return { retailer: adapter.retailerId, products, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { retailer: adapter.retailerId, products: [] as ProductInfo[], error: msg };
      }
    }),
  );

  for (const { retailer, error } of perAdapterResults) {
    if (error) warnings.push(`Product search failed for ${retailer}: ${error}`);
  }

  // Normalize and score all results.
  const raw: ProductCandidate[] = perAdapterResults.flatMap(({ retailer, products }) =>
    products.map((p) => normalizeFromProductInfo(p, retailer, quOutput)),
  );
  const rawCount = raw.length;

  // Deduplicate identical retailer+itemNo (keeps highest-scored copy).
  const candidates = deduplicateByItemNo(raw);
  const dedupRemoved = rawCount - candidates.length;

  // Filter out candidates that clearly don't match the query.
  const filtered = candidates.filter((c) => c.matchScore >= MIN_SCORE_THRESHOLD);
  const filterRemoved = candidates.length - filtered.length;
  candidates.length = 0;
  candidates.push(...filtered);

  // Sort by score descending.
  candidates.sort((a, b) => b.matchScore - a.matchScore);

  // Warn when the overall result set is weak.
  if (candidates.length > 0 && candidates.every((c) => c.matchScore < WEAK_MATCH_THRESHOLD)) {
    warnings.push(
      "All product candidates have a low match score. " +
      "The query may be too vague or no products closely match the specified attributes.",
    );
  }

  const scoreHigh = candidates.filter((c) => c.matchScore >= 0.8).length;
  const scoreMid = candidates.filter((c) => c.matchScore >= 0.5 && c.matchScore < 0.8).length;
  const scoreLow = candidates.filter((c) => c.matchScore < 0.5).length;

  pfLog({
    event: "search_done",
    searchQuery,
    rawCount,
    candidateCount: candidates.length,
    dedupRemoved,
    filterRemoved,
    scoreHigh,
    scoreMid,
    scoreLow,
    warningCount: warnings.length,
  });

  return { candidates: candidates.slice(0, maxResults * targetAdapters.length), searchQuery, warnings };
}

// ── candidateToProductInfo ──

/**
 * Convert a ProductCandidate back to ProductInfo for orchestrator compatibility.
 * The orchestrator's citation builder, auto-rank, and synthesizer all consume ProductInfo.
 */
export function candidateToProductInfo(c: ProductCandidate): ProductInfo {
  return {
    retailer: c.retailer,
    itemNo: c.itemNo ?? c.productId,
    name: c.name,
    typeName: c.typeName,
    price: c.price !== null && c.currency ? { amount: c.price, currency: c.currency } : null,
    url: c.url,
    measureText: c.measureText,
    designText: c.designText,
    imageUrl: c.imageUrl,
  };
}

// ── buildSearchQuery (exported for testing) ──

/**
 * Build the best search query from QU output, falling back to rawQuery.
 *
 * Strategy:
 *   1. Use QU keywords (already stripped of filler, budget phrases, location).
 *   2. If category is non-empty and not already present in keywords, prepend it.
 *   3. Cap at 5 terms to avoid overly long queries that confuse retail search APIs.
 *   4. Fall back to rawQuery when QU is absent or has no keywords.
 */
export function buildSearchQuery(rawQuery: string, quOutput: QueryUnderstandingOutput | undefined): string {
  if (!quOutput || quOutput.keywords.length === 0) return rawQuery;

  const terms: string[] = [];
  const lowerKeywords = quOutput.keywords.map((k) => k.toLowerCase());

  // Prepend category if it adds information not already in keywords.
  if (
    quOutput.category &&
    !lowerKeywords.some((k) => k.includes(quOutput.category.toLowerCase()) || quOutput.category.toLowerCase().includes(k))
  ) {
    terms.push(quOutput.category);
  }

  terms.push(...quOutput.keywords);
  return terms.slice(0, 5).join(" ");
}

// ── Internal helpers ──

function scopeAdapters(adapters: RetailerAdapter[], retailerScope: string | undefined): RetailerAdapter[] {
  if (!retailerScope || retailerScope === "all" || retailerScope === "unknown") return adapters;
  return adapters.filter((a) => a.retailerId === retailerScope);
}

function normalizeFromProductInfo(
  product: ProductInfo,
  retailer: string,
  quOutput: QueryUnderstandingOutput | undefined,
): ProductCandidate {
  const candidateWarnings: string[] = [];
  const { score, matchedKws } = scoreCandidate(product, quOutput, candidateWarnings);

  return {
    retailer,
    productId: product.itemNo,
    variantId: product.designText ?? null,
    itemNo: product.itemNo,
    name: product.name,
    typeName: product.typeName,
    price: product.price?.amount ?? null,
    currency: product.price?.currency ?? null,
    url: product.url,
    imageUrl: product.imageUrl ?? null,
    matchScore: score,
    matchedFromKeywords: matchedKws,
    warnings: candidateWarnings,
    measureText: product.measureText,
    designText: product.designText ?? null,
  };
}

/**
 * Score a ProductInfo against the QU attributes.
 *
 * Algorithm:
 *   Start at BASE_SCORE (0.8) — raw search results are expected to be topically relevant.
 *   For each specified attribute (color, material, size, style):
 *     - Found in combined product text → +ATTRIBUTE_HIT_BONUS
 *     - Not found → -ATTRIBUTE_MISS_PENALTY
 *   If budgetMax specified:
 *     - price > budgetMax × 1.5 → -BUDGET_WAY_OVER_PENALTY  (clearly over)
 *     - price > budgetMax        → -BUDGET_OVER_PENALTY      (marginally over)
 *   Clamped to [0, 1].
 */
function scoreCandidate(
  product: ProductInfo,
  quOutput: QueryUnderstandingOutput | undefined,
  candidateWarnings: string[],
): { score: number; matchedKws: string[] } {
  let score = BASE_SCORE;

  // Build a single search-friendly text string from all product fields.
  const productText = [product.name, product.typeName, product.designText, product.measureText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Keyword matching.
  const keywords = quOutput?.keywords ?? [];
  const matchedKws = keywords.filter((kw) => productText.includes(kw.toLowerCase()));

  if (!quOutput) return { score, matchedKws };

  // Keyword miss penalty: each unmatched keyword lowers the score.
  // Catches wrong product types (e.g. "desk lamp" when searching "white desk").
  const missCount = keywords.length - matchedKws.length;
  if (missCount > 0) score -= missCount * KEYWORD_MISS_PENALTY;

  // Attribute scoring.
  const attributes: Array<[string | null, string]> = [
    [quOutput.color, "color"],
    [quOutput.material, "material"],
    [quOutput.size, "size"],
    [quOutput.style, "style"],
  ];
  for (const [value, label] of attributes) {
    if (!value) continue; // attribute not specified — no penalty
    if (productText.includes(value.toLowerCase())) {
      score += ATTRIBUTE_HIT_BONUS;
    } else {
      score -= ATTRIBUTE_MISS_PENALTY;
      candidateWarnings.push(`Requested ${label} "${value}" not found in product description.`);
    }
  }

  // Budget scoring.
  const price = product.price?.amount ?? null;
  if (quOutput.budgetMax !== null && price !== null) {
    if (price > quOutput.budgetMax * 1.5) {
      score -= BUDGET_WAY_OVER_PENALTY;
      candidateWarnings.push(`Price $${price} significantly exceeds budget of $${quOutput.budgetMax}.`);
    } else if (price > quOutput.budgetMax) {
      score -= BUDGET_OVER_PENALTY;
      candidateWarnings.push(`Price $${price} exceeds budget of $${quOutput.budgetMax}.`);
    }
  }

  // Weak match flag.
  const finalScore = Math.min(1, Math.max(0, score));
  if (finalScore < WEAK_MATCH_THRESHOLD) {
    candidateWarnings.push("Weak attribute match — verify this product meets your requirements.");
  }

  return { score: finalScore, matchedKws };
}

/** Deduplicate by retailer+itemNo, keeping the entry with the highest matchScore. */
function deduplicateByItemNo(candidates: ProductCandidate[]): ProductCandidate[] {
  const seen = new Map<string, ProductCandidate>();
  for (const c of candidates) {
    const key = `${c.retailer}:${c.itemNo ?? c.productId}`;
    const existing = seen.get(key);
    if (!existing || c.matchScore > existing.matchScore) {
      seen.set(key, c);
    }
  }
  return [...seen.values()];
}
