#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * CLI: extract golden ranking scenarios from capture log files.
 *
 * Reads one or more capture log files, imports them via the log-importer,
 * extracts GoldenScenario objects from records that contain a rankingSnapshot,
 * and prints reviewable output for human review before promoting to
 * test/golden-ranking-fixtures.ts.
 *
 * Usage:
 *   npx tsx scripts/extract-ranking-scenarios.ts [options] <file...>
 *
 * Options:
 *   --json, -j       Machine-readable JSON output (default: human-readable)
 *   --out=<path>     Write output to file instead of stdout
 *   --help, -h       Print this message
 *
 * Supported input formats (same as quality-review-cli):
 *   - JSON array file:   [{"query":"...", "rankingSnapshot":{...}}, ...]
 *   - JSON object file:  {"query":"...", "rankingSnapshot":{...}}
 *   - NDJSON:            one JSON object per line
 *   - Structured log:    [capture] {json} lines from pipeline console.error
 *
 * Examples:
 *   npx tsx scripts/extract-ranking-scenarios.ts run.log
 *   npx tsx scripts/extract-ranking-scenarios.ts --json run.log
 *   npx tsx scripts/extract-ranking-scenarios.ts --out=scenarios.json run.log
 *
 * Typical workflow:
 *   1. Run the app with makeLogExporter: `node app 2>run.log`
 *   2. Run this CLI:  `npx tsx scripts/extract-ranking-scenarios.ts run.log`
 *   3. Review the output — verify expectedOrder is correct
 *   4. Promote good scenarios to test/golden-ranking-fixtures.ts ALL_GOLDEN_SCENARIOS
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { groupAndImport, parseLogLine } from "../test/log-importer.js";
import { extractScenariosFromCaptures } from "../test/golden-ranking-fixtures.js";
import type { GoldenScenario } from "../test/golden-ranking-fixtures.js";
import type { RawCapturedRecord } from "../test/log-importer.js";

// ── Argument parsing ──

const rawArgs = process.argv.slice(2);
const filePaths: string[] = [];
let jsonMode = false;
let outPath: string | undefined;
let help = false;

for (const arg of rawArgs) {
  if (arg.startsWith("--out=")) { outPath = arg.slice("--out=".length); continue; }
  switch (arg) {
    case "--json": case "-j": jsonMode = true; break;
    case "--help": case "-h": help = true; break;
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
      "Usage: npx tsx scripts/extract-ranking-scenarios.ts [options] <file...>",
      "",
      "Options:",
      "  --json, -j       Machine-readable JSON output",
      "  --out=<path>     Write output to file instead of stdout",
      "  --help, -h       Print this message",
      "",
      "Examples:",
      "  npx tsx scripts/extract-ranking-scenarios.ts run.log",
      "  npx tsx scripts/extract-ranking-scenarios.ts --json run.log",
      "  npx tsx scripts/extract-ranking-scenarios.ts --out=scenarios.json run.log",
      "",
    ].join("\n"),
  );
  process.exit(help ? 0 : 1);
}

// ── File loading ──

/**
 * Parse raw file content into an array of RawCapturedRecord objects.
 * Supports JSON array, JSON object, NDJSON, and structured log lines.
 */
function parseFileContent(content: string, fileName: string): RawCapturedRecord[] {
  const records: RawCapturedRecord[] = [];
  const trimmed = content.trim();

  // ── Try JSON array first ──
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as RawCapturedRecord[];
    } catch {
      // fall through to line-by-line
    }
  }

  // ── Try JSON object (single record) ──
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return [parsed as RawCapturedRecord];
      }
    } catch {
      // fall through to line-by-line
    }
  }

  // ── Line-by-line: NDJSON or structured log ──
  let logLineCount = 0;
  let ndjsonCount = 0;
  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Structured log: [tag] {json}
    const parsed = parseLogLine(trimmedLine);
    if (parsed !== null) {
      // Only capture-tagged lines contain rankingSnapshot — but import all
      // so groupAndImport can merge multi-line records with the same requestId.
      records.push(parsed.body);
      logLineCount++;
      continue;
    }

    // NDJSON: bare JSON object per line
    if (trimmedLine.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmedLine);
        if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
          records.push(obj as RawCapturedRecord);
          ndjsonCount++;
        }
      } catch {
        // skip malformed line
      }
    }
  }

  if (records.length === 0) {
    process.stderr.write(`[extract] ${fileName}: no parseable records found\n`);
  } else {
    const fmt = logLineCount > 0 ? "structured-log" : "ndjson";
    process.stderr.write(`[extract] ${fileName}: parsed ${records.length} records (${fmt})\n`);
  }
  return records;
}

// ── Load files ──

const allRaw: RawCapturedRecord[] = [];
for (const filePath of filePaths) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const records = parseFileContent(content, basename(filePath));
    allRaw.push(...records);
  } catch (err) {
    process.stderr.write(`[extract] Failed to read ${filePath}: ${String(err)}\n`);
    process.exit(1);
  }
}

// ── Import + extract ──

const { records: imported, diagnostics } = groupAndImport(allRaw);

process.stderr.write(
  `[extract] Import: ${diagnostics.importedCount} records imported, ` +
  `${diagnostics.skippedCount} skipped, ${diagnostics.partialImports} partial\n`,
);

// extractScenariosFromCaptures accepts anything with { rankingSnapshot?, id?, timestamp?, query }
// PipelineReviewInput satisfies this structurally.
const scenarios = extractScenariosFromCaptures(
  imported as Parameters<typeof extractScenariosFromCaptures>[0],
);

process.stderr.write(`[extract] Found ${scenarios.length} scenario(s) with rankingSnapshot\n`);

if (scenarios.length === 0) {
  process.stderr.write(
    "[extract] No scenarios extracted. Make sure the app uses makeLogExporter() and\n" +
    "          that stock/ranking paths ran at least once.\n",
  );
  process.exit(0);
}

// ── Format output ──

function formatHuman(list: GoldenScenario[]): string {
  const lines: string[] = [
    `Extracted ${list.length} golden ranking scenario(s)`,
    "─".repeat(60),
    "",
    "⚠  REVIEW before promoting to ALL_GOLDEN_SCENARIOS:",
    "   Verify that expectedOrder reflects the CORRECT ranking,",
    "   not just what the app happened to produce.",
    "",
  ];

  for (const [i, s] of list.entries()) {
    lines.push(`── Scenario ${i + 1}: ${s.name}`);
    lines.push(`   source       : ${s.source}`);
    lines.push(`   expectedOrder: ${s.expectedOrder.join(" > ")}`);
    lines.push(`   cart         : ${s.cart.map((c) => `${c.itemNo}×${c.quantity}`).join(", ")}`);
    lines.push(`   stores (${s.stores.length})`);
    for (const st of s.stores) {
      const items = st.items
        .map((i) => `${i.itemNo}:${i.quantity ?? "?"} (${i.stockLevel ?? "known"})`)
        .join(", ");
      const coords = st.store.coords
        ? `lat=${st.store.coords.lat.toFixed(4)},lng=${st.store.coords.lng.toFixed(4)}`
        : "no-coords";
      lines.push(`     [${st.store.storeId}] ${items} @ ${coords}`);
    }
    lines.push("");
  }

  lines.push("── Promote to ALL_GOLDEN_SCENARIOS in test/golden-ranking-fixtures.ts");
  lines.push("   (remove ctx.getItemPrice if not available from logs)");

  return lines.join("\n");
}

function formatJson(list: GoldenScenario[]): string {
  // ctx.getItemPrice is a function — strip it before serialization
  const serializable = list.map((s) => ({
    name: s.name,
    source: s.source,
    stores: s.stores,
    cart: s.cart,
    expectedOrder: s.expectedOrder,
    _note: "ctx not serialized — add userLocation manually if needed",
  }));
  return JSON.stringify(serializable, null, 2);
}

const output = jsonMode ? formatJson(scenarios) : formatHuman(scenarios);

// ── Write output ──

if (outPath) {
  try {
    writeFileSync(outPath, output, "utf-8");
    process.stderr.write(`[extract] Output written to ${outPath}\n`);
  } catch (err) {
    process.stderr.write(`[extract] Failed to write ${outPath}: ${String(err)}\n`);
    process.exit(1);
  }
} else {
  process.stdout.write(output + "\n");
}
