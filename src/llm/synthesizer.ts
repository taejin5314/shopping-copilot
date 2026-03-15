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
        maxTokens: 250,
        temperature: 0,
      });
      return response.content;
    } catch (err) {
      console.error("LLM synthesis failed, using fallback:", err);
      return fallbackAnswer(input);
    }
  }
}

/** Format a product name with its color/variant and size info when available. */
function formatProductName(p: ProductInfo): string {
  const extras: string[] = [];
  if (p.designText) extras.push(p.designText);
  if (p.measureText) extras.push(p.measureText);
  return extras.length > 0 ? `${p.name} — ${extras.join(", ")}` : p.name;
}

/**
 * Deterministic fallback — same logic as the original buildAnswer.
 * Used when no LLM is configured or when the LLM call fails.
 */
export function fallbackAnswer(input: SynthesisInput): string {
  const parts: string[] = [];
  const { recommendation, knowledge, warnings } = input;
  const productMap = new Map((input.products ?? []).map((p) => [p.itemNo, p]));

  if (recommendation && recommendation.ranked.length > 0) {
    parts.push(...recommendation.explanationPoints);
    const best = recommendation.ranked[0];
    const itemSummary = best.itemDetails
      .map((d) => {
        const product = productMap.get(d.itemNo);
        // Always include SKU to distinguish variants with the same product name
        const nameLabel = product
          ? `${formatProductName(product)} (${d.itemNo})`
          : d.itemNo;
        return `  - ${nameLabel}: ${d.sufficient ? `${d.available} in stock ✓` : `${d.available ?? 0} in stock ✗`}`;
      })
      .join("\n");
    parts.push(`Top store: ${best.store.label}\n${itemSummary}`);

    if (recommendation.ranked.length > 1) {
      parts.push("Other options:");
      for (const s of recommendation.ranked.slice(1)) {
        parts.push(`  ${s.store.label} — ${(s.totalScore * 100).toFixed(0)}% match`);
      }
    }
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
      const label = formatProductName(p);
      const price = p.price ? ` — ${p.price.currency} ${p.price.amount}` : "";
      parts.push(`  - ${label} (${p.itemNo})${price}`);
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

const SYSTEM_PROMPT =
  "Shopping assistant. Summarize the evidence below in ≤120 words. " +
  "Facts only — no invented data. Include store names, item numbers, and prices from the evidence. " +
  "Cite policy sources by name when referencing policy. " +
  "Incorporate any warnings naturally.";

function buildPrompt(input: SynthesisInput): LlmMessage[] {
  const evidenceParts: string[] = [];

  evidenceParts.push(`User query: "${input.query}"`);
  evidenceParts.push(`Detected intent: ${input.intent.type}`);

  if (input.recommendation && input.recommendation.ranked.length > 0) {
    evidenceParts.push("\n## Store Recommendation");
    // Cap at 3 stores — lower-ranked stores rarely appear in the answer.
    for (const store of input.recommendation.ranked.slice(0, 3)) {
      const fulfilled = store.itemDetails.filter((d) => d.sufficient).length;
      const total = store.itemDetails.length;
      evidenceParts.push(`- ${store.store.label} (score: ${(store.totalScore * 100).toFixed(0)}%): ${fulfilled}/${total} items sufficient`);
      for (const d of store.itemDetails) {
        evidenceParts.push(`  · ${d.itemNo}: ${d.available ?? 0} in stock, need ${d.requested}${d.sufficient ? " ✓" : " ✗"}`);
      }
    }
    // Explanation points omitted: the ranked scores above carry the same information.
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
      const label = [p.name, p.designText, p.measureText].filter(Boolean).join(" — ");
      const price = p.price ? ` — ${p.price.currency} ${p.price.amount}` : "";
      evidenceParts.push(`- ${label} (${p.itemNo})${price}${p.url ? ` [link](${p.url})` : ""}`);
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
