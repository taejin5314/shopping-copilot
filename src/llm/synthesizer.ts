import type { LlmProvider, LlmMessage } from "./provider.js";
import type {
  ClassifiedIntent,
  RecommendationResult,
  PolicyHit,
  ProductInfo,
} from "../core/types.js";

// ──────────────────────────────────────────────
// Synthesizer — LLM-based answer composition from structured evidence
// ──────────────────────────────────────────────

export interface SynthesisInput {
  query: string;
  intent: ClassifiedIntent;
  recommendation: RecommendationResult | null;
  knowledge: PolicyHit[];
  /** Product search results (e.g. from product_info fallback). */
  products?: ProductInfo[];
  warnings: string[];
}

export interface Synthesizer {
  synthesize(input: SynthesisInput): Promise<string>;
}

/**
 * LLM-powered synthesizer. Builds a grounded prompt from structured evidence,
 * calls the provider, and falls back to deterministic output on failure.
 */
export class LlmSynthesizer implements Synthesizer {
  constructor(private readonly provider: LlmProvider) {}

  async synthesize(input: SynthesisInput): Promise<string> {
    const messages = buildPrompt(input);
    try {
      const response = await this.provider.complete(messages, {
        maxTokens: 512,
        temperature: 0.3,
      });
      return response.content;
    } catch (err) {
      console.error("LLM synthesis failed, using fallback:", err);
      return fallbackAnswer(input);
    }
  }
}

/**
 * Deterministic fallback — same logic as the original buildAnswer.
 * Used when no LLM is configured or when the LLM call fails.
 */
export function fallbackAnswer(input: SynthesisInput): string {
  const parts: string[] = [];
  const { recommendation, knowledge, warnings } = input;

  if (recommendation && recommendation.ranked.length > 0) {
    parts.push(...recommendation.explanationPoints);
    const best = recommendation.ranked[0];
    const itemSummary = best.itemDetails
      .map((d) => `  - ${d.itemNo}: ${d.sufficient ? `${d.available} in stock (sufficient)` : `${d.available ?? 0} in stock (insufficient)`}`)
      .join("\n");
    parts.push(`Top store: ${best.store.label}\n${itemSummary}`);
  }

  if (knowledge.length > 0) {
    parts.push("Relevant policy information:");
    for (const hit of knowledge) {
      parts.push(`  - ${hit.title}: ${hit.content.slice(0, 200)}`);
    }
  }

  const products = input.products ?? [];
  if (products.length > 0) {
    parts.push("Matching products:");
    for (const p of products) {
      const price = p.price ? ` — ${p.price.currency} ${p.price.amount}` : "";
      parts.push(`  - ${p.name} (${p.itemNo})${price}`);
      if (p.url) parts.push(`    ${p.url}`);
    }
  }

  if (warnings.length > 0) {
    parts.push("Warnings:");
    for (const w of warnings) {
      parts.push(`  ⚠ ${w}`);
    }
  }

  if (parts.length === 0) {
    parts.push("I wasn't able to find relevant information for your query.");
  }

  return parts.join("\n");
}

// ── Prompt construction ──

const SYSTEM_PROMPT = `You are a helpful IKEA shopping assistant. Your job is to synthesize a clear, concise answer from the structured evidence provided.

Rules:
- Only state facts present in the provided evidence.
- Do not invent stock quantities, store names, prices, or policies.
- If evidence is missing or incomplete, say so briefly.
- Keep answers practical and under 150 words.
- Reference specific stores and item numbers when available.
- Mention policy sources when citing policy information.
- If warnings exist, incorporate them naturally.`;

function buildPrompt(input: SynthesisInput): LlmMessage[] {
  const evidenceParts: string[] = [];

  evidenceParts.push(`User query: "${input.query}"`);
  evidenceParts.push(`Detected intent: ${input.intent.type}`);

  if (input.recommendation && input.recommendation.ranked.length > 0) {
    evidenceParts.push("\n## Store Recommendation");
    for (const store of input.recommendation.ranked) {
      const fulfilled = store.itemDetails.filter((d) => d.sufficient).length;
      const total = store.itemDetails.length;
      evidenceParts.push(`- ${store.store.label} (score: ${(store.totalScore * 100).toFixed(0)}%): ${fulfilled}/${total} items sufficient`);
      for (const d of store.itemDetails) {
        evidenceParts.push(`  · ${d.itemNo}: ${d.available ?? 0} in stock, need ${d.requested}${d.sufficient ? " ✓" : " ✗"}`);
      }
    }
    evidenceParts.push("\nExplanation points:");
    for (const p of input.recommendation.explanationPoints) {
      evidenceParts.push(`- ${p}`);
    }
  }

  if (input.knowledge.length > 0) {
    evidenceParts.push("\n## Retrieved Policy Knowledge");
    for (const hit of input.knowledge) {
      evidenceParts.push(`- [${hit.title}](${hit.source}): ${hit.content}`);
    }
  }

  const products = input.products ?? [];
  if (products.length > 0) {
    evidenceParts.push("\n## Product Search Results");
    for (const p of products) {
      const price = p.price ? ` — ${p.price.currency} ${p.price.amount}` : "";
      evidenceParts.push(`- ${p.name} (${p.itemNo})${price}${p.url ? ` [link](${p.url})` : ""}`);
    }
  }

  if (input.warnings.length > 0) {
    evidenceParts.push("\n## Warnings");
    for (const w of input.warnings) {
      evidenceParts.push(`- ${w}`);
    }
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: evidenceParts.join("\n") },
  ];
}
