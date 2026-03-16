/**
 * Evaluation runner — deterministic fixture-based pipeline evaluator.
 *
 * This module is a pure helper (no node:test imports). It:
 *   1. Defines the EvalFixture format for representing expected pipeline behavior.
 *   2. Runs a fixture through routeQuery → runQueryUnderstanding → findProducts →
 *      buildExplanation using deterministic mock LLM providers and adapters.
 *   3. Checks each fixture's expectations and returns structured EvalResult objects.
 *   4. Provides buildQualityReport for summarizing a batch of results.
 *
 * No LLM calls are made beyond the in-process mock. No adapter network calls.
 * Safe to run in CI without any credentials or external services.
 */

import type { RouterOutput } from "../src/llm/router.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";
import type { ProductFinderResult } from "../src/domain/product-finder.js";
import type { ExplanationOutput, ExplanationInput } from "../src/domain/explanation.js";
import type { LlmProvider, LlmResponse } from "../src/llm/provider.js";
import type { RetailerAdapter, SearchOpts, FindStoresOpts } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, StoreStock, ProductRef } from "../src/core/types.js";
import { routeQuery } from "../src/llm/router.js";
import { runQueryUnderstanding } from "../src/llm/query-understanding.js";
import { findProducts } from "../src/domain/product-finder.js";
import { buildExplanation } from "../src/domain/explanation.js";

// ── Fixture format ──

export interface EvalFixture {
  /** Human-readable fixture name for reporting and log output. */
  name: string;
  /** Raw user query string. */
  query: string;

  // ── Deterministic mock inputs ──

  /**
   * If set, the LLM is mocked to return this for routeQuery.
   * If absent, routerOutput = null (router not involved).
   */
  mockRouterOutput?: RouterOutput;
  /**
   * If set, the LLM is mocked to return this for runQueryUnderstanding.
   * If absent, quOutput = null → Route B (basic keyword search path).
   */
  mockQUOutput?: QueryUnderstandingOutput;
  /** Products returned by the mock adapter's searchProducts. Defaults to []. */
  mockProducts?: ProductInfo[];

  // ── Expectations (all optional — unset fields are not checked) ──

  /** Assert routerOutput.intent equals this. */
  expectedRouterIntent?: RouterOutput["intent"];
  /** Assert routerOutput.retailerScope equals this. */
  expectedRetailerScope?: RouterOutput["retailerScope"];
  /** Assert QU output fields partially match (each listed key is checked individually). */
  expectedQUFields?: Partial<{
    category: string;
    budgetMax: number | null;
    color: string | null;
    material: string | null;
    size: string | null;
    style: string | null;
    itemCardinality: QueryUnderstandingOutput["itemCardinality"];
  }>;
  /** Assert at least this many candidates were produced by the finder. */
  expectedCandidateCountMin?: number;
  /** Assert at most this many candidates were produced by the finder. */
  expectedCandidateCountMax?: number;
  /** Assert the top candidate's retailer equals this. */
  expectedTopCandidateRetailer?: string;
  /**
   * Assert at least one warning (across all stages) contains each substring.
   * Case-insensitive substring match.
   */
  expectedWarningsContain?: string[];
  /**
   * Assert at least one explanation point contains each substring.
   * Case-insensitive substring match.
   */
  expectedExplanationPointsContain?: string[];
}

// ── Mismatch record ──

export interface EvalMismatch {
  field: string;
  category: "router" | "qu" | "finder" | "explanation" | "warnings";
  expected: unknown;
  actual: unknown;
}

// ── Stage outcomes ──

export interface EvalStages {
  router: { ok: boolean; fallback: boolean };
  qu: { ok: boolean; fallback: boolean };
  finder: { candidateCount: number; searchQuery: string; route: "A" | "B" };
  explanation: { built: boolean; inputSource: string | null };
}

// ── Full result ──

export interface EvalResult {
  fixture: EvalFixture;
  passed: boolean;
  mismatches: EvalMismatch[];
  stages: EvalStages;
  routerOutput: RouterOutput | null;
  quOutput: QueryUnderstandingOutput | null;
  finderResult: ProductFinderResult | null;
  explanationOutput: ExplanationOutput;
  /** Flattened warnings from all pipeline stages (deduplicated). */
  allWarnings: string[];
}

// ── Quality report ──

export interface QualityReport {
  total: number;
  passed: number;
  failed: number;
  routerMismatches: number;
  quMismatches: number;
  candidateCountMismatches: number;
  explanationMismatches: number;
  warningMismatches: number;
  /** Names of fixtures that failed. */
  failedFixtures: string[];
}

// ── Internal mocks ──

function llmReturning(json: object): LlmProvider {
  return { complete: async () => ({ content: JSON.stringify(json) } as LlmResponse) };
}

function evalMockAdapter(products: ProductInfo[]): RetailerAdapter {
  return {
    retailerId: "mock",
    listStores: async (_cc?: string): Promise<StoreRef[]> => [],
    searchProducts: async (_q: string, _o?: SearchOpts): Promise<ProductInfo[]> => products,
    checkStock: async (_i: ProductRef[], _s: string[]): Promise<StoreStock[]> => [],
    findStoresForCart: async (
      _items: Array<{ itemNo: string; quantity: number }>,
      _opts?: FindStoresOpts,
    ): Promise<StoreStock[]> => [],
  };
}

// ── Expectation checker ──

function checkMismatch(
  mismatches: EvalMismatch[],
  category: EvalMismatch["category"],
  field: string,
  expected: unknown,
  actual: unknown,
  predicate: (e: unknown, a: unknown) => boolean = (e, a) => e === a,
): void {
  if (!predicate(expected, actual)) {
    mismatches.push({ field, category, expected, actual });
  }
}

// ── Runner ──

/**
 * Run a single EvalFixture through all pipeline stages and evaluate its expectations.
 * Never throws — all unexpected errors are captured as "warnings" mismatches.
 * Emits a single structured [eval:stage-summary] log line per fixture.
 */
export async function runEvalFixture(fixture: EvalFixture): Promise<EvalResult> {
  const mismatches: EvalMismatch[] = [];
  const allWarnings: string[] = [];
  const products = fixture.mockProducts ?? [];

  // ── Stage 1: Router ──
  let routerOutput: RouterOutput | null = null;
  if (fixture.mockRouterOutput) {
    routerOutput = await routeQuery(fixture.query, llmReturning(fixture.mockRouterOutput));
    if (routerOutput?.warnings.length) {
      allWarnings.push(...routerOutput.warnings);
    }
  }

  // ── Stage 2: Query Understanding ──
  let quOutput: QueryUnderstandingOutput | null = null;
  if (fixture.mockQUOutput) {
    quOutput = await runQueryUnderstanding(fixture.query, llmReturning(fixture.mockQUOutput));
    if (quOutput?.warnings.length) {
      allWarnings.push(...quOutput.warnings);
    }
  }

  // Route A when quOutput is present; Route B otherwise (mirrors orchestrator logic).
  const route: "A" | "B" = quOutput ? "A" : "B";

  // ── Stage 3: Product Finder ──
  let finderResult: ProductFinderResult | null = null;
  try {
    finderResult = await findProducts(
      {
        rawQuery: fixture.query,
        routerOutput: routerOutput ?? undefined,
        quOutput: quOutput ?? undefined,
        // Scope only applied when adapter matches the scope (mock retailer = "mock").
        // The finder falls back to all adapters when no scope match, which is correct for eval.
        retailerScope: routerOutput?.retailerScope,
      },
      [evalMockAdapter(products)],
    );
    for (const w of finderResult.warnings) {
      if (!allWarnings.includes(w)) allWarnings.push(w);
    }
  } catch (err) {
    allWarnings.push(`[eval] findProducts threw: ${String(err)}`);
  }

  // ── Stage 4: Explanation ──
  // Route A: pass finderCandidates; Route B: pass foundProductCount for accurate summary.
  const isCartIntent = quOutput?.itemCardinality === "multiple";
  const finderCandidates = route === "A" ? (finderResult?.candidates ?? undefined) : undefined;
  const explanationInput: ExplanationInput = {
    query: fixture.query,
    routerOutput: routerOutput ?? undefined,
    queryUnderstandingOutput: quOutput ?? undefined,
    finderCandidates,
    foundProductCount: route === "B" ? products.length : undefined,
    variantGroupingApplied: route === "A" && !isCartIntent,
    inputSource: route === "A" ? "finderCandidates" : "foundProducts",
    isCartIntent,
  };
  const explanationOutput = buildExplanation(explanationInput);
  for (const w of explanationOutput.warnings) {
    if (!allWarnings.includes(w)) allWarnings.push(w);
  }

  // ── Stage-level summary log — single line, grep-friendly ──
  const stages: EvalStages = {
    router: { ok: !!routerOutput, fallback: !fixture.mockRouterOutput || !routerOutput },
    qu: { ok: !!quOutput, fallback: !fixture.mockQUOutput || !quOutput },
    finder: {
      candidateCount: finderResult?.candidates.length ?? 0,
      searchQuery: finderResult?.searchQuery ?? fixture.query,
      route,
    },
    explanation: {
      built: true,
      inputSource: explanationOutput.metadata.inputSource,
    },
  };
  console.error("[eval:stage-summary]", JSON.stringify({
    fixture: fixture.name,
    router: routerOutput ? "ok" : "fallback",
    routerIntent: routerOutput?.intent ?? null,
    qu: quOutput ? "ok" : "fallback",
    quCategory: quOutput?.category ?? null,
    route,
    finderCandidates: finderResult?.candidates.length ?? 0,
    explanationBuilt: true,
    explanationInputSource: explanationOutput.metadata.inputSource,
  }));

  // ── Check expectations ──

  if (fixture.expectedRouterIntent !== undefined) {
    checkMismatch(mismatches, "router", "router.intent",
      fixture.expectedRouterIntent, routerOutput?.intent ?? null);
  }
  if (fixture.expectedRetailerScope !== undefined) {
    checkMismatch(mismatches, "router", "router.retailerScope",
      fixture.expectedRetailerScope, routerOutput?.retailerScope ?? null);
  }

  if (fixture.expectedQUFields) {
    for (const [key, expected] of Object.entries(fixture.expectedQUFields)) {
      const actual = quOutput ? (quOutput as Record<string, unknown>)[key] : null;
      checkMismatch(mismatches, "qu", `qu.${key}`, expected, actual);
    }
  }

  const candidateCount = finderResult?.candidates.length ?? 0;
  if (fixture.expectedCandidateCountMin !== undefined) {
    checkMismatch(mismatches, "finder", "finder.candidateCount (min)",
      fixture.expectedCandidateCountMin, candidateCount,
      (e, a) => (a as number) >= (e as number));
  }
  if (fixture.expectedCandidateCountMax !== undefined) {
    checkMismatch(mismatches, "finder", "finder.candidateCount (max)",
      fixture.expectedCandidateCountMax, candidateCount,
      (e, a) => (a as number) <= (e as number));
  }
  if (fixture.expectedTopCandidateRetailer !== undefined) {
    checkMismatch(mismatches, "finder", "finder.candidates[0].retailer",
      fixture.expectedTopCandidateRetailer, finderResult?.candidates[0]?.retailer ?? null);
  }

  if (fixture.expectedWarningsContain) {
    for (const substr of fixture.expectedWarningsContain) {
      const found = allWarnings.some((w) => w.toLowerCase().includes(substr.toLowerCase()));
      if (!found) {
        mismatches.push({
          field: "warnings",
          category: "warnings",
          expected: `warning containing "${substr}"`,
          actual: allWarnings.length === 0
            ? "(no warnings)"
            : `not found in [${allWarnings.slice(0, 5).map((w) => `"${w.slice(0, 80)}"`).join(", ")}]`,
        });
      }
    }
  }

  if (fixture.expectedExplanationPointsContain) {
    for (const substr of fixture.expectedExplanationPointsContain) {
      const found = explanationOutput.explanationPoints.some((p) =>
        p.toLowerCase().includes(substr.toLowerCase()),
      );
      if (!found) {
        mismatches.push({
          field: "explanation.explanationPoints",
          category: "explanation",
          expected: `point containing "${substr}"`,
          actual: explanationOutput.explanationPoints.length === 0
            ? "(no explanation points)"
            : `not found in [${explanationOutput.explanationPoints.map((p) => `"${p}"`).join(", ")}]`,
        });
      }
    }
  }

  return {
    fixture,
    passed: mismatches.length === 0,
    mismatches,
    stages,
    routerOutput,
    quOutput,
    finderResult,
    explanationOutput,
    allWarnings,
  };
}

// ── Quality report ──

/**
 * Summarize a batch of EvalResults into a compact quality report.
 * Useful for regression checks: assert report.failed === 0.
 */
export function buildQualityReport(results: EvalResult[]): QualityReport {
  const failed = results.filter((r) => !r.passed);
  const allMismatches = results.flatMap((r) => r.mismatches);

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: failed.length,
    routerMismatches: allMismatches.filter((m) => m.category === "router").length,
    quMismatches: allMismatches.filter((m) => m.category === "qu").length,
    candidateCountMismatches: allMismatches.filter((m) => m.category === "finder").length,
    explanationMismatches: allMismatches.filter((m) => m.category === "explanation").length,
    warningMismatches: allMismatches.filter((m) => m.category === "warnings").length,
    failedFixtures: failed.map((r) => r.fixture.name),
  };
}
