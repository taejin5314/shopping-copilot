/**
 * Golden ranking scenario verifier — CI guard.
 *
 * Checks every scenario in ALL_GOLDEN_SCENARIOS against DEFAULT_WEIGHTS.
 * Exits 0 if all pass, exits 1 (and prints failures) if any regress.
 *
 * Usage:
 *   npx tsx scripts/scoring-verify.ts
 *   npm run scoring:verify
 */

import { rankStores, DEFAULT_WEIGHTS } from "../src/domain/scoring.js";
import { ALL_GOLDEN_SCENARIOS } from "../test/golden-ranking-fixtures.js";

let failed = 0;

for (const s of ALL_GOLDEN_SCENARIOS) {
  const ranked = rankStores(s.stores, s.cart, DEFAULT_WEIGHTS, s.ctx);
  const gotIds = ranked.map((r) => r.store.storeId);
  const ok = s.expectedOrder.every((id, i) => gotIds[i] === id);

  if (ok) {
    console.log(`  ✓ ${s.name}`);
  } else {
    console.error(`  ✗ ${s.name}`);
    console.error(`      expected: ${s.expectedOrder.join(" > ")}`);
    console.error(`      got:      ${gotIds.join(" > ")}`);
    failed++;
  }
}

console.log(`\n${ALL_GOLDEN_SCENARIOS.length - failed}/${ALL_GOLDEN_SCENARIOS.length} passed`);

if (failed > 0) {
  console.error(`\n${failed} scenario(s) regressed — update DEFAULT_WEIGHTS or fix scoring logic.`);
  process.exit(1);
}
