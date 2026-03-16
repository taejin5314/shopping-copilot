/**
 * Offline scoring weight tuner — coordinate descent over golden ranking scenarios.
 *
 * Objective: maximize the number of golden scenarios where store order is correct.
 * Method: coordinate descent (one weight at a time, discrete steps).
 * Deterministic: no LLM, no network. Pure scoring math.
 *
 * Usage:
 *   npx tsx scripts/scoring-tuner.ts
 *   npx tsx scripts/scoring-tuner.ts --step 0.05 --rounds 3
 */

import { rankStores, DEFAULT_WEIGHTS } from "../src/domain/scoring.js";
import type { ScoringWeights } from "../src/domain/scoring.js";
import { ALL_GOLDEN_SCENARIOS } from "../test/golden-ranking-fixtures.js";
import type { GoldenScenario } from "../test/golden-ranking-fixtures.js";

// ── CLI args ──

function argNum(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return parseFloat(process.argv[idx + 1]);
  return fallback;
}

const STEP = argNum("--step", 0.1);  // grid resolution per axis
const ROUNDS = argNum("--rounds", 2); // coordinate descent rounds

// Scenarios are defined in test/golden-ranking-fixtures.ts.
const SCENARIOS: GoldenScenario[] = ALL_GOLDEN_SCENARIOS;

// ── Objective function ──
//
// Returns number of scenarios where every position in expectedOrder matches.
// Score: 0 to SCENARIOS.length (integer).

function score(weights: ScoringWeights): number {
  let passed = 0;
  for (const s of SCENARIOS) {
    const ranked = rankStores(s.stores, s.cart, weights, s.ctx);
    const ok = s.expectedOrder.every((id, i) => ranked[i]?.store.storeId === id);
    if (ok) passed++;
  }
  return passed;
}

// ── Weight normalization ──
//
// We keep all weights in [0, 1] and sum-normalize so they always add to 1.
// This prevents degenerate cases (e.g. all zeros).

function normalize(w: ScoringWeights): ScoringWeights {
  const total = w.stockCoverage + w.convenience + w.distance + w.price;
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  return {
    stockCoverage: w.stockCoverage / total,
    convenience: w.convenience / total,
    distance: w.distance / total,
    price: w.price / total,
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── Coordinate descent ──
//
// For each weight dimension, try +STEP and -STEP; keep the move that improves score.
// Repeat for ROUNDS rounds.

type WeightKey = keyof ScoringWeights;
const AXES: WeightKey[] = ["stockCoverage", "convenience", "distance", "price"];

function tune(initial: ScoringWeights): { weights: ScoringWeights; scenarioScore: number } {
  let current = normalize({ ...initial });
  let currentScore = score(current);

  for (let round = 0; round < ROUNDS; round++) {
    let improved = false;
    for (const axis of AXES) {
      for (const delta of [STEP, -STEP]) {
        const candidate = normalize({
          ...current,
          [axis]: clamp(current[axis] + delta),
        });
        const candidateScore = score(candidate);
        if (candidateScore > currentScore) {
          current = candidate;
          currentScore = candidateScore;
          improved = true;
          break; // take first improvement on this axis
        }
      }
    }
    if (!improved) break; // converged
  }

  return { weights: current, scenarioScore: currentScore };
}

// ── Report ──

function fmt(w: ScoringWeights): string {
  return [
    `stockCoverage=${w.stockCoverage.toFixed(3)}`,
    `convenience=${w.convenience.toFixed(3)}`,
    `distance=${w.distance.toFixed(3)}`,
    `price=${w.price.toFixed(3)}`,
  ].join("  ");
}

function report(label: string, w: ScoringWeights, s: number): void {
  console.log(`\n${label}`);
  console.log(`  Weights : ${fmt(w)}`);
  console.log(`  Passed  : ${s}/${SCENARIOS.length} golden scenarios`);
  SCENARIOS.forEach((sc) => {
    const ranked = rankStores(sc.stores, sc.cart, w, sc.ctx);
    const ok = sc.expectedOrder.every((id, i) => ranked[i]?.store.storeId === id);
    const actual = ranked.map((r) => r.store.storeId).join(" > ");
    const expected = sc.expectedOrder.join(" > ");
    console.log(`    ${ok ? "✔" : "✘"} ${sc.name}: expected [${expected}] got [${actual}]`);
  });
}

// ── Main ──

const baseline = normalize(DEFAULT_WEIGHTS);
const baselineScore = score(baseline);

console.log(`\nScoring Tuner — step=${STEP} rounds=${ROUNDS}`);
console.log(`Golden scenarios: ${SCENARIOS.length}`);

report("Baseline (DEFAULT_WEIGHTS normalized):", baseline, baselineScore);

const { weights: tuned, scenarioScore: tunedScore } = tune(DEFAULT_WEIGHTS);
report("Tuned:", tuned, tunedScore);

console.log("\nSummary:");
if (tunedScore > baselineScore) {
  console.log(`  Improvement: ${baselineScore} → ${tunedScore} scenarios passing`);
  console.log(`  Suggested weights (paste into DEFAULT_WEIGHTS):`);
  console.log(`    stockCoverage: ${tuned.stockCoverage.toFixed(3)},`);
  console.log(`    convenience:   ${tuned.convenience.toFixed(3)},`);
  console.log(`    distance:      ${tuned.distance.toFixed(3)},`);
  console.log(`    price:         ${tuned.price.toFixed(3)},`);
} else if (tunedScore === baselineScore && baselineScore === SCENARIOS.length) {
  console.log(`  All ${SCENARIOS.length} scenarios already pass with DEFAULT_WEIGHTS. No change needed.`);
} else {
  console.log(`  No improvement found (baseline=${baselineScore}, tuned=${tunedScore}).`);
  console.log(`  Try --step 0.05 or --rounds 5 for a finer search.`);
}
