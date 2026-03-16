/**
 * Offline quality review tool for captured pipeline outputs.
 *
 * Accepts structured snapshots of real or simulated pipeline runs and produces
 * deterministic heuristic findings: quality issues, path anomalies, and
 * suggestions for which queries should become regression fixtures.
 *
 * Design goals:
 *   - Offline only — no LLM, no network, no adapters.
 *   - Tolerant of partial inputs — every field is optional except query.
 *   - Composable — reviewSingleInput / runQualityReview / buildReviewSummary
 *     can each be called independently.
 *   - Grep-friendly logs via logReviewFindings.
 *
 * Usage:
 *   const { results, summary } = runQualityReview(capturedOutputs);
 *   logReviewFindings(results);
 *   if (summary.queriesWithFailures > 0) { ... }
 */

import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ExplanationOutput } from "../src/domain/explanation.js";
import type { RankingSnapshot } from "../src/capture/capture-record.js";

// ── Input model ──

/**
 * A captured snapshot of one pipeline run.
 * Every field except `query` is optional — the heuristics degrade gracefully
 * when stages are absent or failed.
 */
export interface PipelineReviewInput {
  /** Optional identifier (session ID, log line number, etc.) for tracing. */
  id?: string;
  /** ISO timestamp or human-readable label, for sorting/grouping. */
  timestamp?: string;
  /** The raw user query string. Required — everything else is optional. */
  query: string;
  /**
   * Router output, or null when router was invoked but failed.
   * Absent = router was not part of this run.
   */
  routerOutput?: RouterOutput | null;
  /** True when the router was invoked (even if it returned null). */
  routerUsed?: boolean;
  /**
   * Query Understanding output, or null when QU was invoked but failed.
   * Absent = QU was not part of this run.
   */
  queryUnderstandingOutput?: QueryUnderstandingOutput | null;
  /** True when QU was invoked (even if it returned null). */
  quUsed?: boolean;
  /** Number of Product Finder candidates returned (0 = none found; absent = not run). */
  finderCandidateCount?: number;
  /** Match score of the top-ranked candidate, 0–1. Null or absent = no candidates. */
  topCandidateScore?: number | null;
  /** Explanation output from buildExplanation. Null = was invoked but returned nothing. */
  explanation?: ExplanationOutput | null;
  /** Which data source drove the inventory lookup (Route A vs Route B). */
  inputSource?: "finderCandidates" | "foundProducts" | null;
  /** Whether QU flagged this as a multi-product cart intent. */
  isCartIntent?: boolean;
  /** All accumulated warnings from all pipeline stages. */
  warnings?: string[];
  /** Optional short summary of the final synthesized answer, for display only. */
  finalAnswerSummary?: string;
  /**
   * Store-ranking snapshot captured by the orchestrator.
   * Present only when a ranking path ran and CaptureRecord had rankingSnapshot set.
   * Used by extractScenariosFromCaptures() to produce offline golden scenarios.
   */
  rankingSnapshot?: RankingSnapshot;
}

// ── Finding model ──

export type ReviewSeverity = "info" | "warn" | "fail";

export interface ReviewFinding {
  severity: ReviewSeverity;
  /** Coarse grouping for summary aggregation (e.g. "router", "qu", "finder"). */
  category: string;
  /** Specific heuristic name within the category (e.g. "router:low-confidence"). */
  check: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ── Review result (per input) ──

export interface ReviewResult {
  input: PipelineReviewInput;
  findings: ReviewFinding[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

// ── Review summary (across a batch) ──

export interface ReviewSummary {
  totalReviewed: number;
  totalFindings: number;
  queriesWithFailures: number;
  queriesWithWarnings: number;
  /** Fraction of inputs that used Route B (foundProducts path). 0–1. */
  fallbackRate: number;
  /** Top finding categories sorted by count descending. */
  topCategories: Array<{ category: string; count: number }>;
  /**
   * Warnings that appeared in more than one input (recurring across queries).
   * Sorted by count descending.
   */
  commonWarnings: Array<{ warning: string; count: number }>;
  /**
   * Queries recommended for promotion to regression fixtures.
   * Criteria: at least one "fail" finding, or ≥ 2 "warn" findings.
   */
  suggestedFixtureCandidates: string[];
}

// ────────────────────────────────────────────────
// Core heuristics
// ────────────────────────────────────────────────

const ROUTER_LOW_CONFIDENCE_THRESHOLD = 0.7;
const WEAK_SCORE_THRESHOLD = 0.5;
const EXCESSIVE_WARNINGS_THRESHOLD = 5;

/**
 * Run all heuristics against a single pipeline input.
 * Never throws — malformed inputs are handled gracefully.
 */
export function reviewSingleInput(input: PipelineReviewInput): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // ── Router heuristics ──

  if (input.routerUsed === true && input.routerOutput == null) {
    findings.push(mkWarn("router", "router:failed",
      "Router was invoked but returned null — LLM call failed, fell back to pattern classifier"));
  }

  if (input.routerOutput != null) {
    const ro = input.routerOutput;

    if (ro.confidence < ROUTER_LOW_CONFIDENCE_THRESHOLD) {
      findings.push(mkWarn("router", "router:low-confidence",
        `Router confidence is ${(ro.confidence * 100).toFixed(0)}% — below ${ROUTER_LOW_CONFIDENCE_THRESHOLD * 100}% threshold`,
        { confidence: ro.confidence }));
    }

    // Router retailer scope vs QU retailer preference mismatch
    if (input.queryUnderstandingOutput != null) {
      const qu = input.queryUnderstandingOutput;
      const routerSpecific = ro.retailerScope !== "all" && ro.retailerScope !== "unknown";
      const quSpecific = qu.retailerPreference !== "all" && qu.retailerPreference !== "unknown";
      if (routerSpecific && quSpecific && ro.retailerScope !== qu.retailerPreference) {
        findings.push(mkWarn("router", "router:qu-scope-mismatch",
          `Router scoped to "${ro.retailerScope}" but QU prefers "${qu.retailerPreference}" — retailer signals disagree`,
          { routerScope: ro.retailerScope, quPreference: qu.retailerPreference }));
      }
    }
  }

  // ── Query Understanding heuristics ──

  if (input.quUsed === true && input.queryUnderstandingOutput == null) {
    findings.push(mkWarn("qu", "qu:failed",
      "QU was invoked but returned null — fell back to Route B (basic keyword search)"));
  }

  if (input.queryUnderstandingOutput != null) {
    const qu = input.queryUnderstandingOutput;

    if (qu.keywords.length === 0) {
      findings.push(mkFail("qu", "qu:empty-keywords",
        "Query Understanding returned no keywords — Product Finder will use the raw query verbatim"));
    }

    if (!qu.category || qu.category.trim() === "") {
      findings.push(mkWarn("qu", "qu:empty-category",
        "Query Understanding returned an empty category — explanation summary will be generic (\"product\")"));
    }
  }

  // ── Product Finder heuristics ──

  // Zero candidates is only a problem on Route A (QU was present and search ran)
  if (
    input.finderCandidateCount === 0 &&
    input.queryUnderstandingOutput != null &&
    input.inputSource !== "foundProducts"
  ) {
    findings.push(mkFail("finder", "finder:zero-candidates",
      "Route A ran but Product Finder returned 0 candidates — adapter returned nothing for the QU search query"));
  }

  if (
    input.topCandidateScore != null &&
    input.topCandidateScore < WEAK_SCORE_THRESHOLD
  ) {
    findings.push(mkWarn("finder", "finder:weak-top-score",
      `Top candidate match score is ${input.topCandidateScore.toFixed(2)} — result may not match user intent`,
      { score: input.topCandidateScore }));
  }

  // ── Explanation heuristics ──

  if (input.inputSource === "finderCandidates" && input.explanation == null) {
    findings.push(mkFail("explanation", "explanation:missing-on-product-path",
      "Route A produced finderCandidates but explanation is absent — likely a wiring regression in orchestrator"));
  }

  if (input.explanation != null) {
    const budgetStatus = input.explanation.metadata.budgetStatus;
    if (budgetStatus === "way_exceeded") {
      findings.push(mkInfo("explanation", "explanation:over-budget",
        "Top candidate significantly exceeds budget — verify explanation surfaces this clearly to the user",
        { budgetStatus }));
    }
  }

  // ── Path heuristics ──

  if (input.isCartIntent === true && input.explanation?.metadata.variantGroupingApplied === true) {
    findings.push(mkFail("path", "path:cart-intent-narrowed",
      "Cart intent was detected but topVariantGroup narrowing was applied — multi-product results may have been collapsed to one product"));
  }

  if (input.inputSource === "foundProducts") {
    findings.push(mkInfo("path", "path:fallback-used",
      "Route B (basic keyword search) was used — attribute scoring and QU-driven filtering were not applied"));
  }

  // ── Warning accumulation heuristics ──

  const warnings = input.warnings ?? [];
  if (warnings.length > EXCESSIVE_WARNINGS_THRESHOLD) {
    findings.push(mkWarn("warnings", "warnings:excessive",
      `${warnings.length} warnings accumulated — likely signals repeated adapter errors or configuration issues`,
      { count: warnings.length, sample: warnings.slice(0, 3) }));
  }

  return findings;
}

// ── Runner ──

/**
 * Review a batch of captured pipeline inputs.
 * Returns per-input findings and a batch summary.
 * Never throws — malformed inputs produce empty findings, not exceptions.
 */
export function runQualityReview(inputs: PipelineReviewInput[]): {
  results: ReviewResult[];
  summary: ReviewSummary;
} {
  const results: ReviewResult[] = inputs.map((input) => {
    let findings: ReviewFinding[] = [];
    try {
      findings = reviewSingleInput(input);
    } catch {
      // Defensive: malformed input should never crash the reviewer
    }
    return {
      input,
      findings,
      hasFailures: findings.some((f) => f.severity === "fail"),
      hasWarnings: findings.some((f) => f.severity === "warn"),
    };
  });

  return { results, summary: buildReviewSummary(results) };
}

// ── Summary builder ──

export function buildReviewSummary(results: ReviewResult[]): ReviewSummary {
  const total = results.length;
  const allFindings = results.flatMap((r) => r.findings);

  // Category counts
  const catCounts = new Map<string, number>();
  for (const f of allFindings) {
    catCounts.set(f.category, (catCounts.get(f.category) ?? 0) + 1);
  }
  const topCategories = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Common warnings (appearing in > 1 input)
  const warnCounts = new Map<string, number>();
  for (const r of results) {
    const seen = new Set<string>();
    for (const w of r.input.warnings ?? []) {
      if (!seen.has(w)) {
        warnCounts.set(w, (warnCounts.get(w) ?? 0) + 1);
        seen.add(w);
      }
    }
  }
  const commonWarnings = [...warnCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([warning, count]) => ({ warning, count }))
    .sort((a, b) => b.count - a.count);

  // Fallback rate
  const fallbackCount = results.filter((r) => r.input.inputSource === "foundProducts").length;

  // Suggested fixture candidates: at least one fail OR ≥ 2 warns
  const suggestedFixtureCandidates = results
    .filter((r) => {
      if (r.hasFailures) return true;
      const warnCount = r.findings.filter((f) => f.severity === "warn").length;
      return warnCount >= 2;
    })
    .map((r) => r.input.query);

  return {
    totalReviewed: total,
    totalFindings: allFindings.length,
    queriesWithFailures: results.filter((r) => r.hasFailures).length,
    queriesWithWarnings: results.filter((r) => r.hasWarnings).length,
    fallbackRate: total > 0 ? fallbackCount / total : 0,
    topCategories,
    commonWarnings,
    suggestedFixtureCandidates,
  };
}

// ── Logging ──

/**
 * Emit one [quality-review] log line per finding.
 * Format: [quality-review] {"query":"...","category":"...","severity":"...","message":"..."}
 */
export function logReviewFindings(results: ReviewResult[]): void {
  for (const r of results) {
    for (const f of r.findings) {
      console.error("[quality-review]", JSON.stringify({
        query: r.input.query.slice(0, 80),
        category: f.category,
        severity: f.severity,
        check: f.check,
        message: f.message,
      }));
    }
  }
}

// ── Internal builders ──

function mkInfo(category: string, check: string, message: string, metadata?: Record<string, unknown>): ReviewFinding {
  return { severity: "info", category, check, message, ...(metadata ? { metadata } : {}) };
}

function mkWarn(category: string, check: string, message: string, metadata?: Record<string, unknown>): ReviewFinding {
  return { severity: "warn", category, check, message, ...(metadata ? { metadata } : {}) };
}

function mkFail(category: string, check: string, message: string, metadata?: Record<string, unknown>): ReviewFinding {
  return { severity: "fail", category, check, message, ...(metadata ? { metadata } : {}) };
}
