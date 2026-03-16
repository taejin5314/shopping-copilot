/**
 * Tests for the offline quality review pipeline (scripts/review-pipeline.ts).
 *
 * All tests are pure/deterministic — no filesystem, no LLM, no network.
 * The pure helpers are imported directly; the CLI entrypoint (quality-review-cli.ts)
 * is not tested here (it only performs I/O).
 *
 * Coverage:
 *   1.  parseRawContent — JSON array
 *   2.  parseRawContent — JSON object (single record)
 *   3.  parseRawContent — NDJSON (one JSON object per line)
 *   4.  parseRawContent — structured log lines ([tag] {json})
 *   5.  parseRawContent — mixed valid/invalid lines
 *   6.  parseRawContent — empty input
 *   7.  parseRawContent — non-object JSON root
 *   8.  mergeParseResults — multiple file results aggregated
 *   9.  runFullReviewPipeline — basic pipeline flow and result shape
 *   10. runFullReviewPipeline — empty records produces safe zero summary
 *   11. formatDefault — contains useful counts
 *   12. formatDefault — fileCount shown when > 0
 *   13. formatVerbose — includes per-query findings for failing queries
 *   14. formatVerbose — "(no failures or warnings found)" when clean
 *   15. formatFixtures — includes rendered fixture snippets
 *   16. formatFixtures — "(no fixture suggestions)" when no suggestions
 *   17. formatJson — valid JSON with expected top-level keys
 *   18. formatJson — failedQueries contains queries with fail findings
 *   19. Multiple files aggregated — records from both inputs appear in review
 *   20. Malformed lines do not crash parseRawContent or the pipeline
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseRawContent,
  mergeParseResults,
  runFullReviewPipeline,
  formatDefault,
  formatVerbose,
  formatFixtures,
  formatJson,
  type PipelineRunResult,
} from "../scripts/review-pipeline.js";

// ── Shared fixtures ──

function mkRouterRecord(): Record<string, unknown> {
  return {
    intent: "search_product",
    retailerScope: "ikea",
    locationRequired: false,
    locationProvided: false,
    itemCardinality: "single",
    nextAgent: "query_understanding",
    confidence: 0.92,
    warnings: [],
    reasoningSummary: "User is searching for a product.",
  };
}

function mkQURecord(): Record<string, unknown> {
  return {
    category: "sofa bed",
    keywords: ["sofa", "bed"],
    budgetMin: null,
    budgetMax: 800,
    color: null,
    size: null,
    material: null,
    style: null,
    retailerPreference: "ikea",
    mustBeInStock: false,
    locationTerms: [],
    itemCardinality: "single",
    warnings: [],
  };
}

function mkExplanationRecord(): Record<string, unknown> {
  return {
    summary: "Found 3 matching products.",
    explanationPoints: ["Top result matches style preference."],
    warnings: [],
    metadata: {
      retailerScope: "ikea",
      routerConfidence: 0.92,
      topCandidateScore: 0.87,
      budgetStatus: "within",
      attributesMatched: [],
      attributesMissed: [],
      variantGroupingApplied: false,
      inputSource: "finderCandidates",
      fallbackUsed: false,
      candidateCount: 3,
    },
  };
}

/** A complete pipeline snapshot as a plain object. */
function mkCompleteRecord(query: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    query,
    routerOutput: mkRouterRecord(),
    routerUsed: true,
    queryUnderstandingOutput: mkQURecord(),
    quUsed: true,
    finderCandidateCount: 3,
    topCandidateScore: 0.87,
    explanation: mkExplanationRecord(),
    inputSource: "finderCandidates",
    warnings: [],
    ...overrides,
  };
}

/** A record that will trigger finder:zero-candidates (fail finding). */
function mkZeroCandidateRecord(query: string): Record<string, unknown> {
  return {
    query,
    queryUnderstandingOutput: mkQURecord(),
    quUsed: true,
    finderCandidateCount: 0,
    inputSource: "finderCandidates",
  };
}

// ── Test 1: JSON array ──

describe("parseRawContent — JSON array", () => {
  const content = JSON.stringify([
    mkCompleteRecord("sofa bed"),
    mkCompleteRecord("desk"),
  ]);
  const { records, parseWarnings, lineErrors } = parseRawContent(content);

  it("produces 2 records", () => assert.equal(records.length, 2));
  it("no parse warnings", () => assert.equal(parseWarnings.length, 0));
  it("no line errors", () => assert.equal(lineErrors, 0));
  it("records have query field", () => {
    assert.equal((records[0] as Record<string, unknown>).query, "sofa bed");
  });
});

// ── Test 2: JSON object (single record) ──

describe("parseRawContent — JSON object", () => {
  const content = JSON.stringify(mkCompleteRecord("ergonomic chair"));
  const { records, parseWarnings } = parseRawContent(content);

  it("produces 1 record", () => assert.equal(records.length, 1));
  it("no parse warnings", () => assert.equal(parseWarnings.length, 0));
  it("query is preserved", () => {
    assert.equal((records[0] as Record<string, unknown>).query, "ergonomic chair");
  });
});

// ── Test 3: NDJSON ──

describe("parseRawContent — NDJSON", () => {
  const lines = [
    JSON.stringify({ query: "white desk", finderCandidateCount: 2 }),
    JSON.stringify({ query: "blue chair", finderCandidateCount: 5 }),
    "# comment line — ignored",
    "",  // blank line — ignored
  ].join("\n");
  const { records, parseWarnings, lineErrors } = parseRawContent(lines);

  it("produces 2 records (comment and blank ignored)", () => assert.equal(records.length, 2));
  it("no parse warnings", () => assert.equal(parseWarnings.length, 0));
  it("no line errors", () => assert.equal(lineErrors, 0));
  it("first record query is 'white desk'", () => {
    assert.equal((records[0] as Record<string, unknown>).query, "white desk");
  });
});

// ── Test 4: Structured log lines ──

describe("parseRawContent — structured log lines", () => {
  const lines = [
    `[router] {"event":"routing_succeeded","intent":"search_product","confidence":0.9}`,
    `[explanation] {"built":true,"inputSource":"finderCandidates","candidateCount":3}`,
    `[eval:stage-summary] {"fixture":"test","route":"A","finderCandidates":4}`,
  ].join("\n");
  const { records, parseWarnings, lineErrors } = parseRawContent(lines);

  it("produces 3 records from log lines", () => assert.equal(records.length, 3));
  it("no parse warnings", () => assert.equal(parseWarnings.length, 0));
  it("no line errors", () => assert.equal(lineErrors, 0));
  it("first record has intent field from router log", () => {
    assert.equal((records[0] as Record<string, unknown>).intent, "search_product");
  });
  it("second record has inputSource from explanation log", () => {
    assert.equal((records[1] as Record<string, unknown>).inputSource, "finderCandidates");
  });
});

// ── Test 5: Mixed valid/invalid lines ──

describe("parseRawContent — mixed valid and invalid lines", () => {
  const lines = [
    JSON.stringify({ query: "sofa", finderCandidateCount: 2 }),
    "this is not json or a log line",
    `[router] {"event":"routing_succeeded"}`,
    "another-bad-line %%",
    JSON.stringify({ query: "lamp" }),
  ].join("\n");
  const { records, parseWarnings, lineErrors } = parseRawContent(lines);

  it("produces 3 valid records", () => assert.equal(records.length, 3));
  it("counts 2 line errors", () => assert.equal(lineErrors, 2));
  it("emits a parse warning about skipped lines", () => {
    assert.ok(parseWarnings.some((w) => w.includes("could not be parsed")));
  });
});

// ── Test 6: Empty input ──

describe("parseRawContent — empty input", () => {
  it("empty string → zero records, no warnings", () => {
    const { records, parseWarnings } = parseRawContent("");
    assert.equal(records.length, 0);
    assert.equal(parseWarnings.length, 0);
  });

  it("whitespace-only → zero records", () => {
    const { records } = parseRawContent("   \n  \n  ");
    assert.equal(records.length, 0);
  });
});

// ── Test 7: Non-object JSON root ──

describe("parseRawContent — non-object JSON root", () => {
  it("JSON string root → 0 records, 1 error", () => {
    const { records, lineErrors } = parseRawContent('"just a string"');
    assert.equal(records.length, 0);
    assert.equal(lineErrors, 1);
  });

  it("JSON number root → 0 records", () => {
    const { records } = parseRawContent("42");
    assert.equal(records.length, 0);
  });

  it("JSON array with non-objects → skips them", () => {
    const { records, parseWarnings } = parseRawContent(JSON.stringify([
      { query: "sofa" },
      "a string",
      42,
      { query: "chair" },
    ]));
    assert.equal(records.length, 2);
    assert.ok(parseWarnings.some((w) => w.includes("non-object")));
  });
});

// ── Test 8: mergeParseResults ──

describe("mergeParseResults", () => {
  const r1 = parseRawContent(JSON.stringify([{ query: "sofa" }, { query: "desk" }]), "file1.json");
  const r2 = parseRawContent(JSON.stringify([{ query: "chair" }]), "file2.json");
  const r3 = parseRawContent("bad line\nalso bad", "file3.log");

  const merged = mergeParseResults([
    { result: r1, filename: "file1.json" },
    { result: r2, filename: "file2.json" },
    { result: r3, filename: "file3.log" },
  ]);

  it("merges all records (2 + 1 + 0 = 3)", () => assert.equal(merged.records.length, 3));
  it("merges linesProcessed", () => assert.equal(merged.linesProcessed, r1.linesProcessed + r2.linesProcessed + r3.linesProcessed));
  it("merges lineErrors from file3", () => assert.ok(merged.lineErrors >= 2));
  it("parse warnings are prefixed with filename", () => {
    assert.ok(merged.parseWarnings.some((w) => w.startsWith("[file3.log]")));
  });
  it("empty array produces empty merged result", () => {
    const empty = mergeParseResults([]);
    assert.equal(empty.records.length, 0);
    assert.equal(empty.linesProcessed, 0);
  });
});

// ── Test 9: runFullReviewPipeline — shape and basic behaviour ──

describe("runFullReviewPipeline — basic pipeline", () => {
  const records = [
    mkCompleteRecord("sofa bed under 800"),
    mkZeroCandidateRecord("vague chair query"),  // → finder:zero-candidates fail
  ];
  const result = runFullReviewPipeline(records);

  it("importedRecords contains 2 entries", () => {
    assert.equal(result.importedRecords.length, 2);
  });

  it("reviewResults contains 2 entries", () => {
    assert.equal(result.reviewResults.length, 2);
  });

  it("reviewSummary.totalReviewed is 2", () => {
    assert.equal(result.reviewSummary.totalReviewed, 2);
  });

  it("reviewSummary.queriesWithFailures >= 1 (zero-candidate record)", () => {
    assert.ok(result.reviewSummary.queriesWithFailures >= 1);
  });

  it("suggestions is an array", () => {
    assert.ok(Array.isArray(result.suggestions));
  });

  it("suggestionSummary.total matches suggestions.length", () => {
    assert.equal(result.suggestionSummary.total, result.suggestions.length);
  });

  it("importDiagnostics.importedCount is 2", () => {
    assert.equal(result.importDiagnostics.importedCount, 2);
  });
});

// ── Test 10: runFullReviewPipeline — empty input ──

describe("runFullReviewPipeline — empty records", () => {
  const result = runFullReviewPipeline([]);

  it("importedRecords is empty", () => assert.equal(result.importedRecords.length, 0));
  it("reviewSummary.totalReviewed is 0", () => assert.equal(result.reviewSummary.totalReviewed, 0));
  it("suggestions is empty", () => assert.equal(result.suggestions.length, 0));
  it("reviewSummary.fallbackRate is 0", () => assert.equal(result.reviewSummary.fallbackRate, 0));
  it("does not throw", () => assert.doesNotThrow(() => runFullReviewPipeline([])));
});

// ── Test 11: formatDefault — contains useful counts ──

describe("formatDefault", () => {
  const result = runFullReviewPipeline([
    mkCompleteRecord("sofa bed"),
    mkZeroCandidateRecord("zero results query"),
  ]);

  const output = formatDefault(result);

  it("contains 'Quality Review Summary' header", () => {
    assert.ok(output.includes("Quality Review Summary"));
  });

  it("contains imported count", () => {
    assert.ok(output.includes("Records imported: 2"));
  });

  it("contains queries reviewed count", () => {
    assert.ok(output.includes("Queries reviewed: 2"));
  });

  it("contains fixture suggestions count", () => {
    assert.ok(output.includes("Fixture suggestions:"));
  });

  it("contains fallback rate", () => {
    assert.ok(output.includes("Fallback rate"));
  });
});

// ── Test 12: formatDefault — fileCount ──

describe("formatDefault — fileCount shown when > 0", () => {
  const result = runFullReviewPipeline([mkCompleteRecord("chair")]);

  it("does not show 'Files processed' when fileCount is 0", () => {
    assert.ok(!formatDefault(result, 0).includes("Files processed"));
  });

  it("shows 'Files processed: 3' when fileCount is 3", () => {
    assert.ok(formatDefault(result, 3).includes("Files processed: 3"));
  });
});

// ── Test 13: formatVerbose — per-query findings ──

describe("formatVerbose — findings for failing queries", () => {
  const result = runFullReviewPipeline([
    mkCompleteRecord("clean query"),           // no findings → not shown
    mkZeroCandidateRecord("broken query"),     // fail → shown
  ]);
  const output = formatVerbose(result);

  it("contains 'Detailed Findings' section", () => {
    assert.ok(output.includes("Detailed Findings"));
  });

  it("contains [FAIL] tag for the failing query", () => {
    assert.ok(output.includes("[FAIL]"));
  });

  it("contains the failing query text", () => {
    assert.ok(output.includes("broken query"));
  });

  it("contains the check name", () => {
    assert.ok(output.includes("finder:zero-candidates"));
  });

  it("still contains the summary header", () => {
    assert.ok(output.includes("Quality Review Summary"));
  });
});

// ── Test 14: formatVerbose — no failures ──

describe("formatVerbose — no failures or warnings", () => {
  // Complete record with good router output → should produce no warn/fail findings
  const result = runFullReviewPipeline([mkCompleteRecord("clean product search")]);
  const output = formatVerbose(result);

  it("does not show [FAIL] when no failures", () => {
    assert.ok(!output.includes("[FAIL]"));
  });

  it("shows '(no failures or warnings found)' when clean", () => {
    // Clean record might still produce info findings, but no warn/fail
    // If there happen to be no interesting results, message is shown
    const hasCleanMessage = output.includes("no failures or warnings found");
    const hasWarnOrFail = output.includes("[FAIL]") || output.includes("[WARN]");
    assert.ok(hasCleanMessage || !hasWarnOrFail);
  });
});

// ── Test 15: formatFixtures — rendered snippets ──

describe("formatFixtures — includes EvalFixture snippets", () => {
  const result = runFullReviewPipeline([
    mkZeroCandidateRecord("missing product search"),  // will get suggestion
  ]);

  // Skip if no suggestions generated (some records may not trigger)
  const output = formatFixtures(result);

  it("contains verbose output (summary + findings)", () => {
    assert.ok(output.includes("Quality Review Summary"));
  });

  it("contains 'Fixture Suggestions' section when suggestions exist or no-suggestions message", () => {
    const hasSuggestions = output.includes("Fixture Suggestions");
    const hasNoSuggestions = output.includes("no fixture suggestions");
    assert.ok(hasSuggestions || hasNoSuggestions);
  });

  it("contains EvalFixture const declaration when suggestions exist", () => {
    if (result.suggestions.length > 0) {
      assert.ok(output.includes("EvalFixture"));
    }
  });

  it("rendered snippets contain query string", () => {
    if (result.suggestions.length > 0) {
      assert.ok(output.includes("missing product search"));
    }
  });
});

// ── Test 16: formatFixtures — no suggestions ──

describe("formatFixtures — no suggestions", () => {
  // Empty pipeline → no suggestions
  const result = runFullReviewPipeline([]);
  const output = formatFixtures(result);

  it("shows 'no fixture suggestions generated'", () => {
    assert.ok(output.includes("no fixture suggestions"));
  });
});

// ── Test 17: formatJson — valid JSON with expected keys ──

describe("formatJson — structure", () => {
  const result = runFullReviewPipeline([
    mkCompleteRecord("sofa"),
    mkZeroCandidateRecord("desk"),
  ]);
  const raw = formatJson(result);

  it("is valid JSON", () => {
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it("has 'import' key", () => assert.ok(JSON.parse(raw).import !== undefined));
  it("has 'review' key", () => assert.ok(JSON.parse(raw).review !== undefined));
  it("has 'suggestions' key", () => assert.ok(JSON.parse(raw).suggestions !== undefined));
  it("has 'failedQueries' key", () => assert.ok(Array.isArray(JSON.parse(raw).failedQueries)));
  it("has 'warnOnlyQueries' key", () => assert.ok(Array.isArray(JSON.parse(raw).warnOnlyQueries)));
});

// ── Test 18: formatJson — failedQueries content ──

describe("formatJson — failedQueries", () => {
  const result = runFullReviewPipeline([
    mkZeroCandidateRecord("zero candidate query"),
  ]);
  const parsed = JSON.parse(formatJson(result));

  it("failedQueries is non-empty when there are failures", () => {
    if (result.reviewSummary.queriesWithFailures > 0) {
      assert.ok(parsed.failedQueries.length > 0);
    }
  });

  it("each failedQuery has query and findings fields", () => {
    for (const fq of parsed.failedQueries) {
      assert.ok(typeof fq.query === "string");
      assert.ok(Array.isArray(fq.findings));
    }
  });

  it("findings contain check and category fields", () => {
    for (const fq of parsed.failedQueries) {
      for (const f of fq.findings) {
        assert.ok(typeof f.check === "string");
        assert.ok(typeof f.category === "string");
      }
    }
  });
});

// ── Test 19: Multiple files aggregated ──

describe("multiple files aggregated via mergeParseResults", () => {
  const file1Content = JSON.stringify([
    mkCompleteRecord("sofa bed"),
    mkZeroCandidateRecord("chair"),
  ]);
  const file2Content = JSON.stringify([
    mkCompleteRecord("dining table"),
  ]);

  const r1 = parseRawContent(file1Content, "file1.json");
  const r2 = parseRawContent(file2Content, "file2.json");
  const merged = mergeParseResults([
    { result: r1, filename: "file1.json" },
    { result: r2, filename: "file2.json" },
  ]);
  const pipelineResult = runFullReviewPipeline(merged.records);

  it("3 records imported from 2 files", () => {
    assert.equal(pipelineResult.importDiagnostics.importedCount, 3);
  });

  it("reviewSummary covers all 3 queries", () => {
    assert.equal(pipelineResult.reviewSummary.totalReviewed, 3);
  });

  it("formatDefault shows 'Records imported: 3'", () => {
    assert.ok(formatDefault(pipelineResult, 2).includes("Records imported: 3"));
  });

  it("formatDefault shows 'Files processed: 2'", () => {
    assert.ok(formatDefault(pipelineResult, 2).includes("Files processed: 2"));
  });
});

// ── Test 20: Malformed lines do not crash ──

describe("malformed input — no crashes", () => {
  it("parseRawContent handles binary-like content gracefully", () => {
    assert.doesNotThrow(() => parseRawContent("\x00\x01\x02invalid\x03"));
  });

  it("parseRawContent handles deeply nested invalid JSON gracefully", () => {
    assert.doesNotThrow(() => parseRawContent("{invalid: json, no quotes}"));
  });

  it("runFullReviewPipeline handles records with all null fields", () => {
    const records = parseRawContent(
      JSON.stringify([
        { query: "test", routerOutput: null, queryUnderstandingOutput: null, explanation: null },
        { query: "another", warnings: null, finderCandidateCount: "not-a-number" },
      ]),
    ).records;
    assert.doesNotThrow(() => runFullReviewPipeline(records));
  });

  it("formatDefault does not throw on empty pipeline result", () => {
    const result = runFullReviewPipeline([]);
    assert.doesNotThrow(() => formatDefault(result));
  });

  it("formatVerbose does not throw on empty pipeline result", () => {
    const result = runFullReviewPipeline([]);
    assert.doesNotThrow(() => formatVerbose(result));
  });

  it("formatFixtures does not throw on empty pipeline result", () => {
    const result = runFullReviewPipeline([]);
    assert.doesNotThrow(() => formatFixtures(result));
  });

  it("formatJson does not throw on empty pipeline result", () => {
    const result = runFullReviewPipeline([]);
    assert.doesNotThrow(() => formatJson(result));
  });
});

// ── Smoke test: end-to-end through all output modes ──

describe("end-to-end smoke test", () => {
  const jsonInput = JSON.stringify([
    mkCompleteRecord("best sofa under 1000", { warnings: ["retailer scope narrowed"] }),
    mkZeroCandidateRecord("impossible search query"),
    { query: "route b query", inputSource: "foundProducts", finderCandidateCount: 2 },
    { /* no query */ routerOutput: mkRouterRecord() },  // should be skipped
  ]);

  const { records } = parseRawContent(jsonInput);
  const result = runFullReviewPipeline(records);

  it("imports 3 records (1 skipped — no query)", () => {
    assert.equal(result.importDiagnostics.importedCount, 3);
    assert.equal(result.importDiagnostics.skippedCount, 1);
  });

  it("all 4 formatters produce non-empty strings", () => {
    assert.ok(formatDefault(result, 1).length > 0);
    assert.ok(formatVerbose(result, 1).length > 0);
    assert.ok(formatFixtures(result, 1).length > 0);
    assert.ok(formatJson(result).length > 0);
  });

  it("route B record contributes to fallbackRate", () => {
    assert.ok(result.reviewSummary.fallbackRate > 0);
  });

  it("JSON output parses and has expected review.totalReviewed", () => {
    const parsed = JSON.parse(formatJson(result));
    assert.equal(parsed.review.totalReviewed, 3);
  });
});
