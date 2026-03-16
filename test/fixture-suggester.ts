/**
 * Fixture suggestion / regression seed generator.
 *
 * Consumes ReviewResult[] from the quality review tool and produces typed
 * FixtureSuggestion objects that can be rendered as copy-paste EvalFixture snippets.
 *
 * Design goals:
 *   - Conservative — partial suggestions are better than overconfident ones.
 *   - Pure / offline — no LLM, no network, no adapters.
 *   - Composable — generateFixtureSuggestions / renderFixtureSuggestion /
 *     buildSuggestionSummary can each be called independently.
 *
 * Usage:
 *   const suggestions = generateFixtureSuggestions(reviewResults);
 *   for (const s of suggestions) console.log(renderFixtureSuggestion(s));
 *   const summary = buildSuggestionSummary(suggestions);
 */

import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ReviewResult, ReviewFinding } from "./quality-review.js";
import type { EvalFixture } from "./eval-runner.js";

// ── Suggestion model ──

/**
 * Partial EvalFixture expectations that can be safely proposed from review findings.
 * Only populated when there is sufficient evidence — absent fields mean "not enough
 * information to make a safe assertion".
 */
export type ProposedExpectations = Partial<
  Pick<
    EvalFixture,
    | "expectedRouterIntent"
    | "expectedRetailerScope"
    | "expectedQUFields"
    | "expectedCandidateCountMin"
    | "expectedCandidateCountMax"
    | "expectedWarningsContain"
    | "expectedExplanationPointsContain"
  >
>;

export type SuggestionConfidence = "low" | "medium" | "high";

export interface FixtureSuggestion {
  /** Slug-style name suitable for use as a TypeScript constant name. */
  name: string;
  /** The raw user query from the review input. */
  query: string;
  /** Coarse categories of findings that drove this suggestion (e.g. ["finder", "qu"]). */
  reasonCategories: string[];
  /** The specific findings that triggered this suggestion. */
  sourceFindings: ReviewFinding[];
  /**
   * Partial expectations that are safe to assert given the evidence.
   * Conservative: fields with insufficient evidence are omitted entirely.
   */
  proposedExpectations: ProposedExpectations;
  /**
   * Confidence that the proposed expectations will reproduce and are correct.
   * - "high": clean signal, ≥0.8 router confidence, QU present, no failures
   * - "medium": meaningful signal but some uncertainty (e.g. zero-candidate failure)
   * - "low": failures or conflicting signals — needs human review before committing
   */
  confidence: SuggestionConfidence;
  /**
   * True when the suggestion requires human judgment before it can be committed
   * as a regression fixture (e.g. structural failures, ambiguous signals).
   */
  needsManualReview: boolean;
}

// ── Summary model ──

export interface SuggestionSummary {
  total: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  needingManualReview: number;
  /** Reason categories sorted by frequency descending. */
  topReasonCategories: Array<{ category: string; count: number }>;
}

// ── Thresholds ──

const ROUTER_HIGH_CONFIDENCE_THRESHOLD = 0.8;

// ── Core generator ──

/**
 * Generate fixture suggestions from a batch of review results.
 * Returns at most one suggestion per query — if multiple findings trigger
 * suggestions for the same query, they are merged into the highest-confidence one.
 *
 * Never throws — malformed inputs produce no suggestions.
 */
export function generateFixtureSuggestions(results: ReviewResult[]): FixtureSuggestion[] {
  const suggestions: FixtureSuggestion[] = [];

  for (const result of results) {
    try {
      const suggestion = _suggestForResult(result);
      if (suggestion) suggestions.push(suggestion);
    } catch {
      // Defensive: malformed input should never crash the generator
    }
  }

  return suggestions;
}

function _suggestForResult(result: ReviewResult): FixtureSuggestion | null {
  const { input, findings } = result;

  // Only suggest fixtures for queries that have something interesting to assert.
  // Queries with no findings at all don't need a new fixture.
  if (findings.length === 0) return null;

  const sourceFindings = findings.slice(); // copy
  const reasonCategories = [...new Set(sourceFindings.map((f) => f.category))];
  const proposed: ProposedExpectations = {};

  // ── Determine overall shape ──

  const hasFail = result.hasFailures;
  const failChecks = sourceFindings.filter((f) => f.severity === "fail").map((f) => f.check);
  const warnChecks = sourceFindings.filter((f) => f.severity === "warn").map((f) => f.check);

  // ── Router expectations ──
  // Only propose intent when router was present, succeeded, and confidence is high.
  const ro = input.routerOutput ?? null;
  if (
    ro !== null &&
    !failChecks.includes("router:failed") &&
    ro.confidence >= ROUTER_HIGH_CONFIDENCE_THRESHOLD
  ) {
    proposed.expectedRouterIntent = ro.intent;

    // Only propose retailerScope when both router AND QU agree on a specific retailer.
    const qu = input.queryUnderstandingOutput ?? null;
    const routerSpecific =
      ro.retailerScope !== "all" && ro.retailerScope !== "unknown";
    const quSpecific =
      qu !== null &&
      qu.retailerPreference !== "all" &&
      qu.retailerPreference !== "unknown";

    if (routerSpecific && (!quSpecific || qu?.retailerPreference === ro.retailerScope)) {
      proposed.expectedRetailerScope = ro.retailerScope;
    }
  }

  // ── QU expectations ──
  // Only propose QU fields when QU succeeded and produced meaningful output.
  const qu = input.queryUnderstandingOutput ?? null;
  if (qu !== null && !failChecks.includes("qu:failed") && !failChecks.includes("qu:empty-keywords")) {
    const quFields: ProposedExpectations["expectedQUFields"] = {};
    let anyQUField = false;

    if (qu.category && qu.category.trim() !== "") {
      quFields.category = qu.category;
      anyQUField = true;
    }
    if (typeof qu.budgetMax === "number" || qu.budgetMax === null) {
      quFields.budgetMax = qu.budgetMax;
      anyQUField = true;
    }
    if (qu.itemCardinality !== undefined) {
      quFields.itemCardinality = qu.itemCardinality;
      anyQUField = true;
    }
    if (anyQUField) proposed.expectedQUFields = quFields;
  }

  // ── Finder expectations ──
  // Propose expectedCandidateCountMin: 1 when zero-candidate failure was found.
  // This documents the regression: "this query should produce at least one result."
  if (failChecks.includes("finder:zero-candidates")) {
    proposed.expectedCandidateCountMin = 1;
  }

  // ── Path / structural issues ──
  // cart-intent-narrowed and missing explanation are structural failures.
  // We cannot safely propose expectations without knowing the correct mock setup.
  // These are flagged but expectations are left empty (needsManualReview = true).

  // ── Confidence assessment ──
  let confidence: SuggestionConfidence;
  let needsManualReview: boolean;

  if (hasFail) {
    // Any failure → low or medium depending on whether it's a recoverable data issue.
    const isDataFailure =
      failChecks.includes("finder:zero-candidates") ||
      failChecks.includes("qu:empty-keywords");
    confidence = isDataFailure ? "medium" : "low";
    needsManualReview = true;
  } else if (warnChecks.includes("router:low-confidence")) {
    // Low-confidence router — uncertain intent, can't safely assert.
    confidence = "low";
    needsManualReview = true;
  } else if (warnChecks.includes("warnings:excessive")) {
    // Many accumulated warnings — likely systemic issue, not a clean fixture scenario.
    confidence = "low";
    needsManualReview = true;
  } else if (ro !== null && ro.confidence >= ROUTER_HIGH_CONFIDENCE_THRESHOLD && qu !== null) {
    // Good signals on both router and QU, no failures.
    confidence = "high";
    needsManualReview = false;
  } else {
    // Partial signals or only info findings.
    confidence = "medium";
    needsManualReview = warnChecks.length > 0;
  }

  // Don't emit a suggestion with no useful expectations unless it needs manual review.
  const hasAnyExpectation = Object.keys(proposed).length > 0;
  if (!hasAnyExpectation && !needsManualReview) return null;

  return {
    name: _slugify(input.query),
    query: input.query,
    reasonCategories,
    sourceFindings,
    proposedExpectations: proposed,
    confidence,
    needsManualReview,
  };
}

// ── TypeScript renderer ──

/**
 * Render a FixtureSuggestion as a copy-paste-friendly TypeScript EvalFixture snippet.
 * The output is a valid TypeScript object literal with TODO comments for fields that
 * require manual completion (mock inputs, etc.).
 *
 * Output is deterministic: same input always produces the same string.
 */
export function renderFixtureSuggestion(suggestion: FixtureSuggestion): string {
  const constName = `FIXTURE_${suggestion.name.toUpperCase().replace(/-/g, "_")}`;
  const lines: string[] = [];

  lines.push(`// Suggested fixture: ${suggestion.name}`);
  lines.push(`// Reason: ${suggestion.reasonCategories.join(", ")}`);
  lines.push(`// Confidence: ${suggestion.confidence} | Needs manual review: ${suggestion.needsManualReview}`);
  if (suggestion.needsManualReview) {
    lines.push(`// TODO: review findings before committing as a regression fixture`);
  }
  lines.push(`export const ${constName}: EvalFixture = {`);
  lines.push(`  name: ${JSON.stringify(suggestion.name)},`);
  lines.push(`  query: ${JSON.stringify(suggestion.query)},`);

  // Mock input TODOs
  lines.push(`  // TODO: add mockRouterOutput if router was used in this run`);
  lines.push(`  // TODO: add mockQUOutput if QU was used in this run`);
  lines.push(`  // TODO: add mockProducts with realistic products for this query`);

  // Proposed expectations
  const pe = suggestion.proposedExpectations;

  if (pe.expectedRouterIntent !== undefined) {
    lines.push(`  expectedRouterIntent: ${JSON.stringify(pe.expectedRouterIntent)},`);
  }
  if (pe.expectedRetailerScope !== undefined) {
    lines.push(`  expectedRetailerScope: ${JSON.stringify(pe.expectedRetailerScope)},`);
  }
  if (pe.expectedQUFields !== undefined) {
    lines.push(`  expectedQUFields: ${JSON.stringify(pe.expectedQUFields, null, 2).split("\n").join("\n  ")},`);
  }
  if (pe.expectedCandidateCountMin !== undefined) {
    lines.push(`  expectedCandidateCountMin: ${pe.expectedCandidateCountMin},`);
  }
  if (pe.expectedCandidateCountMax !== undefined) {
    lines.push(`  expectedCandidateCountMax: ${pe.expectedCandidateCountMax},`);
  }
  if (pe.expectedWarningsContain !== undefined && pe.expectedWarningsContain.length > 0) {
    lines.push(`  expectedWarningsContain: ${JSON.stringify(pe.expectedWarningsContain)},`);
  }
  if (
    pe.expectedExplanationPointsContain !== undefined &&
    pe.expectedExplanationPointsContain.length > 0
  ) {
    lines.push(`  expectedExplanationPointsContain: ${JSON.stringify(pe.expectedExplanationPointsContain)},`);
  }

  lines.push(`};`);
  return lines.join("\n");
}

// ── Summary builder ──

export function buildSuggestionSummary(suggestions: FixtureSuggestion[]): SuggestionSummary {
  const catCounts = new Map<string, number>();
  for (const s of suggestions) {
    for (const cat of s.reasonCategories) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
  }
  const topReasonCategories = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: suggestions.length,
    highConfidence: suggestions.filter((s) => s.confidence === "high").length,
    mediumConfidence: suggestions.filter((s) => s.confidence === "medium").length,
    lowConfidence: suggestions.filter((s) => s.confidence === "low").length,
    needingManualReview: suggestions.filter((s) => s.needsManualReview).length,
    topReasonCategories,
  };
}

// ── Internal helpers ──

/**
 * Convert a free-form query string to a slug suitable for TypeScript constant names.
 * Lowercase, non-alphanumeric runs replaced with hyphens, max 50 chars.
 */
function _slugify(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
