/**
 * Stability test for ci/sample-review-input.json.
 *
 * Reads the checked-in CI sample, imports it through the review pipeline, and
 * verifies it passes the default quality gate.  This test exists so that if
 * the review heuristics or gate thresholds change in a way that would break
 * the CI workflow, the test suite catches it before the workflow runs.
 */

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseRawContent, runFullReviewPipeline } from "../scripts/review-pipeline.js";
import { evaluateGate, DEFAULT_THRESHOLDS } from "../scripts/quality-gate.js";

const SAMPLE_PATH = "ci/sample-review-input.json";

// ── Load and parse once ──

const raw = readFileSync(SAMPLE_PATH, "utf8");
const { records, parseWarnings, lineErrors } = parseRawContent(raw, SAMPLE_PATH);
const pipelineResult = runFullReviewPipeline(records);
const gateResult = evaluateGate(
  pipelineResult.reviewSummary,
  pipelineResult.importDiagnostics,
  pipelineResult.reviewResults,
  { maxFailedQueries: 0 },
);

// ── Parse ──

describe("ci/sample-review-input.json — parse", () => {
  it("file is valid JSON and parses without errors", () => {
    assert.equal(lineErrors, 0);
  });

  it("no parse warnings", () => {
    assert.equal(parseWarnings.length, 0);
  });

  it("contains exactly 3 records", () => {
    assert.equal(records.length, 3);
  });
});

// ── Import ──

describe("ci/sample-review-input.json — import", () => {
  it("all 3 records import successfully", () => {
    assert.equal(pipelineResult.importDiagnostics.importedCount, 3);
  });

  it("no records skipped", () => {
    assert.equal(pipelineResult.importDiagnostics.skippedCount, 0);
  });

  it("no partial imports (all stage shapes are valid)", () => {
    assert.equal(pipelineResult.importDiagnostics.partialImports, 0);
  });
});

// ── Quality review ──

describe("ci/sample-review-input.json — quality review", () => {
  it("all 3 queries reviewed", () => {
    assert.equal(pipelineResult.reviewSummary.totalReviewed, 3);
  });

  it("zero queries with failure-severity findings", () => {
    assert.equal(pipelineResult.reviewSummary.queriesWithFailures, 0);
  });

  it("zero queries with warn-severity findings", () => {
    assert.equal(pipelineResult.reviewSummary.queriesWithWarnings, 0);
  });

  it("record 3 (Route B) produces at most 1 info finding", () => {
    const r = pipelineResult.reviewResults[2];
    const nonInfo = r.findings.filter((f) => f.severity !== "info");
    assert.equal(nonInfo.length, 0);
  });

  it("Route B fallback rate is less than 100%", () => {
    assert.ok(pipelineResult.reviewSummary.fallbackRate < 1.0);
  });
});

// ── Quality gate ──

describe("ci/sample-review-input.json — quality gate", () => {
  it("gate passes with default thresholds (maxFailedQueries: 0)", () => {
    assert.equal(gateResult.passed, true);
  });

  it("no failed checks", () => {
    assert.equal(gateResult.failedChecks.length, 0);
  });

  it("maxFailedQueries check passes with actual=0", () => {
    const c = gateResult.passingChecks.find((c) => c.name === "maxFailedQueries");
    assert.ok(c !== undefined);
    assert.equal(c!.actual, 0);
    assert.equal(c!.threshold, DEFAULT_THRESHOLDS.maxFailedQueries);
  });
});
