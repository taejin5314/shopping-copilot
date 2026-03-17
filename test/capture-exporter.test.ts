/**
 * Tests for src/capture/capture-exporter.ts and src/capture/capture-record.ts.
 *
 * All tests are deterministic and have no I/O side effects.
 * The log exporter emits to stderr; those tests capture stderr by intercepting
 * process.stderr.write to avoid polluting test output.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCaptureRecord,
  serializeCaptureRecord,
  makeLogExporter,
  makeNullExporter,
} from "../src/capture/capture-exporter.js";
import type { CaptureInputs } from "../src/capture/capture-exporter.js";
import type { CaptureRecord } from "../src/capture/capture-record.js";
import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ExplanationOutput, ExplanationMetadata } from "../src/core/types.js";

// ── Fixture builders ──

function mkRouter(overrides: Partial<RouterOutput> = {}): RouterOutput {
  return {
    intent: "search_product",
    retailerScope: "ikea",
    locationRequired: false,
    locationProvided: false,
    itemCardinality: "single",
    nextAgent: "query_understanding",
    confidence: 0.9,
    warnings: [],
    reasoningSummary: "Product search at IKEA.",
    ...overrides,
  };
}

function mkQU(overrides: Partial<QueryUnderstandingOutput> = {}): QueryUnderstandingOutput {
  return {
    category: "sofa bed",
    keywords: ["sofa", "bed"],
    budgetMin: null,
    budgetMax: 800,
    color: null,
    size: null,
    material: null,
    style: "minimalist",
    retailerPreference: "ikea",
    mustBeInStock: false,
    locationTerms: [],
    itemCardinality: "single",
    warnings: [],
    ...overrides,
  };
}

function mkExplanationMeta(overrides: Partial<ExplanationMetadata> = {}): ExplanationMetadata {
  return {
    retailerScope: "ikea",
    routerConfidence: 0.9,
    topCandidateScore: 0.84,
    budgetStatus: "within",
    attributesMatched: ["style"],
    attributesMissed: [],
    variantGroupingApplied: true,
    inputSource: "finderCandidates",
    fallbackUsed: false,
    candidateCount: 3,
    ...overrides,
  };
}

function mkExplanation(metaOverrides: Partial<ExplanationMetadata> = {}): ExplanationOutput {
  return {
    summary: "Found 3 matching sofa beds at IKEA within your $800 budget.",
    explanationPoints: ["Top result matches minimalist style."],
    warnings: [],
    metadata: mkExplanationMeta(metaOverrides),
  };
}

// ── buildCaptureRecord — Route A (healthy) ──

describe("buildCaptureRecord — Route A healthy", () => {
  const inputs: CaptureInputs = {
    query: "sofa bed under 800 minimalist",
    requestId: "req-001",
    routerOutput: mkRouter(),
    queryUnderstandingOutput: mkQU(),
    explanation: mkExplanation(),
    warnings: [],
    isCartIntent: false,
  };
  const record = buildCaptureRecord(inputs);

  it("sets query", () => {
    assert.equal(record.query, "sofa bed under 800 minimalist");
  });

  it("sets id from requestId", () => {
    assert.equal(record.id, "req-001");
  });

  it("sets timestamp as ISO string", () => {
    assert.ok(typeof record.timestamp === "string");
    assert.ok(!isNaN(Date.parse(record.timestamp)));
  });

  it("sets routerOutput", () => {
    assert.deepEqual(record.routerOutput, mkRouter());
  });

  it("sets routerUsed true", () => {
    assert.equal(record.routerUsed, true);
  });

  it("sets queryUnderstandingOutput", () => {
    assert.deepEqual(record.queryUnderstandingOutput, mkQU());
  });

  it("sets quUsed true", () => {
    assert.equal(record.quUsed, true);
  });

  it("derives finderCandidateCount from explanation.metadata.candidateCount", () => {
    assert.equal(record.finderCandidateCount, 3);
  });

  it("derives topCandidateScore from explanation.metadata.topCandidateScore", () => {
    assert.equal(record.topCandidateScore, 0.84);
  });

  it("derives inputSource from explanation.metadata.inputSource", () => {
    assert.equal(record.inputSource, "finderCandidates");
  });

  it("sets explanation", () => {
    assert.ok(record.explanation !== undefined);
    assert.equal(record.explanation?.summary, "Found 3 matching sofa beds at IKEA within your $800 budget.");
  });

  it("sets isCartIntent false", () => {
    assert.equal(record.isCartIntent, false);
  });

  it("sets warnings as empty array", () => {
    assert.deepEqual(record.warnings, []);
  });

  it("sets _captureVersion 1", () => {
    assert.equal(record._captureVersion, 1);
  });
});

// ── buildCaptureRecord — Route B fallback ──

describe("buildCaptureRecord — Route B fallback", () => {
  const inputs: CaptureInputs = {
    query: "dining table",
    // No routerOutput, no queryUnderstandingOutput (Route B path)
    explanation: mkExplanation({
      inputSource: "foundProducts",
      fallbackUsed: true,
      candidateCount: 0,
      topCandidateScore: null,
      variantGroupingApplied: false,
    }),
    warnings: ["No QU output available — using basic keyword search."],
  };
  const record = buildCaptureRecord(inputs);

  it("sets query", () => {
    assert.equal(record.query, "dining table");
  });

  it("routerOutput is undefined (not set)", () => {
    assert.equal(record.routerOutput, undefined);
  });

  it("routerUsed is undefined (not set)", () => {
    assert.equal(record.routerUsed, undefined);
  });

  it("queryUnderstandingOutput is undefined (not set)", () => {
    assert.equal(record.queryUnderstandingOutput, undefined);
  });

  it("quUsed is undefined (not set)", () => {
    assert.equal(record.quUsed, undefined);
  });

  it("derives finderCandidateCount = 0 from metadata", () => {
    assert.equal(record.finderCandidateCount, 0);
  });

  it("derives topCandidateScore = null from metadata", () => {
    assert.equal(record.topCandidateScore, null);
  });

  it("derives inputSource = foundProducts from metadata", () => {
    assert.equal(record.inputSource, "foundProducts");
  });

  it("preserves warnings", () => {
    assert.deepEqual(record.warnings, ["No QU output available — using basic keyword search."]);
  });
});

// ── buildCaptureRecord — partial inputs ──

describe("buildCaptureRecord — partial inputs", () => {
  it("query-only input produces a valid record", () => {
    const record = buildCaptureRecord({ query: "chair" });
    assert.equal(record.query, "chair");
    assert.equal(record._captureVersion, 1);
    assert.ok(typeof record.timestamp === "string");
    assert.deepEqual(record.warnings, []);
  });

  it("id is absent when requestId not provided", () => {
    const record = buildCaptureRecord({ query: "chair" });
    assert.equal(record.id, undefined);
  });

  it("explanation fields absent when no explanation", () => {
    const record = buildCaptureRecord({ query: "chair" });
    assert.equal(record.explanation, undefined);
    assert.equal(record.finderCandidateCount, undefined);
    assert.equal(record.topCandidateScore, undefined);
    assert.equal(record.inputSource, undefined);
  });

  it("routerOutput = null sets routerUsed = true (router ran but failed)", () => {
    const record = buildCaptureRecord({ query: "chair", routerOutput: null });
    assert.equal(record.routerOutput, null);
    assert.equal(record.routerUsed, true);
  });

  it("queryUnderstandingOutput = null sets quUsed = true (QU ran but failed)", () => {
    const record = buildCaptureRecord({ query: "chair", queryUnderstandingOutput: null });
    assert.equal(record.queryUnderstandingOutput, null);
    assert.equal(record.quUsed, true);
  });

  it("isCartIntent absent when not provided", () => {
    const record = buildCaptureRecord({ query: "chair" });
    assert.equal(record.isCartIntent, undefined);
  });

  it("warnings default to empty array when not provided", () => {
    const record = buildCaptureRecord({ query: "chair" });
    assert.deepEqual(record.warnings, []);
  });
});

// ── buildCaptureRecord — warnings ──

describe("buildCaptureRecord — warnings", () => {
  it("preserves multiple warnings in order", () => {
    const w = ["warn A", "warn B", "warn C"];
    const record = buildCaptureRecord({ query: "q", warnings: w });
    assert.deepEqual(record.warnings, w);
  });

  it("makes a defensive copy of warnings array", () => {
    const w = ["original"];
    const record = buildCaptureRecord({ query: "q", warnings: w });
    w.push("mutated after build");
    assert.deepEqual(record.warnings, ["original"]);
  });
});

// ── buildCaptureRecord — explanation metadata derivation ──

describe("buildCaptureRecord — explanation metadata derivation", () => {
  it("uses candidateCount = 5 from metadata", () => {
    const record = buildCaptureRecord({
      query: "chair",
      explanation: mkExplanation({ candidateCount: 5 }),
    });
    assert.equal(record.finderCandidateCount, 5);
  });

  it("uses topCandidateScore from metadata", () => {
    const record = buildCaptureRecord({
      query: "chair",
      explanation: mkExplanation({ topCandidateScore: 0.65 }),
    });
    assert.equal(record.topCandidateScore, 0.65);
  });

  it("sets inputSource = foundProducts for Route B explanation", () => {
    const record = buildCaptureRecord({
      query: "chair",
      explanation: mkExplanation({ inputSource: "foundProducts", fallbackUsed: true }),
    });
    assert.equal(record.inputSource, "foundProducts");
  });

  it("explanation.metadata is not duplicated into top-level fields twice", () => {
    // candidateCount comes from metadata only — there is no separate candidateCount field
    const record = buildCaptureRecord({
      query: "chair",
      explanation: mkExplanation({ candidateCount: 2 }),
    });
    assert.equal(record.finderCandidateCount, 2);
    // The explanation itself is also present for full review tooling access
    assert.equal(record.explanation?.metadata.candidateCount, 2);
  });
});

// ── serializeCaptureRecord ──

describe("serializeCaptureRecord", () => {
  it("returns a non-empty string for a valid record", () => {
    const record = buildCaptureRecord({ query: "chair" });
    const s = serializeCaptureRecord(record);
    assert.ok(s.length > 0);
  });

  it("output is valid JSON", () => {
    const record = buildCaptureRecord({
      query: "sofa bed",
      routerOutput: mkRouter(),
      queryUnderstandingOutput: mkQU(),
      explanation: mkExplanation(),
      warnings: ["w1"],
    });
    const s = serializeCaptureRecord(record);
    assert.doesNotThrow(() => JSON.parse(s));
  });

  it("query field is preserved in JSON", () => {
    const record = buildCaptureRecord({ query: "dining table" });
    const parsed = JSON.parse(serializeCaptureRecord(record));
    assert.equal(parsed.query, "dining table");
  });

  it("_captureVersion is 1 in JSON", () => {
    const record = buildCaptureRecord({ query: "q" });
    const parsed = JSON.parse(serializeCaptureRecord(record));
    assert.equal(parsed._captureVersion, 1);
  });

  it("is deterministic — same inputs produce same JSON structure", () => {
    // Two records built from identical inputs (modulo timestamp) should have
    // the same set of keys in the same order.
    const inputs: CaptureInputs = {
      query: "ergonomic chair",
      requestId: "abc",
      routerOutput: mkRouter(),
      queryUnderstandingOutput: mkQU(),
      explanation: mkExplanation(),
      warnings: ["w1"],
      isCartIntent: false,
    };
    const r1 = buildCaptureRecord(inputs);
    const r2 = buildCaptureRecord(inputs);
    // Timestamps will differ slightly — compare keys only
    const keys1 = Object.keys(JSON.parse(serializeCaptureRecord(r1)));
    const keys2 = Object.keys(JSON.parse(serializeCaptureRecord(r2)));
    assert.deepEqual(keys1, keys2);
  });

  it("does not throw on already-serialized (string) query edge case", () => {
    const record = buildCaptureRecord({ query: 'query with "quotes" and \\backslashes' });
    assert.doesNotThrow(() => serializeCaptureRecord(record));
    const parsed = JSON.parse(serializeCaptureRecord(record));
    assert.equal(parsed.query, 'query with "quotes" and \\backslashes');
  });
});

// ── makeNullExporter ──

describe("makeNullExporter", () => {
  it("is a function", () => {
    const exporter = makeNullExporter();
    assert.equal(typeof exporter, "function");
  });

  it("does not throw when called", () => {
    const exporter = makeNullExporter();
    const record = buildCaptureRecord({ query: "chair" });
    assert.doesNotThrow(() => exporter(record));
  });

  it("accepts any CaptureRecord without side effects", () => {
    const exporter = makeNullExporter();
    const captured: CaptureRecord[] = [];
    // Passing to null exporter should NOT add to captured
    exporter(buildCaptureRecord({ query: "q1" }));
    exporter(buildCaptureRecord({ query: "q2" }));
    assert.equal(captured.length, 0);
  });
});

// ── makeLogExporter ──

describe("makeLogExporter", () => {
  it("is a function", () => {
    const exporter = makeLogExporter();
    assert.equal(typeof exporter, "function");
  });

  it("writes a line containing the query to stderr", () => {
    const lines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    // @ts-ignore — intercepting for test
    process.stderr.write = (chunk: unknown) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    };
    try {
      const exporter = makeLogExporter("[capture]");
      exporter(buildCaptureRecord({ query: "shelf unit" }));
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.ok(lines.length > 0);
    const line = lines.join("");
    assert.ok(line.includes("[capture]"), `tag not found in: ${line}`);
    assert.ok(line.includes("shelf unit"), `query not found in: ${line}`);
  });

  it("uses a custom tag when provided", () => {
    const lines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    // @ts-ignore
    process.stderr.write = (chunk: unknown) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    };
    try {
      makeLogExporter("[my-app]")(buildCaptureRecord({ query: "q" }));
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.ok(lines.join("").includes("[my-app]"));
  });

  it("emitted line parses as valid JSON after the tag", () => {
    let emitted = "";
    const originalWrite = process.stderr.write.bind(process.stderr);
    // @ts-ignore
    process.stderr.write = (chunk: unknown) => {
      if (typeof chunk === "string") emitted += chunk;
      return true;
    };
    try {
      makeLogExporter("[capture]")(buildCaptureRecord({ query: "table" }));
    } finally {
      process.stderr.write = originalWrite;
    }
    const line = emitted.trim();
    // Format: "[capture] {json}"
    const jsonPart = line.slice("[capture] ".length);
    assert.doesNotThrow(() => JSON.parse(jsonPart));
    assert.equal(JSON.parse(jsonPart).query, "table");
  });

  it("does not throw if stderr is unavailable", () => {
    const exporter = makeLogExporter();
    const record = buildCaptureRecord({ query: "q" });
    // Simulate a write failure
    const originalWrite = process.stderr.write.bind(process.stderr);
    // @ts-ignore
    process.stderr.write = () => { throw new Error("write failed"); };
    try {
      assert.doesNotThrow(() => exporter(record));
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

// ── Importer compatibility ──

describe("CaptureRecord — importer field compatibility", () => {
  it("record parsed from JSON has all expected PipelineReviewInput-compatible fields", () => {
    const record = buildCaptureRecord({
      query: "ergonomic chair",
      requestId: "trace-123",
      routerOutput: mkRouter(),
      queryUnderstandingOutput: mkQU(),
      explanation: mkExplanation(),
      warnings: ["w1"],
      isCartIntent: false,
    });

    const parsed = JSON.parse(serializeCaptureRecord(record)) as Record<string, unknown>;

    // Fields the log-importer maps from raw records into PipelineReviewInput
    assert.equal(typeof parsed["query"], "string");
    assert.equal(parsed["id"], "trace-123");
    assert.ok(parsed["routerOutput"] !== undefined);
    assert.equal(parsed["routerUsed"], true);
    assert.ok(parsed["queryUnderstandingOutput"] !== undefined);
    assert.equal(parsed["quUsed"], true);
    assert.equal(typeof parsed["finderCandidateCount"], "number");
    assert.equal(typeof parsed["topCandidateScore"], "number");
    assert.equal(parsed["inputSource"], "finderCandidates");
    assert.equal(parsed["isCartIntent"], false);
    assert.ok(Array.isArray(parsed["warnings"]));
  });

  it("Route B record has inputSource = foundProducts in JSON", () => {
    const record = buildCaptureRecord({
      query: "dining table",
      explanation: mkExplanation({
        inputSource: "foundProducts",
        fallbackUsed: true,
        candidateCount: 0,
        topCandidateScore: null,
      }),
    });
    const parsed = JSON.parse(serializeCaptureRecord(record));
    assert.equal(parsed.inputSource, "foundProducts");
    assert.equal(parsed.finderCandidateCount, 0);
    assert.equal(parsed.topCandidateScore, null);
  });
});

// ── buildCaptureRecord — rankingSnapshot ──

describe("buildCaptureRecord — rankingSnapshot", () => {
  const snap = {
    stores: [
      {
        store: { retailer: "test", storeId: "A", label: "Store A" },
        items: [{ itemNo: "001", available: true, quantity: 5, stockLevel: null, canNotify: null }],
      },
      {
        store: { retailer: "test", storeId: "B", label: "Store B" },
        items: [{ itemNo: "001", available: false, quantity: 0, stockLevel: null, canNotify: null }],
      },
    ],
    cart: [{ itemNo: "001", quantity: 2 }],
    rankedIds: ["A", "B"],
  };

  it("rankingSnapshot is set when provided", () => {
    const record = buildCaptureRecord({ query: "shelf", rankingSnapshot: snap });
    assert.deepEqual(record.rankingSnapshot, snap);
  });

  it("rankingSnapshot is absent when not provided", () => {
    const record = buildCaptureRecord({ query: "shelf" });
    assert.equal(record.rankingSnapshot, undefined);
  });

  it("rankingSnapshot survives JSON round-trip", () => {
    const record = buildCaptureRecord({ query: "shelf", rankingSnapshot: snap });
    const parsed = JSON.parse(serializeCaptureRecord(record));
    assert.deepEqual(parsed.rankingSnapshot.rankedIds, ["A", "B"]);
    assert.equal(parsed.rankingSnapshot.cart[0].itemNo, "001");
    assert.equal(parsed.rankingSnapshot.stores.length, 2);
  });

  it("rankedIds order is preserved", () => {
    const record = buildCaptureRecord({
      query: "shelf",
      rankingSnapshot: { ...snap, rankedIds: ["B", "A"] },
    });
    assert.deepEqual(record.rankingSnapshot?.rankedIds, ["B", "A"]);
  });

  it("userLocation is preserved in rankingSnapshot", () => {
    const loc = { lat: 34.05, lng: -118.24 };
    const record = buildCaptureRecord({
      query: "shelf",
      rankingSnapshot: { ...snap, userLocation: loc },
    });
    assert.deepEqual(record.rankingSnapshot?.userLocation, loc);
  });

  it("userLocation is absent when not set in rankingSnapshot", () => {
    const record = buildCaptureRecord({ query: "shelf", rankingSnapshot: snap });
    assert.equal(record.rankingSnapshot?.userLocation, undefined);
  });
});
