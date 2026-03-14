import type { PolicyHit, RetailerId } from "../core/types.js";
import type { RagRetriever } from "./retriever.js";
import type { PolicyChunk } from "./corpus.js";
import { tokenize } from "./corpus.js";

// ──────────────────────────────────────────────
// Keyword retriever — BM25-lite over small corpus
// ──────────────────────────────────────────────

/**
 * Lightweight keyword retriever. Scores each chunk against the query
 * using a simplified BM25 formula (term frequency + inverse document frequency).
 * No external dependencies; suitable for corpora under ~1000 chunks.
 */
export class KeywordRetriever implements RagRetriever {
  private readonly chunks: PolicyChunk[];
  /** IDF per term: log(N / df). Pre-computed on construction. */
  private readonly idf: Map<string, number>;

  constructor(chunks: PolicyChunk[]) {
    this.chunks = chunks;
    this.idf = computeIdf(chunks);
  }

  async retrieve(query: string, retailer?: RetailerId, topK: number = 3): Promise<PolicyHit[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const candidates = retailer
      ? this.chunks.filter((c) => c.retailer === retailer)
      : this.chunks;

    const scored = candidates.map((chunk) => ({
      chunk,
      score: bm25Score(queryTokens, chunk.tokens, this.idf),
    }));

    // Filter out zero-score hits, sort descending, take topK
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => ({
        retailer: s.chunk.retailer,
        title: s.chunk.title,
        content: s.chunk.content,
        source: s.chunk.source,
        score: normalize(s.score, scored),
      }));
  }
}

// ── BM25-lite scoring ──

const K1 = 1.2;
const B = 0.75;

function computeIdf(chunks: PolicyChunk[]): Map<string, number> {
  const N = chunks.length;
  const df = new Map<string, number>();

  for (const chunk of chunks) {
    const unique = new Set(chunk.tokens);
    for (const term of unique) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    // Standard BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    idf.set(term, Math.log((N - count + 0.5) / (count + 0.5) + 1));
  }
  return idf;
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
): number {
  const avgDl = 50; // approximate average doc length for this corpus
  const dl = docTokens.length;

  // Build term frequency map for doc
  const tf = new Map<string, number>();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const termIdf = idf.get(qt);
    if (!termIdf) continue;
    const freq = tf.get(qt) ?? 0;
    if (freq === 0) continue;
    // BM25 TF component
    const tfNorm = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / avgDl)));
    score += termIdf * tfNorm;
  }
  return score;
}

/** Normalize scores to 0–1 range relative to the best match. */
function normalize(
  score: number,
  all: Array<{ score: number }>,
): number {
  const max = Math.max(...all.map((s) => s.score));
  return max > 0 ? score / max : 0;
}
