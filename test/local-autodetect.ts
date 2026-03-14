/**
 * Local smoke test: Auto-detect mode with Structube only.
 * Fake LLM provider simulates translating "퀄리티 좋은 소파 침대" → "sofa bed".
 * Run: node --import tsx/esm test/local-autodetect.ts
 */
import { ask } from "../src/api/ask.js";
import { StructubeAdapter } from "../src/retailers/structube/adapter.js";
import { KeywordRetriever } from "../src/rag/keyword-retriever.js";
import { STRUCTUBE_CORPUS } from "../src/rag/structube-corpus.js";
import type { LlmProvider } from "../src/llm/provider.js";
import type { CopilotConfig } from "../src/api/ask.js";

// Simulates the LLM translating the Korean query to "sofa bed"
const fakeLlm: LlmProvider = {
  complete: async () => ({ content: "sofa bed" }),
};

const config: CopilotConfig = {
  adapter: new StructubeAdapter(),
  retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
  // Register structube as a named retailer too, so auto-detect fans out via queryAll
  retailers: {
    structube: {
      adapter: new StructubeAdapter(),
      retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
    },
  },
  llmProvider: fakeLlm,
  maxStoreResults: 3,
};

console.log("=== Query: 퀄리티 좋은 소파 침대 (translated → sofa bed) | retailer: Auto-detect ===\n");

const result = await ask({ query: "퀄리티 좋은 소파 침대" }, config);

console.log("Intent:", result.intent.type);
console.log("Answer:\n" + result.answer);
if (result.recommendation) {
  console.log("\nRanked stores:");
  for (const s of result.recommendation.ranked) {
    console.log(`  ${s.store.label} — score: ${(s.totalScore * 100).toFixed(1)}%`);
    for (const d of s.itemDetails) {
      const status = d.sufficient ? "sufficient" : "insufficient";
      console.log(`    ${d.itemNo}: qty=${d.available ?? "?"} (${status})`);
    }
  }
}
if (result.citations.length > 0) {
  console.log("\nCitations:");
  for (const c of result.citations) {
    console.log(`  ${c.label} — ${c.url}`);
  }
}
if (result.warnings.length > 0) {
  console.log("\nWarnings:");
  for (const w of result.warnings) console.log(`  ⚠ ${w}`);
}
console.log("\nTool calls:", result.toolCallsUsed.map((t) => `${t.tool}(${t.retailer}) ${t.durationMs}ms`).join(", "));
