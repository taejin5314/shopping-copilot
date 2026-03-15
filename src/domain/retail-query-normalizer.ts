// ──────────────────────────────────────────────
// Retail query normalizer — domain-aware pre-normalization for home-goods search
// ──────────────────────────────────────────────
//
// Problem: general-purpose search APIs and LLMs mis-categorise common retail
// queries when furniture-store context is missing.
//   e.g. "watch"  → wristwatch (wrong)  should be → wall clock
//        "mat"    → exercise mat (wrong) should be → floor mat / rug
//        "stand"  → trade-show stand (wrong) should be → floor lamp / tv stand
//        "시계"   → wristwatch (wrong)  same concept as "watch" above
//        "tapis"  → tapestry (wrong)    should be → rug
//
// Design:
//   1. A compact, language-agnostic AMBIGUOUS_TERMS map covers only the terms
//      where furniture-store context changes the correct category.  It is NOT
//      a comprehensive home-goods vocabulary — only true ambiguity cases belong.
//   2. normalizeForRetail() applies exact-match then token-level substitution and
//      returns a NormalizedQuery with a confidence rating.
//   3. The caller uses confidence to decide whether to call the LLM:
//        high   → map resolved it; use normalizedQuery directly, skip LLM.
//        medium → already valid English or partial hit; skip LLM.
//        low    → non-ASCII, no map hit; LLM translation still needed.

export interface NormalizedQuery {
  /** Best English search term to send to the retailer API. */
  normalizedQuery: string;
  /** Alternative candidates (for future multi-term search strategies). */
  candidateTerms: string[];
  /** Broad product category, or null when the query spans multiple categories. */
  category: string | null;
  /**
   * How reliable the normalization is:
   *   high   — resolved via the ambiguity map (deterministic).
   *   medium — already English or partial map hit; usable without LLM.
   *   low    — non-ASCII tokens present and no map hit; caller should use LLM.
   */
  confidence: "high" | "medium" | "low";
}

interface TermEntry {
  /** [primary, ...fallbacks] — primary is used for the search term. */
  en: readonly [string, ...string[]];
  category: string;
}

/**
 * Language-agnostic ambiguity map.
 *
 * Only terms where furniture-store context changes the correct output belong
 * here.  Keep this small and intentional — it is not a vocabulary list.
 * Unambiguous terms (sofa, chair, table) do not need an entry.
 *
 * Adding a term: one line.  The key is the raw search token (any language,
 * lowercase).  The value gives the preferred English retail term(s) and a
 * broad category string used for downstream filtering hints.
 */
const AMBIGUOUS_TERMS: Readonly<Record<string, TermEntry>> = {
  // ── English terms that carry the wrong meaning without retail context ──
  "watch":    { en: ["wall clock", "clock"],        category: "decor"    },
  "mat":      { en: ["rug", "floor mat"],            category: "floor"    },
  "stand":    { en: ["floor lamp", "tv stand"],      category: "lighting" },
  "console":  { en: ["console table"],               category: "tables"   },

  // ── Korean — same concepts as the English entries above ──
  "시계":     { en: ["wall clock", "clock"],         category: "decor"    },
  "매트":     { en: ["rug", "floor mat"],             category: "floor"    },
  "스탠드":   { en: ["floor lamp", "table lamp"],    category: "lighting" },
  "장":       { en: ["cabinet", "storage cabinet"],  category: "storage"  },
  "선반":     { en: ["shelf", "shelving unit"],      category: "storage"  },

  // ── French / other European ──
  "armoire":  { en: ["wardrobe"],                    category: "storage"  },
  "tapis":    { en: ["rug"],                         category: "floor"    },
};

/**
 * Normalises a retail search query into an English term suitable for a
 * furniture / home-goods search API.
 *
 * Algorithm:
 *  1. Exact match on the full query (case-insensitive).
 *     Handles single-term searches like "시계", "mat", "armoire".
 *  2. Token-level substitution for compound queries ("원목 선반", "quality mat"):
 *       - Tokens found in the map → replaced with the primary English term.
 *       - Unknown ASCII tokens  → kept as-is (English words, numbers).
 *       - Unknown non-ASCII tokens → dropped (adjectives / filler words).
 *     Confidence is "medium" when non-ASCII tokens were dropped (the product
 *     category is identified but modifiers may be lost).
 *  3. No map hit:
 *       - All ASCII  → confidence "medium" (likely already valid English).
 *       - Has non-ASCII → confidence "low" (caller should invoke LLM).
 *
 * Does NOT call the LLM.  The caller is responsible for LLM fallback when
 * confidence is "low".
 */
export function normalizeForRetail(query: string): NormalizedQuery {
  const q = query.trim();

  // 1. Exact match (case-insensitive)
  const exact = AMBIGUOUS_TERMS[q.toLowerCase()];
  if (exact) {
    return {
      normalizedQuery:  exact.en[0],
      candidateTerms:   [...exact.en],
      category:         exact.category,
      confidence:       "high",
    };
  }

  // 2. Token-level substitution
  const tokens = q.split(/\s+/);
  const resultTokens: string[] = [];
  let anyHit = false;
  let droppedNonAscii = false;

  for (const token of tokens) {
    const match = AMBIGUOUS_TERMS[token.toLowerCase()];
    if (match) {
      resultTokens.push(match.en[0]);
      anyHit = true;
    } else if (/^[\x00-\x7F]+$/.test(token)) {
      // Keep ASCII tokens (English words, measurements like "120cm")
      resultTokens.push(token);
    } else {
      // Drop unresolved non-ASCII tokens (adjectives / fillers: 원목, 좋은, ...)
      droppedNonAscii = true;
    }
  }

  if (anyHit && resultTokens.length > 0) {
    const normalized = resultTokens.join(" ");
    return {
      normalizedQuery:  normalized,
      candidateTerms:   [normalized],
      category:         null, // mixed tokens — no single category
      confidence:       droppedNonAscii ? "medium" : "high",
    };
  }

  // 3. No map hit
  const hasNonAscii = /[^\x00-\x7F]/.test(q);
  return {
    normalizedQuery:  q,
    candidateTerms:   [q],
    category:         null,
    confidence:       hasNonAscii ? "low" : "medium",
  };
}
