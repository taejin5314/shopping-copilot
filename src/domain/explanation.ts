import type { ExplanationOutput, ExplanationMetadata } from "../core/types.js";
import type { RouterOutput } from "../llm/router.js";
import type { QueryUnderstandingOutput } from "../llm/query-understanding.js";
import type { ProductCandidate } from "./product-finder.js";

// ──────────────────────────────────────────────
// Explanation / response layer — fully deterministic
//
// Converts structured pipeline outputs into a user-facing explanation:
//   - what was found
//   - why the top result ranked where it did
//   - which constraints matched or didn't
//   - what path (Route A / Route B) and grouping mode was used
//   - any remaining warnings or ambiguity
//
// No LLM calls. No probabilistic wording. All output is derived from
// existing structured fields in the pipeline (scores, warnings, flags).
// ──────────────────────────────────────────────

// ── Input ──

export interface ExplanationInput {
  /** Raw user query (for summary wording). */
  query: string;
  /** Router output — absent in Route B. */
  routerOutput?: RouterOutput;
  /** QU output — absent in Route B. */
  queryUnderstandingOutput?: QueryUnderstandingOutput;
  /** Scored Product Finder candidates — absent in Route B. */
  finderCandidates?: ProductCandidate[];
  /**
   * Auto-rank context from buildAutoRankCart.
   * false / absent = Route B or single-product discovery (topVariantGroup applied).
   */
  variantGroupingApplied?: boolean;
  /** "finderCandidates" for Route A, "foundProducts" for Route B. */
  inputSource?: "finderCandidates" | "foundProducts";
  /** true when QU flagged itemCardinality="multiple". */
  isCartIntent?: boolean;
  /** All pipeline warnings accumulated so far. */
  pipelineWarnings?: string[];
  /**
   * Total products found — used for summary and candidateCount when
   * finderCandidates is absent (Route B: foundProducts path).
   */
  foundProductCount?: number;
}

// Re-export output types for callers who only import from this module.
export type { ExplanationOutput, ExplanationMetadata } from "../core/types.js";

// ── Main entry point ──

/**
 * Build a deterministic explanation from pipeline outputs.
 * Never throws — returns a best-effort explanation even with partial inputs.
 */
export function buildExplanation(input: ExplanationInput): ExplanationOutput {
  const { finderCandidates, queryUnderstandingOutput: qu, routerOutput: ro } = input;
  const topCandidate = finderCandidates?.[0];
  const points: string[] = [];
  const warnings: string[] = [];

  // 1. Retailer scope — always first if the search was narrowed
  const scopePoint = buildScopePoint(ro);
  if (scopePoint) points.push(scopePoint);

  // 2. Route / fallback path — surface when it's the less-capable path
  const routePoint = buildRoutePoint(input.inputSource);
  if (routePoint) points.push(routePoint);

  // 3. Top candidate quality — score, keywords, budget, attribute match/miss
  if (topCandidate) {
    // Keyword match
    if (topCandidate.matchedFromKeywords.length > 0) {
      const kws = topCandidate.matchedFromKeywords.slice(0, 3).join(", ");
      points.push(`Keyword${topCandidate.matchedFromKeywords.length > 1 ? "s" : ""} matched: ${kws}.`);
    }

    // Attribute hits and misses
    const { matched, missed } = computeAttributeMatch(topCandidate, qu);
    if (matched.length > 0) {
      points.push(`Attribute${matched.length > 1 ? "s" : ""} matched: ${matched.join(", ")}.`);
    }
    if (missed.length > 0) {
      points.push(`Attribute${missed.length > 1 ? "s" : ""} not found: ${missed.join(", ")}.`);
    }

    // Budget
    const budgetPoint = buildBudgetPoint(topCandidate, qu);
    if (budgetPoint) points.push(budgetPoint);
  }

  // 4. Variant grouping / cart-intent mode
  const variantPoint = buildVariantPoint(input.variantGroupingApplied, input.isCartIntent);
  if (variantPoint) points.push(variantPoint);

  // 5. Router confidence warning (separate from points — this is a concern, not an explanation)
  if (ro && ro.confidence < 0.7) {
    warnings.push(
      `Query classification confidence was low (${Math.round(ro.confidence * 100)}%) — ` +
      "results may not fully match your intent.",
    );
  }

  const budgetStatus = computeBudgetStatus(topCandidate, qu?.budgetMax ?? null);
  const { matched: topMatched, missed: topMissed } = topCandidate
    ? computeAttributeMatch(topCandidate, qu)
    : { matched: [], missed: [] };

  const metadata: ExplanationMetadata = {
    retailerScope: ro?.retailerScope ?? null,
    routerConfidence: ro?.confidence ?? null,
    topCandidateScore: topCandidate?.matchScore ?? null,
    budgetStatus,
    attributesMatched: topMatched,
    attributesMissed: topMissed,
    variantGroupingApplied: input.variantGroupingApplied ?? false,
    inputSource: input.inputSource ?? null,
    fallbackUsed: input.inputSource === "foundProducts",
    candidateCount: finderCandidates?.length ?? input.foundProductCount ?? 0,
  };

  return {
    summary: buildSummary(input),
    explanationPoints: points,
    warnings,
    metadata,
  };
}

// ── Internal helpers ──

/** One-sentence summary of what was found. */
function buildSummary(input: ExplanationInput): string {
  const { finderCandidates, queryUnderstandingOutput: qu, routerOutput: ro } = input;
  const count = finderCandidates?.length ?? input.foundProductCount ?? 0;
  if (count === 0) return "No matching products were found.";

  // Prefer QU category; fall back to top candidate's typeName; final fallback "product"
  const category = qu?.category
    ? qu.category
    : (finderCandidates?.[0]?.typeName ?? "product");

  const retailerTag = ro?.retailerScope && ro.retailerScope !== "all" && ro.retailerScope !== "unknown"
    ? ` at ${ro.retailerScope}`
    : "";

  const noun = count === 1 ? category : `${category}s`;
  return `Found ${count} ${noun}${retailerTag} matching your search.`;
}

/** Explain retailer scoping — only emitted when the search was explicitly narrowed. */
function buildScopePoint(routerOutput?: RouterOutput): string | null {
  if (!routerOutput) return null;
  const { retailerScope } = routerOutput;
  if (!retailerScope || retailerScope === "all" || retailerScope === "unknown") return null;
  return `Search was limited to ${retailerScope}.`;
}

/** Explain Route B fallback — only emitted when attribute scoring was unavailable. */
function buildRoutePoint(
  inputSource?: "finderCandidates" | "foundProducts",
): string | null {
  if (inputSource === "foundProducts") {
    return "Results are from a basic keyword search (attribute filtering was not available for this query).";
  }
  return null;
}

/** Explain budget alignment for the top candidate. */
function buildBudgetPoint(
  candidate: ProductCandidate,
  qu?: QueryUnderstandingOutput,
): string | null {
  if (!qu?.budgetMax || candidate.price === null) return null;
  const price = candidate.price;
  const budget = qu.budgetMax;
  if (price > budget * 1.5) {
    return `Top result ($${price}) significantly exceeds your budget of $${budget}.`;
  }
  if (price > budget) {
    return `Top result ($${price}) is slightly over your budget of $${budget}.`;
  }
  return `Top result ($${price}) is within your budget of $${budget}.`;
}

/**
 * Explain how variant grouping or cart-intent mode affected the result set.
 * Only emits a point when there is something non-obvious to surface.
 */
function buildVariantPoint(
  variantGroupingApplied?: boolean,
  isCartIntent?: boolean,
): string | null {
  if (variantGroupingApplied) {
    return "All available designs/colors for the best-matched product are included for store comparison.";
  }
  if (isCartIntent) {
    return "Your requested items are kept as separate entries for individual store availability checking.";
  }
  return null;
}

/**
 * Determine which QU attributes are present or absent in the candidate's text.
 * Replicates the same text-matching strategy used by scoreCandidate in product-finder.ts,
 * but only for explanation purposes — does not re-score.
 */
function computeAttributeMatch(
  candidate: ProductCandidate,
  qu?: QueryUnderstandingOutput,
): { matched: string[]; missed: string[] } {
  if (!qu) return { matched: [], missed: [] };

  const productText = [candidate.name, candidate.typeName, candidate.designText, candidate.measureText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matched: string[] = [];
  const missed: string[] = [];

  for (const [value, label] of [
    [qu.color, "color"],
    [qu.material, "material"],
    [qu.size, "size"],
    [qu.style, "style"],
  ] as [string | null, string][]) {
    if (!value) continue;
    if (productText.includes(value.toLowerCase())) {
      matched.push(`${label} "${value}"`);
    } else {
      missed.push(`${label} "${value}"`);
    }
  }

  return { matched, missed };
}

/** Classify budget alignment for metadata. */
function computeBudgetStatus(
  candidate: ProductCandidate | undefined,
  budgetMax: number | null,
): ExplanationMetadata["budgetStatus"] {
  if (!budgetMax || !candidate) return null;
  if (candidate.price === null) return "unknown";
  if (candidate.price > budgetMax * 1.5) return "way_exceeded";
  if (candidate.price > budgetMax) return "exceeded";
  return "within";
}
