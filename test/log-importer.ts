/**
 * Log/import adapter for captured pipeline data.
 *
 * Converts captured logs, traces, or saved API outputs into PipelineReviewInput
 * records for offline quality review and fixture suggestion tooling.
 *
 * Design goals:
 *   - Offline only — no LLM, no network.
 *   - Tolerant of partial data — every field except query is optional.
 *   - Conservative — undefined is preferred over invented or incorrect data.
 *   - Composable — importRecord / importRecords / groupAndImport / summarize
 *     can each be called independently.
 *
 * Supported input forms:
 *   1. Full pipeline snapshot  — an object with routerOutput, queryUnderstandingOutput,
 *      explanation, warnings, etc. as typed sub-objects.
 *   2. CopilotResponse-like    — answer / products / explanation / warnings with a query.
 *   3. Structured log entry    — parsed from [tag] {json} log lines via parseLogLine().
 *   4. Partial stage snapshot  — only some stages captured; missing stages stay undefined.
 *   5. Arrays of the above     — pass to importRecords() or groupAndImport().
 *
 * Usage:
 *   const { records, diagnostics } = groupAndImport(rawRecords);
 *   const { results } = runQualityReview(records);
 */

import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ExplanationOutput } from "../src/core/types.js";
import type { RankingSnapshot } from "../src/capture/capture-record.js";
import type { PipelineReviewInput } from "./quality-review.js";

// ── Flexible input type ──

/**
 * Any record-like object from a capture source.
 * Field names may vary; the importer tries multiple known aliases.
 */
export type RawCapturedRecord = Record<string, unknown>;

/**
 * A pre-parsed structured log line from console.error output.
 * Format: "[tag] {json body}"
 */
export interface ParsedLogLine {
  /** Log tag without brackets, e.g. "router", "explanation". */
  tag: string;
  /** Parsed JSON body of the log entry. */
  body: Record<string, unknown>;
}

// ── Result models ──

export interface SingleImportResult {
  /** Normalized record, or null if no usable query could be found. */
  input: PipelineReviewInput | null;
  /** Warnings generated during import (shape failures, unrecognized fields, etc.). */
  importWarnings: string[];
  /**
   * True when the record contained fields the importer tried to map but had to skip
   * (e.g. a routerOutput field that failed shape validation).
   */
  isPartial: boolean;
}

export interface ImportDiagnostics {
  /** Number of PipelineReviewInput records successfully produced. */
  importedCount: number;
  /** Number of raw records that produced no output (no usable query or null result). */
  skippedCount: number;
  /**
   * Number of multi-record groups encountered during groupAndImport.
   * 0 when importRecords() is used directly (no grouping).
   */
  groupedCount: number;
  /** Number of raw records that had no recognizable query string. */
  recordsMissingQuery: number;
  /** Number of imported records that are partial (some fields could not be mapped). */
  partialImports: number;
  /** All import-time warnings across all records. */
  warnings: string[];
}

export interface BatchImportResult {
  records: PipelineReviewInput[];
  diagnostics: ImportDiagnostics;
}

// ── Known field aliases ──

const QUERY_ALIASES = ["query", "rawQuery", "userQuery", "message", "q"] as const;
const ID_ALIASES = ["id", "requestId", "traceId", "sessionId", "correlationId"] as const;
const GROUP_KEY_ALIASES = ["requestId", "traceId", "sessionId", "correlationId"] as const;

// ── Valid enum values (mirrors Zod schemas without importing Zod) ──

const VALID_ROUTER_INTENTS = ["search_product", "find_best_store", "check_cart"] as const;
const VALID_RETAILER_SCOPES = ["ikea", "structube", "all", "unknown"] as const;
const VALID_NEXT_AGENTS = ["query_understanding", "product_finder", "inventory_store", "response"] as const;
const VALID_ITEM_CARDINALITIES = ["single", "multiple", "unknown"] as const;
const VALID_INPUT_SOURCES = ["finderCandidates", "foundProducts"] as const;

// ────────────────────────────────────────────────
// Internal extraction helpers
// ────────────────────────────────────────────────

function getString(rec: RawCapturedRecord, ...fields: string[]): string | undefined {
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function getBoolean(rec: RawCapturedRecord, ...fields: string[]): boolean | undefined {
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

function getNumber(rec: RawCapturedRecord, ...fields: string[]): number | undefined {
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (!isNaN(n) && isFinite(n)) return n;
    }
  }
  return undefined;
}

function getStringArray(rec: RawCapturedRecord, ...fields: string[]): string[] | undefined {
  for (const f of fields) {
    const v = rec[f];
    if (Array.isArray(v)) {
      const strings = v.filter((x): x is string => typeof x === "string");
      if (strings.length > 0 || v.length === 0) return strings;
    }
  }
  return undefined;
}

// ────────────────────────────────────────────────
// Shape validators — conservative runtime checks
// ────────────────────────────────────────────────

/**
 * Validate that a value is a structurally complete RouterOutput.
 * Returns null if the value is explicitly null (router ran, returned null).
 * Returns undefined if the value is absent or fails validation.
 * Appends an import warning if a non-null object fails validation.
 */
function validateRouterOutput(
  v: unknown,
  importWarnings: string[],
): RouterOutput | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    importWarnings.push("routerOutput present but is not an object — skipping");
    return undefined;
  }
  const o = v as Record<string, unknown>;

  const missingFields: string[] = [];
  if (!VALID_ROUTER_INTENTS.includes(o.intent as RouterOutput["intent"])) missingFields.push("intent");
  if (!VALID_RETAILER_SCOPES.includes(o.retailerScope as RouterOutput["retailerScope"])) missingFields.push("retailerScope");
  if (typeof o.confidence !== "number") missingFields.push("confidence");
  if (typeof o.locationRequired !== "boolean") missingFields.push("locationRequired");
  if (typeof o.locationProvided !== "boolean") missingFields.push("locationProvided");
  if (!VALID_ITEM_CARDINALITIES.includes(o.itemCardinality as RouterOutput["itemCardinality"])) missingFields.push("itemCardinality");
  if (!VALID_NEXT_AGENTS.includes(o.nextAgent as RouterOutput["nextAgent"])) missingFields.push("nextAgent");
  if (!Array.isArray(o.warnings)) missingFields.push("warnings");
  if (typeof o.reasoningSummary !== "string") missingFields.push("reasoningSummary");

  if (missingFields.length > 0) {
    importWarnings.push(`routerOutput failed shape check (missing/invalid: ${missingFields.join(", ")}) — skipping`);
    return undefined;
  }

  return v as RouterOutput;
}

/**
 * Validate that a value is a structurally complete QueryUnderstandingOutput.
 * Same null/undefined/warning semantics as validateRouterOutput.
 */
function validateQUOutput(
  v: unknown,
  importWarnings: string[],
): QueryUnderstandingOutput | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    importWarnings.push("queryUnderstandingOutput present but is not an object — skipping");
    return undefined;
  }
  const o = v as Record<string, unknown>;

  const missingFields: string[] = [];
  if (typeof o.category !== "string") missingFields.push("category");
  if (!Array.isArray(o.keywords)) missingFields.push("keywords");
  if (!VALID_ITEM_CARDINALITIES.includes(o.itemCardinality as QueryUnderstandingOutput["itemCardinality"])) missingFields.push("itemCardinality");
  if (!VALID_RETAILER_SCOPES.includes(o.retailerPreference as QueryUnderstandingOutput["retailerPreference"])) missingFields.push("retailerPreference");
  if (!Array.isArray(o.warnings)) missingFields.push("warnings");

  if (missingFields.length > 0) {
    importWarnings.push(`queryUnderstandingOutput failed shape check (missing/invalid: ${missingFields.join(", ")}) — skipping`);
    return undefined;
  }

  return v as QueryUnderstandingOutput;
}

/**
 * Validate that a value is a structurally complete ExplanationOutput.
 * Same null/undefined/warning semantics as the above validators.
 */
function validateExplanationOutput(
  v: unknown,
  importWarnings: string[],
): ExplanationOutput | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    importWarnings.push("explanation present but is not an object — skipping");
    return undefined;
  }
  const o = v as Record<string, unknown>;

  const missingFields: string[] = [];
  if (typeof o.summary !== "string") missingFields.push("summary");
  if (!Array.isArray(o.explanationPoints)) missingFields.push("explanationPoints");
  if (!Array.isArray(o.warnings)) missingFields.push("warnings");
  if (typeof o.metadata !== "object" || o.metadata === null) missingFields.push("metadata");

  if (missingFields.length > 0) {
    importWarnings.push(`explanation failed shape check (missing/invalid: ${missingFields.join(", ")}) — skipping`);
    return undefined;
  }

  return v as ExplanationOutput;
}

/**
 * Validate a raw rankingSnapshot value.
 * Returns the snapshot when it has the minimum required shape:
 *   stores: array, cart: array, rankedIds: string[].
 * Returns undefined (not null) when absent or invalid — rankingSnapshot is
 * always optional so we never signal "ran but failed" for it.
 */
function validateRankingSnapshot(v: unknown): RankingSnapshot | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.stores)) return undefined;
  if (!Array.isArray(o.cart)) return undefined;
  if (!Array.isArray(o.rankedIds)) return undefined;
  if (!o.rankedIds.every((id: unknown) => typeof id === "string")) return undefined;
  return v as RankingSnapshot;
}

/**
 * Derive inputSource from a raw value.
 * Returns undefined when the value cannot be safely interpreted.
 */
function deriveInputSource(
  v: unknown,
): "finderCandidates" | "foundProducts" | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && VALID_INPUT_SOURCES.includes(v as "finderCandidates" | "foundProducts")) {
    return v as "finderCandidates" | "foundProducts";
  }
  // Route A / Route B aliases
  if (v === "routeA" || v === "A") return "finderCandidates";
  if (v === "routeB" || v === "B") return "foundProducts";
  return undefined;
}

/**
 * Derive inputSource from explanation metadata as a fallback.
 */
function deriveInputSourceFromExplanation(
  explanation: ExplanationOutput | null | undefined,
): "finderCandidates" | "foundProducts" | null | undefined {
  if (explanation == null) return undefined;
  const src = explanation.metadata?.inputSource;
  if (src === "finderCandidates" || src === "foundProducts" || src === null) return src;
  return undefined;
}

// ────────────────────────────────────────────────
// Log line parser
// ────────────────────────────────────────────────

/**
 * Parse a structured log line emitted by console.error in the pipeline.
 * Expected format: "[tag] {json}"
 *
 * Returns null when the line does not match the expected format.
 */
export function parseLogLine(line: string): ParsedLogLine | null {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  // Match "[tag] {...}" — tag is alphanumeric and may include hyphens/colons
  const match = trimmed.match(/^\[([a-zA-Z0-9:_-]+)\]\s+(\{[\s\S]*\})\s*$/);
  if (!match) return null;
  try {
    const body = JSON.parse(match[2]);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return { tag: match[1], body: body as Record<string, unknown> };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Core importer
// ────────────────────────────────────────────────

/**
 * Normalize a single raw captured record into a PipelineReviewInput.
 *
 * Returns { input: null } when no usable query string can be found.
 * Never throws — all errors are captured in importWarnings.
 */
export function importRecord(raw: RawCapturedRecord): SingleImportResult {
  const importWarnings: string[] = [];
  let isPartial = false;

  // ── Query (required) ──
  const query = getString(raw, ...QUERY_ALIASES);
  if (!query) {
    return { input: null, importWarnings: ["no usable query field found"], isPartial: false };
  }

  // ── Identity / tracing ──
  const id = getString(raw, ...ID_ALIASES);
  const timestamp = getString(raw, "timestamp", "ts", "time", "createdAt");

  // ── Router output ──
  // Check explicit null (invoked, returned null) vs absent
  const rawRouterOutput = raw.routerOutput;
  const routerOutputValidated = validateRouterOutput(rawRouterOutput, importWarnings);
  if (rawRouterOutput !== undefined && routerOutputValidated === undefined) isPartial = true;

  // routerUsed: explicit field, or infer from output presence/null
  let routerUsed = getBoolean(raw, "routerUsed", "routerInvoked");
  if (routerUsed === undefined) {
    if (rawRouterOutput !== undefined) routerUsed = true;
    else if (getBoolean(raw, "routerFailed") === true) routerUsed = true;
  }

  // If invoked but failed, represent as null (not undefined)
  const finalRouterOutput: RouterOutput | null | undefined =
    routerOutputValidated !== undefined
      ? routerOutputValidated
      : rawRouterOutput === null
        ? null
        : getBoolean(raw, "routerFailed") === true
          ? null
          : undefined;

  // ── Query Understanding output ──
  const rawQUOutput = raw.queryUnderstandingOutput;
  const quOutputValidated = validateQUOutput(rawQUOutput, importWarnings);
  if (rawQUOutput !== undefined && quOutputValidated === undefined) isPartial = true;

  let quUsed = getBoolean(raw, "quUsed", "quInvoked");
  if (quUsed === undefined) {
    if (rawQUOutput !== undefined) quUsed = true;
    else if (getBoolean(raw, "quFailed") === true) quUsed = true;
  }

  const finalQUOutput: QueryUnderstandingOutput | null | undefined =
    quOutputValidated !== undefined
      ? quOutputValidated
      : rawQUOutput === null
        ? null
        : getBoolean(raw, "quFailed") === true
          ? null
          : undefined;

  // ── Explanation output ──
  const rawExplanation = raw.explanation;
  const explanationValidated = validateExplanationOutput(rawExplanation, importWarnings);
  if (rawExplanation !== undefined && explanationValidated === undefined) isPartial = true;

  const finalExplanation: ExplanationOutput | null | undefined =
    explanationValidated !== undefined
      ? explanationValidated
      : rawExplanation === null
        ? null
        : undefined;

  // ── inputSource (Route A / Route B) ──
  // Try explicit field → explanation metadata → heuristic from QU presence
  let inputSource = deriveInputSource(raw.inputSource);
  if (inputSource === undefined) {
    inputSource = deriveInputSourceFromExplanation(finalExplanation);
  }
  if (inputSource === undefined && finalQUOutput !== undefined) {
    // If QU output is present, this is likely Route A; absent is likely Route B.
    // Only assign if we have positive evidence (present QU = finderCandidates path).
    if (finalQUOutput !== null) {
      inputSource = "finderCandidates";
    }
  }

  // ── Finder / candidate data ──
  // Try explicit count first; fall back to products array length (CopilotResponse path)
  let finderCandidateCount = getNumber(
    raw, "finderCandidateCount", "candidateCount", "candidates",
  );
  if (finderCandidateCount === undefined) {
    // CopilotResponse-like: products array
    const products = raw.products;
    if (Array.isArray(products)) finderCandidateCount = products.length;
  }

  const topCandidateScore = getNumber(raw, "topCandidateScore", "topScore", "matchScore");

  // ── Cart intent ──
  // Explicit field wins; fall back to QU or router itemCardinality
  let isCartIntent = getBoolean(raw, "isCartIntent");
  if (isCartIntent === undefined) {
    const quCard = (finalQUOutput as QueryUnderstandingOutput | null | undefined)
      ?.itemCardinality;
    const routerCard = (finalRouterOutput as RouterOutput | null | undefined)
      ?.itemCardinality;
    if (quCard === "multiple" || routerCard === "multiple") isCartIntent = true;
    else if (quCard === "single" || routerCard === "single") isCartIntent = false;
  }

  // ── Warnings ──
  // Primary: explicit warnings array
  // Secondary: warnings from validated stage outputs (already in-object)
  // Final answer summary: explanation summary or answer field
  const rawWarnings = getStringArray(raw, "warnings") ?? [];

  // ── Final answer summary ──
  const finalAnswerSummary = getString(raw, "finalAnswerSummary", "answer", "finalAnswer");

  // ── Assemble result ──
  const input: PipelineReviewInput = { query };

  if (id !== undefined) input.id = id;
  if (timestamp !== undefined) input.timestamp = timestamp;
  if (finalRouterOutput !== undefined) input.routerOutput = finalRouterOutput;
  if (routerUsed !== undefined) input.routerUsed = routerUsed;
  if (finalQUOutput !== undefined) input.queryUnderstandingOutput = finalQUOutput;
  if (quUsed !== undefined) input.quUsed = quUsed;
  if (finderCandidateCount !== undefined) input.finderCandidateCount = finderCandidateCount;
  if (topCandidateScore !== undefined) input.topCandidateScore = topCandidateScore;
  if (finalExplanation !== undefined) input.explanation = finalExplanation;
  if (inputSource !== undefined) input.inputSource = inputSource;
  if (isCartIntent !== undefined) input.isCartIntent = isCartIntent;
  if (rawWarnings.length > 0) input.warnings = rawWarnings;
  if (finalAnswerSummary !== undefined) input.finalAnswerSummary = finalAnswerSummary;

  const rankingSnapshot = validateRankingSnapshot(raw.rankingSnapshot);
  if (rankingSnapshot !== undefined) input.rankingSnapshot = rankingSnapshot;

  return { input, importWarnings, isPartial };
}

// ────────────────────────────────────────────────
// Batch importer (no grouping)
// ────────────────────────────────────────────────

/**
 * Import a batch of raw records into PipelineReviewInput records.
 * Records with no usable query are skipped and counted in diagnostics.
 * Never throws.
 */
export function importRecords(raws: RawCapturedRecord[]): BatchImportResult {
  const records: PipelineReviewInput[] = [];
  const allImportWarnings: string[] = [];
  let skippedCount = 0;
  let recordsMissingQuery = 0;
  let partialImports = 0;

  for (const raw of raws) {
    try {
      const result = importRecord(raw);
      if (result.input === null) {
        skippedCount++;
        if (result.importWarnings.some((w) => w.includes("no usable query"))) {
          recordsMissingQuery++;
        }
      } else {
        records.push(result.input);
        if (result.isPartial) partialImports++;
      }
      allImportWarnings.push(...result.importWarnings);
    } catch {
      skippedCount++;
      allImportWarnings.push("record threw during import — skipped");
    }
  }

  return {
    records,
    diagnostics: {
      importedCount: records.length,
      skippedCount,
      groupedCount: 0,
      recordsMissingQuery,
      partialImports,
      warnings: allImportWarnings,
    },
  };
}

// ────────────────────────────────────────────────
// Grouping
// ────────────────────────────────────────────────

/**
 * Derive the stable group key for a raw record.
 * Priority: requestId/traceId/sessionId/correlationId → query string.
 * Returns null when no key can be derived (record will be imported standalone).
 */
function getGroupKey(raw: RawCapturedRecord): string | null {
  for (const field of GROUP_KEY_ALIASES) {
    const v = raw[field];
    if (typeof v === "string" && v.trim()) return `id:${v.trim()}`;
  }
  const q = getString(raw, ...QUERY_ALIASES);
  if (q) return `q:${q}`;
  return null;
}

/**
 * Merge multiple raw records (belonging to the same request) into one.
 *
 * Strategy:
 *  - For most fields: first non-null, non-undefined value wins.
 *  - For warnings arrays: concatenate and deduplicate.
 *  - For routerOutput/queryUnderstandingOutput/explanation:
 *    first non-null value wins (null = explicit failure, honored if all are null).
 */
function mergeGroup(records: RawCapturedRecord[]): RawCapturedRecord {
  const merged: RawCapturedRecord = {};

  // Merge all fields with "first wins" for most keys
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      if (k === "warnings") continue; // handled separately
      if (merged[k] === undefined && v !== undefined) {
        merged[k] = v;
      }
    }
  }

  // Merge warnings: concatenate all, deduplicate
  const allWarnings: string[] = [];
  for (const rec of records) {
    if (Array.isArray(rec.warnings)) {
      for (const w of rec.warnings) {
        if (typeof w === "string" && !allWarnings.includes(w)) {
          allWarnings.push(w);
        }
      }
    }
  }
  if (allWarnings.length > 0) merged.warnings = allWarnings;

  return merged;
}

/**
 * Group raw records by stable key, merge each group, and import.
 *
 * Records that share a requestId / traceId / sessionId / query are merged
 * before normalization. Records with no derivable key are imported standalone.
 *
 * groupedCount in diagnostics = number of groups that contained ≥ 2 records.
 * Never throws.
 */
export function groupAndImport(raws: RawCapturedRecord[]): BatchImportResult {
  const groups = new Map<string, RawCapturedRecord[]>();
  const ungrouped: RawCapturedRecord[] = [];

  for (const raw of raws) {
    const key = getGroupKey(raw);
    if (key === null) {
      ungrouped.push(raw);
    } else {
      const existing = groups.get(key);
      if (existing) existing.push(raw);
      else groups.set(key, [raw]);
    }
  }

  // Count multi-record groups
  let groupedCount = 0;
  const toImport: RawCapturedRecord[] = [];

  for (const group of groups.values()) {
    if (group.length >= 2) groupedCount++;
    toImport.push(mergeGroup(group));
  }

  // Ungrouped records are imported as-is
  for (const raw of ungrouped) {
    toImport.push(raw);
  }

  const { records, diagnostics } = importRecords(toImport);
  return {
    records,
    diagnostics: { ...diagnostics, groupedCount },
  };
}

// ────────────────────────────────────────────────
// Debug / rendering helpers
// ────────────────────────────────────────────────

/**
 * Return a compact human-readable text summary of imported records.
 * Useful for dev review and debugging — not for production output.
 */
export function summarizeImportedRecords(records: PipelineReviewInput[]): string {
  if (records.length === 0) return "(no records)";
  const lines: string[] = [`Imported ${records.length} record${records.length === 1 ? "" : "s"}:`];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const label = r.id ? ` (id: ${r.id})` : "";
    lines.push(`\n[${i + 1}] "${r.query.slice(0, 60)}"${label}`);

    // Router
    if (r.routerOutput !== undefined) {
      if (r.routerOutput === null) {
        lines.push(`  Router: invoked, failed`);
      } else {
        lines.push(`  Router: ok (intent: ${r.routerOutput.intent}, confidence: ${r.routerOutput.confidence.toFixed(2)}, scope: ${r.routerOutput.retailerScope})`);
      }
    } else if (r.routerUsed) {
      lines.push(`  Router: invoked (no output)`);
    } else {
      lines.push(`  Router: absent`);
    }

    // QU
    if (r.queryUnderstandingOutput !== undefined) {
      if (r.queryUnderstandingOutput === null) {
        lines.push(`  QU: invoked, failed`);
      } else {
        const cat = r.queryUnderstandingOutput.category || "(no category)";
        const kwCount = r.queryUnderstandingOutput.keywords.length;
        lines.push(`  QU: ok (category: ${cat}, keywords: ${kwCount})`);
      }
    } else if (r.quUsed) {
      lines.push(`  QU: invoked (no output)`);
    } else {
      lines.push(`  QU: absent`);
    }

    // Finder
    if (r.finderCandidateCount !== undefined) {
      const route = r.inputSource === "finderCandidates" ? "Route A"
        : r.inputSource === "foundProducts" ? "Route B"
          : "unknown route";
      const score = r.topCandidateScore != null
        ? `, top score: ${r.topCandidateScore.toFixed(2)}`
        : "";
      lines.push(`  Finder: ${r.finderCandidateCount} candidates, ${route}${score}`);
    } else if (r.inputSource) {
      lines.push(`  Route: ${r.inputSource}`);
    }

    // Explanation
    if (r.explanation !== undefined) {
      if (r.explanation === null) {
        lines.push(`  Explanation: absent (null)`);
      } else {
        lines.push(`  Explanation: ok (${r.explanation.explanationPoints.length} points)`);
      }
    }

    // Warnings
    const warnCount = r.warnings?.length ?? 0;
    if (warnCount > 0) lines.push(`  Warnings: ${warnCount}`);
  }

  return lines.join("\n");
}
