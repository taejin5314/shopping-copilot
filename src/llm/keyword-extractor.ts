import type { LlmProvider } from "./provider.js";

// ──────────────────────────────────────────────
// Lightweight keyword extraction — translates any-language query
// to English product search terms via a fast LLM call.
// ──────────────────────────────────────────────

// Prompt carries only retailer context — no language-specific examples.
// Known ambiguities (시계→wall clock, mat→rug, etc.) are resolved upstream
// by the retail query normalizer before this function is called.
const EXTRACT_PROMPT =
  "Extract the core product search keywords for a home furnishings and furniture retailer. " +
  "Translate to English if needed. " +
  "Strip adjectives, quality descriptors, and filler words — keep only essential product terms. " +
  "Return ONLY the keywords, nothing else. No explanation, no quotes, no punctuation — just space-separated English words.";

/**
 * Normalises any query into concise English product keywords.
 * Handles both non-English translation and English noise-word removal.
 * Returns `null` on failure or if the LLM returns nothing useful.
 */
export async function extractSearchTerms(
  query: string,
  provider: LlmProvider,
): Promise<string | null> {

  try {
    const response = await provider.complete(
      [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: query },
      ],
      { maxTokens: 40, temperature: 0 },
    );
    const terms = response.content.trim();
    return terms.length > 0 ? terms : null;
  } catch {
    return null;
  }
}
