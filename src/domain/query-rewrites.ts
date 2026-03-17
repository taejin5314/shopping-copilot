// ──────────────────────────────────────────────
// Query rewrite table — grown from zero-result data analysis.
// Enable with env var: ENABLE_QUERY_REWRITES=true
//
// Rules:
// - Only add entries confirmed by real zero-result data from BigQuery.
// - Do NOT add speculative entries.
// - Matching is case-insensitive, whitespace-normalized.
// - Each entry should have a comment with the source (e.g. "observed 5x in 2026-03")
// ──────────────────────────────────────────────

const REWRITES: Record<string, string> = {
  // Korean-English hybrid misspellings (observed in production)
  "소파배드": "sofa bed",
  "소파 배드": "sofa bed",
  "쇼파": "sofa",
  "쇼파배드": "sofa bed",
};

export interface RewriteResult {
  rewritten: string;
  didRewrite: boolean;
  original: string;
}

/**
 * Applies the rewrite table to a query before it reaches QU/Router.
 * Returns the original query unchanged if no match.
 * Guarded by ENABLE_QUERY_REWRITES env var at call site in ask.ts.
 */
export function applyQueryRewrites(query: string): RewriteResult {
  const key = query.trim().toLowerCase().replace(/\s+/g, " ");
  const target = REWRITES[key];
  if (!target) return { rewritten: query, didRewrite: false, original: query };
  return { rewritten: target, didRewrite: true, original: query };
}
