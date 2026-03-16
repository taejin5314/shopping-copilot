/**
 * Capture exporter — builds compact CaptureRecord objects from pipeline outputs
 * and provides factory helpers for the two supported export targets.
 *
 * Design goals:
 *   - Pure / deterministic — buildCaptureRecord has no I/O, no LLM, no network.
 *   - Single source of truth — counts and scores are derived from
 *     explanation.metadata, never independently re-computed.
 *   - Non-throwing — every public function is guarded; failures stay local.
 *   - Opt-in — the CaptureExporter type is an optional callback; callers that
 *     don't supply one incur zero overhead.
 */

/// <reference types="node" />

import type { RouterOutput } from "../llm/router.js";
import type { QueryUnderstandingOutput } from "../llm/query-understanding.js";
import type { ExplanationOutput } from "../core/types.js";
import type { CaptureRecord } from "./capture-record.js";

// ── Input model ──

/**
 * Inputs for buildCaptureRecord.
 *
 * All fields except `query` are optional.  The builder degrades gracefully when
 * stages are absent (e.g. non-product intents produce no explanation output).
 */
export interface CaptureInputs {
  /** Optional trace/request identifier. */
  requestId?: string;

  /** Raw user query. */
  query: string;

  /**
   * Router output.
   * Undefined = router not invoked.
   * Null = router invoked but failed.
   */
  routerOutput?: RouterOutput | null;

  /**
   * Query Understanding output.
   * Undefined = QU not invoked.
   * Null = QU invoked but failed.
   */
  queryUnderstandingOutput?: QueryUnderstandingOutput | null;

  /** Deterministic explanation output, if a product search ran. */
  explanation?: ExplanationOutput | null;

  /** All accumulated pipeline warnings. */
  warnings?: string[];

  /** Whether QU flagged this as a multi-product cart intent. */
  isCartIntent?: boolean;
}

// ── Core builder ──

/**
 * Build a compact CaptureRecord from structured pipeline outputs.
 *
 * Derives finderCandidateCount, topCandidateScore, and inputSource from
 * explanation.metadata so there is no second source of truth for these values.
 *
 * Pure and deterministic — never throws.
 */
export function buildCaptureRecord(inputs: CaptureInputs): CaptureRecord {
  const {
    requestId,
    query,
    routerOutput,
    queryUnderstandingOutput,
    explanation,
    warnings = [],
    isCartIntent,
  } = inputs;

  const meta = explanation?.metadata;

  const record: CaptureRecord = {
    timestamp: new Date().toISOString(),
    query,
    warnings: [...warnings], // defensive copy — do not share the live array
    _captureVersion: 1,
  };

  if (requestId !== undefined) {
    record.id = requestId;
  }

  // Router — only set fields when the router was involved
  if (routerOutput !== undefined) {
    record.routerOutput = routerOutput;
    record.routerUsed = true;
  }

  // Query Understanding — only set fields when QU was involved
  if (queryUnderstandingOutput !== undefined) {
    record.queryUnderstandingOutput = queryUnderstandingOutput;
    record.quUsed = true;
  }

  // Explanation — only present on product-search paths
  if (explanation !== undefined) {
    record.explanation = explanation;
  }

  // Finder counts and route — derived from explanation metadata (single source of truth)
  if (meta !== undefined) {
    record.finderCandidateCount = meta.candidateCount;
    record.topCandidateScore = meta.topCandidateScore;
    record.inputSource = meta.inputSource;
  }

  if (isCartIntent !== undefined) {
    record.isCartIntent = isCartIntent;
  }

  return record;
}

// ── Serializer ──

/**
 * Serialize a CaptureRecord to a compact JSON string.
 *
 * The output is stable for equal inputs (V8 preserves insertion order for
 * plain objects with known keys, which is sufficient for review tooling).
 *
 * Never throws — returns an empty string on unexpected failure.
 */
export function serializeCaptureRecord(record: CaptureRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    return "";
  }
}

// ── Exporter factories ──

/** A callback that receives a completed CaptureRecord. */
export type CaptureExporter = (record: CaptureRecord) => void;

/**
 * Returns a CaptureExporter that writes each record as a structured log line
 * to stderr in the format `<tag> <json>`.
 *
 * This format is directly compatible with the log-importer's `[tag] {json}`
 * structured log parser, so captured lines can be fed straight into the
 * offline review pipeline:
 *
 *   node myapp 2>captured.log
 *   npm run review -- captured.log
 *
 * Failures are silently swallowed — the log exporter must never interrupt
 * the request path.
 */
export function makeLogExporter(tag = "[capture]"): CaptureExporter {
  return (record) => {
    try {
      process.stderr.write(`${tag} ${serializeCaptureRecord(record)}\n`);
    } catch {
      // Non-fatal — never disrupt the request path
    }
  };
}

/**
 * Returns a no-op CaptureExporter.
 *
 * Use as a safe default when capture is not configured, or in tests that
 * want to assert no side effects from the exporter path.
 */
export function makeNullExporter(): CaptureExporter {
  return () => {};
}
