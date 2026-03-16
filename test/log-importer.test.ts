/**
 * Tests for the log/import adapter.
 *
 * Covers:
 *   1.  Single complete pipeline snapshot → full PipelineReviewInput
 *   2.  CopilotResponse-like object → maps products/answer/explanation
 *   3.  Partial records (router-only, QU-only, explanation-only)
 *   4.  Grouping multiple log records by requestId into one PipelineReviewInput
 *   5.  Grouping by query string when no ID is available
 *   6.  Missing query → skipped (input: null)
 *   7.  Conflicting stage records in a group → first valid wins
 *   8.  Warnings preserved and deduplicated across grouped records
 *   9.  Route A (finderCandidates) hint derived correctly
 *   10. Route B (foundProducts) hint derived correctly
 *   11. inputSource derived from explanation.metadata fallback
 *   12. isCartIntent derived from QU itemCardinality
 *   13. Importer diagnostics counts are correct
 *   14. Malformed / null inputs do not throw
 *   15. parseLogLine parses valid log lines and rejects invalid ones
 *   16. summarizeImportedRecords produces readable text
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  importRecord,
  importRecords,
  groupAndImport,
  parseLogLine,
  summarizeImportedRecords,
  type RawCapturedRecord,
} from "./log-importer.js";

// ── Fixture builders ──

function mkFullRouterOutput(): Record<string, unknown> {
  return {
    intent: "search_product",
    retailerScope: "ikea",
    locationRequired: false,
    locationProvided: false,
    itemCardinality: "single",
    nextAgent: "query_understanding",
    confidence: 0.9,
    warnings: [],
    reasoningSummary: "User is searching for a product at ikea.",
  };
}

function mkFullQUOutput(): Record<string, unknown> {
  return {
    category: "sofa bed",
    keywords: ["sofa", "bed", "convertible"],
    budgetMin: null,
    budgetMax: 800,
    color: "dark blue",
    size: null,
    material: null,
    style: "minimalist",
    retailerPreference: "ikea",
    mustBeInStock: false,
    locationTerms: [],
    itemCardinality: "single",
    warnings: [],
  };
}

function mkFullExplanationOutput(): Record<string, unknown> {
  return {
    summary: "Found 3 matching sofa beds at IKEA.",
    explanationPoints: ["Top result matches your style preference.", "Price is within budget."],
    warnings: [],
    metadata: {
      retailerScope: "ikea",
      routerConfidence: 0.9,
      topCandidateScore: 0.85,
      budgetStatus: "within",
      attributesMatched: ["style"],
      attributesMissed: [],
      variantGroupingApplied: true,
      inputSource: "finderCandidates",
      fallbackUsed: false,
      candidateCount: 3,
    },
  };
}

// ── Test 1: Single complete pipeline snapshot ──

describe("importRecord — complete pipeline snapshot", () => {
  const raw: RawCapturedRecord = {
    requestId: "req-001",
    timestamp: "2026-03-16T10:00:00Z",
    query: "comfortable sofa bed under 800",
    routerOutput: mkFullRouterOutput(),
    routerUsed: true,
    queryUnderstandingOutput: mkFullQUOutput(),
    quUsed: true,
    finderCandidateCount: 3,
    topCandidateScore: 0.85,
    explanation: mkFullExplanationOutput(),
    inputSource: "finderCandidates",
    isCartIntent: false,
    warnings: ["low adapter confidence"],
    finalAnswerSummary: "Here are 3 sofa beds that fit your budget.",
  };

  const { input, importWarnings, isPartial } = importRecord(raw);

  it("produces a non-null input", () => {
    assert.ok(input !== null);
  });

  it("maps query", () => {
    assert.equal(input!.query, "comfortable sofa bed under 800");
  });

  it("maps id from requestId", () => {
    assert.equal(input!.id, "req-001");
  });

  it("maps timestamp", () => {
    assert.equal(input!.timestamp, "2026-03-16T10:00:00Z");
  });

  it("maps routerOutput with correct intent", () => {
    assert.equal(input!.routerOutput?.intent, "search_product");
    assert.equal(input!.routerOutput?.retailerScope, "ikea");
    assert.equal(input!.routerOutput?.confidence, 0.9);
  });

  it("maps routerUsed", () => {
    assert.equal(input!.routerUsed, true);
  });

  it("maps queryUnderstandingOutput", () => {
    assert.equal(input!.queryUnderstandingOutput?.category, "sofa bed");
    assert.deepEqual(input!.queryUnderstandingOutput?.keywords, ["sofa", "bed", "convertible"]);
  });

  it("maps quUsed", () => {
    assert.equal(input!.quUsed, true);
  });

  it("maps finderCandidateCount", () => {
    assert.equal(input!.finderCandidateCount, 3);
  });

  it("maps topCandidateScore", () => {
    assert.equal(input!.topCandidateScore, 0.85);
  });

  it("maps explanation summary", () => {
    assert.equal(input!.explanation?.summary, "Found 3 matching sofa beds at IKEA.");
  });

  it("maps inputSource", () => {
    assert.equal(input!.inputSource, "finderCandidates");
  });

  it("maps isCartIntent", () => {
    assert.equal(input!.isCartIntent, false);
  });

  it("maps warnings", () => {
    assert.deepEqual(input!.warnings, ["low adapter confidence"]);
  });

  it("maps finalAnswerSummary", () => {
    assert.equal(input!.finalAnswerSummary, "Here are 3 sofa beds that fit your budget.");
  });

  it("has no import warnings", () => {
    assert.equal(importWarnings.length, 0);
  });

  it("isPartial is false", () => {
    assert.equal(isPartial, false);
  });
});

// ── Test 2: CopilotResponse-like object ──

describe("importRecord — CopilotResponse-like object", () => {
  const raw: RawCapturedRecord = {
    query: "blue dining table",
    answer: "Here are some dining tables I found for you.",
    products: [
      { name: "Table A", itemNo: "123", retailer: "ikea" },
      { name: "Table B", itemNo: "456", retailer: "ikea" },
    ],
    explanation: mkFullExplanationOutput(),
    warnings: ["one adapter failed"],
  };

  const { input } = importRecord(raw);

  it("produces non-null input", () => assert.ok(input !== null));

  it("uses answer as finalAnswerSummary", () => {
    assert.equal(input!.finalAnswerSummary, "Here are some dining tables I found for you.");
  });

  it("derives finderCandidateCount from products array length", () => {
    assert.equal(input!.finderCandidateCount, 2);
  });

  it("maps explanation", () => {
    assert.ok(input!.explanation !== undefined);
  });

  it("maps warnings", () => {
    assert.deepEqual(input!.warnings, ["one adapter failed"]);
  });
});

// ── Test 3: Partial records ──

describe("importRecord — router-only snapshot", () => {
  const raw: RawCapturedRecord = {
    query: "ergonomic office chair",
    routerOutput: mkFullRouterOutput(),
    routerUsed: true,
  };
  const { input, isPartial } = importRecord(raw);

  it("produces non-null input", () => assert.ok(input !== null));
  it("maps routerOutput", () => assert.equal(input!.routerOutput?.intent, "search_product"));
  it("queryUnderstandingOutput is absent", () => assert.equal(input!.queryUnderstandingOutput, undefined));
  it("explanation is absent", () => assert.equal(input!.explanation, undefined));
  it("isPartial is false (no failed fields)", () => assert.equal(isPartial, false));
});

describe("importRecord — QU-only snapshot", () => {
  const raw: RawCapturedRecord = {
    query: "oak dining table",
    queryUnderstandingOutput: mkFullQUOutput(),
    quUsed: true,
  };
  const { input } = importRecord(raw);

  it("produces non-null input", () => assert.ok(input !== null));
  it("maps queryUnderstandingOutput", () => assert.equal(input!.queryUnderstandingOutput?.category, "sofa bed"));
  it("routerOutput is absent", () => assert.equal(input!.routerOutput, undefined));
});

describe("importRecord — explanation-only snapshot", () => {
  const raw: RawCapturedRecord = {
    query: "minimalist desk",
    explanation: mkFullExplanationOutput(),
    warnings: ["adapter timed out"],
  };
  const { input } = importRecord(raw);

  it("produces non-null input", () => assert.ok(input !== null));
  it("maps explanation", () => assert.equal(input!.explanation?.summary, "Found 3 matching sofa beds at IKEA."));
  it("derives inputSource from explanation.metadata", () => {
    assert.equal(input!.inputSource, "finderCandidates");
  });
});

// ── Test 4: Grouping by requestId ──

describe("groupAndImport — multiple records with same requestId", () => {
  const records: RawCapturedRecord[] = [
    {
      requestId: "req-abc",
      query: "white bookshelf 60cm",
      routerOutput: mkFullRouterOutput(),
      routerUsed: true,
    },
    {
      requestId: "req-abc",
      queryUnderstandingOutput: mkFullQUOutput(),
      quUsed: true,
      finderCandidateCount: 5,
    },
    {
      requestId: "req-abc",
      explanation: mkFullExplanationOutput(),
      warnings: ["retailer scope narrowed"],
    },
  ];

  const { records: imported, diagnostics } = groupAndImport(records);

  it("produces exactly 1 record from 3 grouped inputs", () => {
    assert.equal(imported.length, 1);
  });

  it("groupedCount is 1 (one multi-record group)", () => {
    assert.equal(diagnostics.groupedCount, 1);
  });

  it("merged record has query from first record", () => {
    assert.equal(imported[0].query, "white bookshelf 60cm");
  });

  it("merged record has routerOutput from first record", () => {
    assert.equal(imported[0].routerOutput?.intent, "search_product");
  });

  it("merged record has queryUnderstandingOutput from second record", () => {
    assert.equal(imported[0].queryUnderstandingOutput?.category, "sofa bed");
  });

  it("merged record has explanation from third record", () => {
    assert.ok(imported[0].explanation !== undefined);
  });

  it("merged record has finderCandidateCount from second record", () => {
    assert.equal(imported[0].finderCandidateCount, 5);
  });

  it("merged record has warnings from third record", () => {
    assert.deepEqual(imported[0].warnings, ["retailer scope narrowed"]);
  });

  it("importedCount is 1", () => {
    assert.equal(diagnostics.importedCount, 1);
  });
});

// ── Test 5: Grouping by query string (no ID) ──

describe("groupAndImport — multiple records with same query, no ID", () => {
  const records: RawCapturedRecord[] = [
    { query: "leather sofa", routerOutput: mkFullRouterOutput() },
    { query: "leather sofa", queryUnderstandingOutput: mkFullQUOutput() },
  ];

  const { records: imported, diagnostics } = groupAndImport(records);

  it("groups into 1 record", () => {
    assert.equal(imported.length, 1);
  });

  it("groupedCount is 1", () => {
    assert.equal(diagnostics.groupedCount, 1);
  });

  it("merged record has both router and QU output", () => {
    assert.ok(imported[0].routerOutput !== undefined);
    assert.ok(imported[0].queryUnderstandingOutput !== undefined);
  });
});

// ── Test 6: Missing query → skipped ──

describe("importRecord — missing query", () => {
  it("returns null when no query field", () => {
    const { input } = importRecord({ routerOutput: mkFullRouterOutput() });
    assert.equal(input, null);
  });

  it("returns null for empty query", () => {
    const { input } = importRecord({ query: "   " });
    assert.equal(input, null);
  });

  it("accepts rawQuery alias", () => {
    const { input } = importRecord({ rawQuery: "leather sectional" });
    assert.ok(input !== null);
    assert.equal(input!.query, "leather sectional");
  });

  it("accepts userQuery alias", () => {
    const { input } = importRecord({ userQuery: "recliner chairs" });
    assert.ok(input !== null);
    assert.equal(input!.query, "recliner chairs");
  });
});

// ── Test 7: Conflicting stage records in a group → first valid wins ──

describe("groupAndImport — conflicting routerOutput in group", () => {
  const firstRouter = { ...mkFullRouterOutput(), confidence: 0.95, retailerScope: "ikea" };
  const secondRouter = { ...mkFullRouterOutput(), confidence: 0.6, retailerScope: "structube" };

  const records: RawCapturedRecord[] = [
    { requestId: "req-x", query: "standing desk", routerOutput: firstRouter },
    { requestId: "req-x", routerOutput: secondRouter },
  ];

  const { records: imported } = groupAndImport(records);

  it("produces 1 record", () => assert.equal(imported.length, 1));

  it("uses first routerOutput (confidence 0.95, scope ikea)", () => {
    assert.equal(imported[0].routerOutput?.confidence, 0.95);
    assert.equal(imported[0].routerOutput?.retailerScope, "ikea");
  });
});

// ── Test 8: Warnings preserved and deduplicated across grouped records ──

describe("groupAndImport — warnings merged and deduplicated", () => {
  const records: RawCapturedRecord[] = [
    { requestId: "req-y", query: "coffee table", warnings: ["adapter timeout", "low confidence"] },
    { requestId: "req-y", warnings: ["low confidence", "no results found"] },
    { requestId: "req-y", warnings: ["no results found", "budget not specified"] },
  ];

  const { records: imported } = groupAndImport(records);
  const warnings = imported[0].warnings ?? [];

  it("deduplicated warnings contain 4 unique entries", () => {
    assert.equal(warnings.length, 4);
  });

  it("contains 'adapter timeout'", () => assert.ok(warnings.includes("adapter timeout")));
  it("contains 'low confidence' once", () => {
    assert.equal(warnings.filter((w) => w === "low confidence").length, 1);
  });
  it("contains 'no results found' once", () => {
    assert.equal(warnings.filter((w) => w === "no results found").length, 1);
  });
  it("contains 'budget not specified'", () => assert.ok(warnings.includes("budget not specified")));
});

// ── Test 9: Route A hint derived correctly ──

describe("importRecord — Route A (finderCandidates) derived", () => {
  it("explicit inputSource finderCandidates → Route A", () => {
    const { input } = importRecord({
      query: "sofa",
      inputSource: "finderCandidates",
    });
    assert.equal(input!.inputSource, "finderCandidates");
  });

  it("'A' shorthand → finderCandidates", () => {
    const { input } = importRecord({ query: "chair", inputSource: "A" });
    assert.equal(input!.inputSource, "finderCandidates");
  });

  it("QU present + no explicit inputSource → infers finderCandidates", () => {
    const { input } = importRecord({
      query: "bookcase",
      queryUnderstandingOutput: mkFullQUOutput(),
    });
    assert.equal(input!.inputSource, "finderCandidates");
  });
});

// ── Test 10: Route B (foundProducts) hint derived correctly ──

describe("importRecord — Route B (foundProducts) derived", () => {
  it("explicit inputSource foundProducts → Route B", () => {
    const { input } = importRecord({
      query: "table",
      inputSource: "foundProducts",
    });
    assert.equal(input!.inputSource, "foundProducts");
  });

  it("'B' shorthand → foundProducts", () => {
    const { input } = importRecord({ query: "lamp", inputSource: "B" });
    assert.equal(input!.inputSource, "foundProducts");
  });

  it("'routeB' string → foundProducts", () => {
    const { input } = importRecord({ query: "rug", inputSource: "routeB" });
    assert.equal(input!.inputSource, "foundProducts");
  });
});

// ── Test 11: inputSource derived from explanation.metadata ──

describe("importRecord — inputSource derived from explanation metadata", () => {
  it("derives foundProducts from explanation.metadata.inputSource", () => {
    const explanation = {
      ...mkFullExplanationOutput(),
      metadata: { ...((mkFullExplanationOutput() as Record<string, unknown>).metadata as Record<string, unknown>), inputSource: "foundProducts" },
    };
    const { input } = importRecord({ query: "rug", explanation });
    assert.equal(input!.inputSource, "foundProducts");
  });

  it("null inputSource in explanation metadata → null inputSource", () => {
    const explanation = {
      ...mkFullExplanationOutput(),
      metadata: { ...((mkFullExplanationOutput() as Record<string, unknown>).metadata as Record<string, unknown>), inputSource: null },
    };
    const { input } = importRecord({ query: "mat", explanation });
    assert.equal(input!.inputSource, null);
  });
});

// ── Test 12: isCartIntent derived from QU itemCardinality ──

describe("importRecord — isCartIntent derived from QU", () => {
  it("quOutput.itemCardinality='multiple' → isCartIntent=true", () => {
    const qu = { ...mkFullQUOutput(), itemCardinality: "multiple" };
    const { input } = importRecord({ query: "desk and chair", queryUnderstandingOutput: qu });
    assert.equal(input!.isCartIntent, true);
  });

  it("quOutput.itemCardinality='single' → isCartIntent=false", () => {
    const qu = { ...mkFullQUOutput(), itemCardinality: "single" };
    const { input } = importRecord({ query: "single desk", queryUnderstandingOutput: qu });
    assert.equal(input!.isCartIntent, false);
  });

  it("explicit isCartIntent field takes precedence over QU", () => {
    const qu = { ...mkFullQUOutput(), itemCardinality: "multiple" };
    const { input } = importRecord({
      query: "desk set",
      queryUnderstandingOutput: qu,
      isCartIntent: false,
    });
    assert.equal(input!.isCartIntent, false);
  });

  it("routerOutput.itemCardinality='multiple' also sets isCartIntent when no QU", () => {
    const ro = { ...mkFullRouterOutput(), itemCardinality: "multiple" };
    const { input } = importRecord({ query: "multiple items", routerOutput: ro });
    assert.equal(input!.isCartIntent, true);
  });
});

// ── Test 13: Diagnostics counts ──

describe("importRecords — diagnostics counts", () => {
  const raws: RawCapturedRecord[] = [
    // 1: valid complete record
    { query: "sofa", routerOutput: mkFullRouterOutput(), explanation: mkFullExplanationOutput() },
    // 2: valid partial (QU only)
    { query: "chair", queryUnderstandingOutput: mkFullQUOutput() },
    // 3: missing query → skipped
    { routerOutput: mkFullRouterOutput() },
    // 4: invalid routerOutput → partial
    { query: "table", routerOutput: { intent: "bad_intent", confidence: "not-a-number" } },
    // 5: another valid record
    { query: "lamp", warnings: ["note"] },
  ];

  const { records, diagnostics } = importRecords(raws);

  it("importedCount is 4 (3 skipped)", () => {
    assert.equal(diagnostics.importedCount, 4);
  });

  it("skippedCount is 1 (missing query)", () => {
    assert.equal(diagnostics.skippedCount, 1);
  });

  it("recordsMissingQuery is 1", () => {
    assert.equal(diagnostics.recordsMissingQuery, 1);
  });

  it("partialImports is 1 (bad routerOutput)", () => {
    assert.equal(diagnostics.partialImports, 1);
  });

  it("groupedCount is 0 (importRecords, no grouping)", () => {
    assert.equal(diagnostics.groupedCount, 0);
  });

  it("warnings contains routerOutput shape failure", () => {
    assert.ok(diagnostics.warnings.some((w) => w.includes("routerOutput failed shape check")));
  });

  it("records array has correct length", () => {
    assert.equal(records.length, 4);
  });
});

describe("groupAndImport — diagnostics groupedCount", () => {
  const raws: RawCapturedRecord[] = [
    { requestId: "r1", query: "sofa", routerOutput: mkFullRouterOutput() },
    { requestId: "r1", queryUnderstandingOutput: mkFullQUOutput() },
    { requestId: "r2", query: "chair" },
    { requestId: "r2", explanation: mkFullExplanationOutput() },
    { query: "standalone lamp" }, // no requestId, standalone
  ];

  const { diagnostics } = groupAndImport(raws);

  it("groupedCount is 2 (two multi-record groups)", () => {
    assert.equal(diagnostics.groupedCount, 2);
  });

  it("importedCount is 3 (2 groups + 1 standalone)", () => {
    assert.equal(diagnostics.importedCount, 3);
  });
});

// ── Test 14: Malformed / null inputs do not throw ──

describe("importRecord — malformed inputs do not throw", () => {
  const cases: [string, RawCapturedRecord][] = [
    ["empty object", {}],
    ["null routerOutput", { query: "sofa", routerOutput: null }],
    ["null quOutput", { query: "sofa", queryUnderstandingOutput: null }],
    ["null explanation", { query: "sofa", explanation: null }],
    ["array routerOutput", { query: "sofa", routerOutput: [1, 2, 3] }],
    ["string routerOutput", { query: "sofa", routerOutput: "invalid" }],
    ["warnings non-array", { query: "sofa", warnings: "this is not an array" }],
    ["finderCandidateCount string", { query: "sofa", finderCandidateCount: "three" }],
    ["products non-array", { query: "sofa", products: "not an array" }],
  ];

  for (const [label, raw] of cases) {
    it(`does not throw for: ${label}`, () => {
      assert.doesNotThrow(() => importRecord(raw));
    });
  }

  it("null routerOutput (invoked, failed) maps to routerOutput: null", () => {
    const { input } = importRecord({ query: "sofa", routerOutput: null, routerUsed: true });
    assert.equal(input!.routerOutput, null);
    assert.equal(input!.routerUsed, true);
  });

  it("routerFailed: true with no routerOutput → routerOutput: null", () => {
    const { input } = importRecord({ query: "sofa", routerFailed: true });
    assert.equal(input!.routerOutput, null);
    assert.equal(input!.routerUsed, true);
  });

  it("quFailed: true with no quOutput → queryUnderstandingOutput: null", () => {
    const { input } = importRecord({ query: "sofa", quFailed: true });
    assert.equal(input!.queryUnderstandingOutput, null);
    assert.equal(input!.quUsed, true);
  });
});

describe("importRecords — malformed batch does not throw", () => {
  it("handles null-like entries gracefully", () => {
    const raws: RawCapturedRecord[] = [
      { query: "good record" },
      {} as RawCapturedRecord,
    ];
    assert.doesNotThrow(() => importRecords(raws));
  });

  it("empty array produces zero records", () => {
    const { records, diagnostics } = importRecords([]);
    assert.equal(records.length, 0);
    assert.equal(diagnostics.importedCount, 0);
    assert.equal(diagnostics.skippedCount, 0);
  });
});

// ── Test 15: parseLogLine ──

describe("parseLogLine", () => {
  it("parses a valid router log line", () => {
    const line = `[router] {"event":"routing_succeeded","intent":"search_product","confidence":0.9}`;
    const parsed = parseLogLine(line);
    assert.ok(parsed !== null);
    assert.equal(parsed!.tag, "router");
    assert.equal(parsed!.body.event, "routing_succeeded");
    assert.equal(parsed!.body.confidence, 0.9);
  });

  it("parses an explanation log line", () => {
    const line = `[explanation] {"built":true,"inputSource":"finderCandidates","candidateCount":3}`;
    const parsed = parseLogLine(line);
    assert.ok(parsed !== null);
    assert.equal(parsed!.tag, "explanation");
    assert.equal(parsed!.body.inputSource, "finderCandidates");
  });

  it("parses an eval:stage-summary log line (colon in tag)", () => {
    const line = `[eval:stage-summary] {"fixture":"test","route":"A"}`;
    const parsed = parseLogLine(line);
    assert.ok(parsed !== null);
    assert.equal(parsed!.tag, "eval:stage-summary");
    assert.equal(parsed!.body.route, "A");
  });

  it("returns null for plain text lines", () => {
    assert.equal(parseLogLine("this is not a log line"), null);
  });

  it("returns null for lines with invalid JSON", () => {
    assert.equal(parseLogLine("[router] {invalid json}"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseLogLine(""), null);
  });

  it("returns null for lines with no JSON body", () => {
    assert.equal(parseLogLine("[router]"), null);
  });

  it("returns null for array JSON body", () => {
    assert.equal(parseLogLine("[router] [1,2,3]"), null);
  });

  it("handles leading/trailing whitespace", () => {
    const line = `  [router] {"event":"ok"}  `;
    const parsed = parseLogLine(line);
    assert.ok(parsed !== null);
    assert.equal(parsed!.tag, "router");
  });
});

// ── Test 16: summarizeImportedRecords ──

describe("summarizeImportedRecords", () => {
  it("returns (no records) for empty input", () => {
    assert.equal(summarizeImportedRecords([]), "(no records)");
  });

  it("includes query in output", () => {
    const { records } = importRecords([{ query: "modern sectional sofa" }]);
    const text = summarizeImportedRecords(records);
    assert.ok(text.includes("modern sectional sofa"));
  });

  it("includes record count header", () => {
    const { records } = importRecords([
      { query: "sofa" },
      { query: "chair" },
    ]);
    const text = summarizeImportedRecords(records);
    assert.ok(text.includes("Imported 2 records"));
  });

  it("shows router info when present", () => {
    const { records } = importRecords([{
      query: "desk",
      routerOutput: mkFullRouterOutput(),
    }]);
    const text = summarizeImportedRecords(records);
    assert.ok(text.includes("search_product"));
    assert.ok(text.includes("0.90"));
  });

  it("shows 'Router: absent' when not used", () => {
    const { records } = importRecords([{ query: "simple query" }]);
    assert.ok(summarizeImportedRecords(records).includes("Router: absent"));
  });

  it("shows 'Router: invoked, failed' for null routerOutput", () => {
    const { records } = importRecords([{ query: "q", routerOutput: null, routerUsed: true }]);
    assert.ok(summarizeImportedRecords(records).includes("invoked, failed"));
  });

  it("shows QU category when present", () => {
    const { records } = importRecords([{
      query: "sofa",
      queryUnderstandingOutput: mkFullQUOutput(),
    }]);
    assert.ok(summarizeImportedRecords(records).includes("sofa bed"));
  });

  it("shows finder candidates and route when present", () => {
    const { records } = importRecords([{
      query: "chair",
      finderCandidateCount: 7,
      inputSource: "finderCandidates",
      topCandidateScore: 0.77,
    }]);
    const text = summarizeImportedRecords(records);
    assert.ok(text.includes("7 candidates"));
    assert.ok(text.includes("Route A"));
    assert.ok(text.includes("0.77"));
  });

  it("shows warning count when present", () => {
    const { records } = importRecords([{ query: "x", warnings: ["w1", "w2", "w3"] }]);
    assert.ok(summarizeImportedRecords(records).includes("Warnings: 3"));
  });

  it("includes id in header when present", () => {
    const { records } = importRecords([{ query: "sofa", requestId: "req-007" }]);
    assert.ok(summarizeImportedRecords(records).includes("req-007"));
  });
});

// ── Integration: parse log lines → import ──

describe("parseLogLine + importRecord integration", () => {
  it("log line body can be passed directly to importRecord when query is added", () => {
    const line = `[router] {"event":"routing_succeeded","intent":"search_product","retailerScope":"ikea","confidence":0.9}`;
    const parsed = parseLogLine(line);
    assert.ok(parsed !== null);

    // Log line bodies don't contain full RouterOutput — just observability fields.
    // Combining with a query gives a partial record (no validated routerOutput).
    const raw: RawCapturedRecord = { query: "oak bookcase", ...parsed!.body };
    const { input } = importRecord(raw);
    assert.ok(input !== null);
    assert.equal(input!.query, "oak bookcase");
    // routerOutput would be absent (log body ≠ full RouterOutput object)
    assert.equal(input!.routerOutput, undefined);
  });
});
