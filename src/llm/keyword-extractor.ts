import type { LlmProvider } from "./provider.js";

// ──────────────────────────────────────────────
// Lightweight keyword extraction — translates any-language query
// to English product search terms via a fast LLM call.
// ──────────────────────────────────────────────

const EXTRACT_PROMPT =
  "Translate the following product-related query into concise English search keywords suitable for an IKEA product search API. " +
  "Return ONLY the keywords, nothing else. No explanation, no quotes, no punctuation — just space-separated English words.";

/**
 * Returns `null` if the query is already ASCII-only or extraction fails.
 */
export async function extractSearchTerms(
  query: string,
  provider: LlmProvider,
): Promise<string | null> {
  // Skip if query is already ASCII (likely English)
  if (/^[\x00-\x7F]*$/.test(query)) return null;

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
