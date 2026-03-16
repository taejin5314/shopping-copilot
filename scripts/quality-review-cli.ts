#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Offline quality review CLI.
 *
 * Usage:
 *   tsx scripts/quality-review-cli.ts [options] <file...>
 *
 * Options:
 *   --verbose, -v                  Show per-query findings
 *   --fixtures, -f                 Include rendered EvalFixture snippets
 *   --json, -j                     Machine-readable JSON output
 *   --gate, -g                     Enable CI quality gate (exits 1 on failure)
 *   --summary-file=<path>          Write GFM job summary to this file
 *   --help, -h                     Print this message
 *
 * Gate threshold overrides (used with --gate):
 *   --max-failed=<N>               Max queries with fail findings     (default: 0)
 *   --max-warn=<N>                 Max queries with warn-only findings (default: ∞)
 *   --max-fallback=<0-1>           Max Route B fallback rate           (default: 1.0)
 *   --max-router-failures=<N>      Max router-category failures        (default: ∞)
 *   --max-explanation-failures=<N> Max explanation-category failures   (default: ∞)
 *   --max-zero-candidates=<N>      Max finder:zero-candidates queries  (default: ∞)
 *   --max-excessive-warnings=<N>   Max warnings:excessive queries      (default: ∞)
 *   --max-skipped=<N>              Max skipped import records          (default: ∞)
 *   --max-partial=<N>              Max partial import records          (default: ∞)
 *
 * Summary file:
 *   When $GITHUB_STEP_SUMMARY is set (GitHub Actions) or --summary-file is
 *   passed, a GFM job summary is appended to that file after the main output.
 *   If writing fails, the error is logged to stderr and the CLI exits normally.
 *
 * Supported input formats:
 *   - JSON array file           [{"query":"...", ...}, ...]
 *   - JSON object file          {"query":"...", ...}
 *   - NDJSON / line-delimited   one JSON object per line
 *   - Structured log file       [tag] {json} lines from pipeline console.error
 *
 * Examples:
 *   tsx scripts/quality-review-cli.ts captured.json
 *   tsx scripts/quality-review-cli.ts --verbose run1.json run2.json
 *   tsx scripts/quality-review-cli.ts --gate --max-failed=0 --max-fallback=0.3 data.json
 *   tsx scripts/quality-review-cli.ts --gate --json output.json
 *   tsx scripts/quality-review-cli.ts --gate --summary-file=summary.md data.json
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  parseRawContent,
  mergeParseResults,
  runFullReviewPipeline,
  formatDefault,
  formatVerbose,
  formatFixtures,
  formatJson,
} from "./review-pipeline.js";

import {
  evaluateGate,
  parseThresholdsFromArgv,
  formatGateResult,
  gateResultToJson,
} from "./quality-gate.js";

import { renderJobSummary } from "./summary-renderer.js";
import { resolveSummaryTarget, writeSummary } from "./summary-writer.js";

// ── Argument parsing ──

const rawArgs = process.argv.slice(2);
const filePaths: string[] = [];
const thresholdArgs: string[] = [];
let verbose = false;
let fixtures = false;
let jsonMode = false;
let gateMode = false;
let help = false;

for (const arg of rawArgs) {
  if (arg.startsWith("--max-")) { thresholdArgs.push(arg); continue; }
  switch (arg) {
    case "--verbose":  case "-v": verbose = true; break;
    case "--fixtures": case "-f": fixtures = true; break;
    case "--json":     case "-j": jsonMode = true; break;
    case "--gate":     case "-g": gateMode = true; break;
    case "--help":     case "-h": help = true; break;
    default:
      if (arg.startsWith("-")) {
        process.stderr.write(`Unknown option: ${arg}\n`);
      } else {
        filePaths.push(arg);
      }
  }
}

if (help || filePaths.length === 0) {
  process.stdout.write(
    [
      "Usage: tsx scripts/quality-review-cli.ts [options] <file...>",
      "",
      "Options:",
      "  --verbose, -v    Show per-query findings",
      "  --fixtures, -f   Include rendered EvalFixture snippets",
      "  --json, -j       Machine-readable JSON output",
      "  --gate, -g       Enable CI quality gate (exits 1 on threshold breach)",
      "  --help, -h       Print this message",
      "",
      "Gate threshold overrides (used with --gate):",
      "  --max-failed=<N>               Max queries with fail findings     (default: 0)",
      "  --max-warn=<N>                 Max queries with warn-only findings (default: ∞)",
      "  --max-fallback=<0-1>           Max Route B fallback rate           (default: 1.0)",
      "  --max-router-failures=<N>      Max router-category failures        (default: ∞)",
      "  --max-explanation-failures=<N> Max explanation-category failures   (default: ∞)",
      "  --max-zero-candidates=<N>      Max finder:zero-candidates queries  (default: ∞)",
      "  --max-excessive-warnings=<N>   Max warnings:excessive queries      (default: ∞)",
      "  --max-skipped=<N>              Max skipped import records          (default: ∞)",
      "  --max-partial=<N>              Max partial import records          (default: ∞)",
      "",
      "Supported input formats:",
      "  JSON array, JSON object, NDJSON, [tag] {json} log lines",
      "",
    ].join("\n"),
  );
  process.exit(filePaths.length === 0 && !help ? 1 : 0);
}

// ── Read and parse files ──

type FileResult = { result: ReturnType<typeof parseRawContent>; filename: string };
const fileResults: FileResult[] = [];

for (const filePath of filePaths) {
  const filename = basename(filePath);
  let content: string;

  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[error] Cannot read "${filePath}": ${msg}\n`);
    continue;
  }

  const result = parseRawContent(content, filename);
  fileResults.push({ result, filename });

  if (result.parseWarnings.length > 0 && !jsonMode) {
    for (const w of result.parseWarnings) {
      process.stderr.write(`[parse-warn] ${filename}: ${w}\n`);
    }
  }
}

if (fileResults.length === 0) {
  process.stderr.write("[error] No files could be read. Exiting.\n");
  process.exit(1);
}

// ── Merge and run pipeline ──

const merged = mergeParseResults(fileResults.map(({ result, filename }) => ({ result, filename })));
const pipelineResult = runFullReviewPipeline(merged.records);

// ── Quality gate (optional) ──

const thresholds = gateMode ? parseThresholdsFromArgv(thresholdArgs) : undefined;
const gateResult = gateMode
  ? evaluateGate(
      pipelineResult.reviewSummary,
      pipelineResult.importDiagnostics,
      pipelineResult.reviewResults,
      thresholds,
    )
  : null;

// ── Output ──

const fileCount = fileResults.length;

if (jsonMode) {
  // Build combined JSON: pipeline output + optional gate result
  const pipelineJson = JSON.parse(formatJson(pipelineResult)) as Record<string, unknown>;
  if (gateResult) pipelineJson.gate = gateResultToJson(gateResult);
  process.stdout.write(JSON.stringify(pipelineJson, null, 2) + "\n");
} else if (fixtures) {
  process.stdout.write(formatFixtures(pipelineResult, fileCount) + "\n");
  if (gateResult) process.stdout.write("\n" + formatGateResult(gateResult) + "\n");
} else if (verbose) {
  process.stdout.write(formatVerbose(pipelineResult, fileCount) + "\n");
  if (gateResult) process.stdout.write("\n" + formatGateResult(gateResult) + "\n");
} else {
  process.stdout.write(formatDefault(pipelineResult, fileCount) + "\n");
  if (gateResult) process.stdout.write("\n" + formatGateResult(gateResult) + "\n");
}

// ── Job summary (optional, non-fatal) ──

const summaryTarget = resolveSummaryTarget(rawArgs);
if (summaryTarget.kind !== "none") {
  const markdown = renderJobSummary(pipelineResult, gateResult);
  const writeErr = writeSummary(markdown, summaryTarget);
  if (writeErr) {
    process.stderr.write(`[warn] Could not write job summary: ${writeErr.message}\n`);
  }
}

// ── Exit code ──

if (gateResult && !gateResult.passed) {
  process.exit(1);
}
