/**
 * Pure pipeline logic for offline quality review.
 *
 * All functions are deterministic and side-effect free (no I/O, no LLM, no network).
 * The CLI entrypoint (quality-review-cli.ts) handles I/O and delegates to these.
 * Tests import these directly to verify behavior without touching the filesystem.
 *
 * Pipeline:
 *   parseRawContent()      → RawCapturedRecord[]
 *   runFullReviewPipeline() → PipelineRunResult
 *   format*()              → string / JSON for output
 */

import { parseLogLine, groupAndImport, type RawCapturedRecord } from "../test/log-importer.js";
import { runQualityReview, type ReviewResult, type ReviewSummary, type PipelineReviewInput } from "../test/quality-review.js";
import { generateFixtureSuggestions, renderFixtureSuggestion, buildSuggestionSummary, type FixtureSuggestion, type SuggestionSummary } from "../test/fixture-suggester.js";
import type { ImportDiagnostics } from "../test/log-importer.js";

// ── Result types ──

export interface ParseRawResult {
  records: RawCapturedRecord[];
  parseWarnings: string[];
  /** Total lines (or items) attempted. */
  linesProcessed: number;
  /** Lines that could not be parsed as any recognised format. */
  lineErrors: number;
}

export interface PipelineRunResult {
  importedRecords: PipelineReviewInput[];
  importDiagnostics: ImportDiagnostics;
  reviewResults: ReviewResult[];
  reviewSummary: ReviewSummary;
  suggestions: FixtureSuggestion[];
  suggestionSummary: SuggestionSummary;
}

// ── Input parser ──

function isPlainObject(v: unknown): v is RawCapturedRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse raw file content into a flat array of RawCapturedRecord objects.
 *
 * Supported formats (tried in order):
 *   1. JSON array   — `[{...}, {...}]`
 *   2. JSON object  — `{...}` (single record)
 *   3. Line-based   — each line is either `[tag] {json}` (structured log)
 *                     or a plain JSON object (NDJSON)
 *
 * Malformed lines are counted and reported in parseWarnings but never throw.
 */
export function parseRawContent(content: string, _filename?: string): ParseRawResult {
  const trimmed = content.trim();

  if (!trimmed) {
    return { records: [], parseWarnings: [], linesProcessed: 0, lineErrors: 0 };
  }

  // ── 1. Attempt full-document JSON parse ──
  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      const records = parsed.filter(isPlainObject);
      const skipped = parsed.length - records.length;
      const parseWarnings: string[] = [];
      if (skipped > 0) parseWarnings.push(`${skipped} non-object item(s) in JSON array skipped`);
      return { records, parseWarnings, linesProcessed: parsed.length, lineErrors: skipped };
    }

    if (isPlainObject(parsed)) {
      return { records: [parsed], parseWarnings: [], linesProcessed: 1, lineErrors: 0 };
    }

    return {
      records: [],
      parseWarnings: ["JSON root is not an object or array — no records extracted"],
      linesProcessed: 0,
      lineErrors: 1,
    };
  } catch {
    // Not valid full-document JSON — fall through to line-by-line
  }

  // ── 2. Line-by-line: [tag] {json} or plain JSON objects ──
  const records: RawCapturedRecord[] = [];
  const lines = trimmed.split("\n");
  let lineErrors = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Try structured log format first
    const logLine = parseLogLine(line);
    if (logLine) {
      records.push(logLine.body as RawCapturedRecord);
      continue;
    }

    // Try plain JSON object (NDJSON)
    try {
      const parsed = JSON.parse(line);
      if (isPlainObject(parsed)) {
        records.push(parsed as RawCapturedRecord);
        continue;
      }
    } catch {
      // not valid JSON
    }

    lineErrors++;
  }

  const parseWarnings: string[] = [];
  if (lineErrors > 0) {
    parseWarnings.push(
      `${lineErrors} line${lineErrors === 1 ? "" : "s"} could not be parsed — skipped`,
    );
  }

  return { records, parseWarnings, linesProcessed: lines.length, lineErrors };
}

/**
 * Merge ParseRawResult arrays from multiple files into one.
 * parseWarnings are prefixed with filename when provided.
 */
export function mergeParseResults(
  results: Array<{ result: ParseRawResult; filename?: string }>,
): ParseRawResult {
  const merged: ParseRawResult = {
    records: [],
    parseWarnings: [],
    linesProcessed: 0,
    lineErrors: 0,
  };

  for (const { result, filename } of results) {
    merged.records.push(...result.records);
    merged.linesProcessed += result.linesProcessed;
    merged.lineErrors += result.lineErrors;

    for (const w of result.parseWarnings) {
      merged.parseWarnings.push(filename ? `[${filename}] ${w}` : w);
    }
  }

  return merged;
}

// ── Pipeline runner ──

/**
 * Run the full offline review pipeline over a flat list of raw records.
 * Steps: group + import → quality review → fixture suggestions.
 * Never throws.
 */
export function runFullReviewPipeline(allRecords: RawCapturedRecord[]): PipelineRunResult {
  const { records: importedRecords, diagnostics: importDiagnostics } =
    groupAndImport(allRecords);

  const { results: reviewResults, summary: reviewSummary } =
    runQualityReview(importedRecords);

  const suggestions = generateFixtureSuggestions(reviewResults);
  const suggestionSummary = buildSuggestionSummary(suggestions);

  return {
    importedRecords,
    importDiagnostics,
    reviewResults,
    reviewSummary,
    suggestions,
    suggestionSummary,
  };
}

// ── Formatters ──

/**
 * Compact human-readable summary.
 * Always safe to print even when counts are all zero.
 */
export function formatDefault(result: PipelineRunResult, fileCount = 0): string {
  const { importDiagnostics: diag, reviewSummary: rs, suggestionSummary: ss } = result;
  const lines: string[] = [];

  lines.push("=== Quality Review Summary ===");
  if (fileCount > 0) lines.push(`Files processed: ${fileCount}`);

  lines.push(
    `Records imported: ${diag.importedCount}` +
    ` | Skipped: ${diag.skippedCount}` +
    ` | Grouped: ${diag.groupedCount}` +
    (diag.partialImports > 0 ? ` | Partial: ${diag.partialImports}` : ""),
  );

  lines.push(`Queries reviewed: ${rs.totalReviewed} | Total findings: ${rs.totalFindings}`);
  lines.push(
    `  Failures: ${rs.queriesWithFailures}` +
    ` | Warnings: ${rs.queriesWithWarnings}` +
    ` | Fallback rate (Route B): ${(rs.fallbackRate * 100).toFixed(0)}%`,
  );

  if (rs.topCategories.length > 0) {
    lines.push("");
    lines.push("Top issue categories:");
    for (const { category, count } of rs.topCategories.slice(0, 5)) {
      lines.push(`  ${category}: ${count}`);
    }
  }

  if (rs.suggestedFixtureCandidates.length > 0) {
    lines.push("");
    lines.push(`Suggested fixture candidates: ${rs.suggestedFixtureCandidates.length}`);
    for (const q of rs.suggestedFixtureCandidates.slice(0, 5)) {
      lines.push(`  - "${q.slice(0, 70)}"`);
    }
    if (rs.suggestedFixtureCandidates.length > 5) {
      lines.push(`  ... and ${rs.suggestedFixtureCandidates.length - 5} more`);
    }
  }

  lines.push("");
  lines.push(`Fixture suggestions: ${ss.total}`);
  lines.push(
    `  High: ${ss.highConfidence}` +
    ` | Medium: ${ss.mediumConfidence}` +
    ` | Low: ${ss.lowConfidence}` +
    ` | Need review: ${ss.needingManualReview}`,
  );

  if (diag.warnings.length > 0) {
    lines.push("");
    lines.push(`Import warnings (${diag.warnings.length}):`);
    for (const w of diag.warnings.slice(0, 5)) {
      lines.push(`  - ${w}`);
    }
    if (diag.warnings.length > 5) {
      lines.push(`  ... and ${diag.warnings.length - 5} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Verbose output: default summary + per-query findings for failing/warning queries.
 */
export function formatVerbose(result: PipelineRunResult, fileCount = 0): string {
  const parts: string[] = [formatDefault(result, fileCount)];

  const interesting = result.reviewResults.filter((r) => r.hasFailures || r.hasWarnings);

  if (interesting.length === 0) {
    parts.push("\n(no failures or warnings found)");
    return parts.join("\n");
  }

  parts.push("\n=== Detailed Findings ===");

  for (const r of interesting) {
    const tag = r.hasFailures ? "FAIL" : "WARN";
    parts.push(`\n[${tag}] "${r.input.query.slice(0, 70)}"`);

    for (const f of r.findings) {
      if (f.severity === "info") continue;
      const sev = f.severity.toUpperCase();
      parts.push(`  [${sev}] ${f.check}: ${f.message}`);
    }
  }

  return parts.join("\n");
}

/**
 * Fixture mode: verbose output + rendered TypeScript fixture snippets.
 */
export function formatFixtures(result: PipelineRunResult, fileCount = 0): string {
  const parts: string[] = [formatVerbose(result, fileCount)];

  if (result.suggestions.length === 0) {
    parts.push("\n(no fixture suggestions generated)");
    return parts.join("\n");
  }

  parts.push("\n=== Fixture Suggestions ===");

  for (const s of result.suggestions) {
    parts.push("");
    parts.push(renderFixtureSuggestion(s));
  }

  return parts.join("\n");
}

/**
 * JSON mode: machine-readable structured output.
 * Contains import diagnostics, review summary, suggestion summary,
 * and a compact list of failing queries with their findings.
 */
export function formatJson(result: PipelineRunResult): string {
  const failedQueries = result.reviewResults
    .filter((r) => r.hasFailures)
    .map((r) => ({
      query: r.input.query,
      findings: r.findings
        .filter((f) => f.severity === "fail")
        .map((f) => ({ check: f.check, category: f.category, message: f.message })),
    }));

  const warnOnlyQueries = result.reviewResults
    .filter((r) => !r.hasFailures && r.hasWarnings)
    .map((r) => ({
      query: r.input.query,
      findings: r.findings
        .filter((f) => f.severity === "warn")
        .map((f) => ({ check: f.check, category: f.category, message: f.message })),
    }));

  return JSON.stringify(
    {
      import: result.importDiagnostics,
      review: result.reviewSummary,
      suggestions: result.suggestionSummary,
      failedQueries,
      warnOnlyQueries,
    },
    null,
    2,
  );
}
