/**
 * Compact, review-friendly snapshot of one pipeline run.
 *
 * Field names are intentionally aligned with PipelineReviewInput (test/quality-review.ts)
 * so that the log-importer can parse these records directly from structured logs
 * without any adapter layer.
 *
 * Keep this shape stable — the offline review pipeline depends on field names.
 * Add new optional fields only; never remove or rename existing ones.
 */

import type { RouterOutput } from "../llm/router.js";
import type { QueryUnderstandingOutput } from "../llm/query-understanding.js";
import type { ExplanationOutput, StoreStock } from "../core/types.js";

/**
 * Snapshot of one store-ranking invocation.
 * Allows offline extraction of golden ranking scenarios from production logs.
 */
export interface RankingSnapshot {
  /** All stores that were scored (pre-truncation). */
  stores: StoreStock[];
  /** Cart used as the ranking objective. */
  cart: Array<{ itemNo: string; quantity: number }>;
  /** storeIds in final rank order (highest score first). */
  rankedIds: string[];
}

export interface CaptureRecord {
  /** Request or trace identifier (maps to PipelineReviewInput.id). Optional — only set when available. */
  id?: string;

  /** ISO-8601 timestamp at capture time. */
  timestamp: string;

  /** Raw user query. Required by the importer. */
  query: string;

  /**
   * Structured router decision.
   * Undefined = router was not invoked.
   * Null = router was invoked but failed (LLM error, fallback to classifier).
   */
  routerOutput?: RouterOutput | null;

  /** True when the Router Agent was invoked for this request (even if it returned null). */
  routerUsed?: boolean;

  /**
   * Normalized query fields from the Query Understanding Agent.
   * Undefined = QU was not invoked. Null = QU was invoked but failed.
   */
  queryUnderstandingOutput?: QueryUnderstandingOutput | null;

  /** True when QU was invoked for this request (even if it returned null). */
  quUsed?: boolean;

  /**
   * Number of scored Product Finder candidates.
   * 0 for Route B (foundProducts fallback) or when the finder returned no results.
   * Derived from explanation.metadata.candidateCount — not a separate source of truth.
   */
  finderCandidateCount?: number;

  /**
   * Match score of the top-ranked Product Finder candidate (0–1).
   * Null when no candidates were scored (Route B or empty results).
   * Derived from explanation.metadata.topCandidateScore.
   */
  topCandidateScore?: number | null;

  /**
   * Deterministic explanation output. Contains structured metadata about
   * the path taken, budget status, attribute matching, etc.
   * Only present when a product search was performed and products were found.
   */
  explanation?: ExplanationOutput | null;

  /**
   * Data source used for the inventory lookup.
   * "finderCandidates" = Route A (Product Finder + scoring).
   * "foundProducts"    = Route B (basic keyword fallback).
   * Null or absent for non-product-search intents.
   * Derived from explanation.metadata.inputSource.
   */
  inputSource?: "finderCandidates" | "foundProducts" | null;

  /**
   * True when QU identified the query as involving multiple distinct products
   * (itemCardinality="multiple"), which changes how the inventory lookup cart is built.
   */
  isCartIntent?: boolean;

  /** All accumulated pipeline warnings from all stages. */
  warnings: string[];

  /**
   * Snapshot of the store-ranking call that produced `recommendation`.
   * Present only when a stock or auto-rank path ran and stores were scored.
   * Enables offline extraction of golden ranking scenarios — see
   * test/golden-ranking-fixtures.ts extractScenariosFromCaptures().
   */
  rankingSnapshot?: RankingSnapshot;

  /**
   * Schema version. Increment when breaking changes are made to this shape.
   * The importer ignores unknown fields, so additions are always backwards-compatible.
   */
  _captureVersion: 1;
}
