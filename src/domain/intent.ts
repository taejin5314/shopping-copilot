import type { ClassifiedIntent, IntentType } from "../core/types.js";

// ──────────────────────────────────────────────
// Deterministic intent classifier (v1 — pattern-based)
// ──────────────────────────────────────────────

interface PatternRule {
  intent: IntentType;
  /** Patterns that signal this intent. Matched case-insensitively against the query. */
  patterns: RegExp[];
  /** Higher weight = stronger signal when multiple intents match. */
  weight: number;
}

const RULES: PatternRule[] = [
  {
    intent: "stock",
    patterns: [
      /\b(?:stock|in[- ]?stock|out[- ]?of[- ]?stock|availab|inventory)\b/i,
      /\b(?:which store|best store|nearest store|find.*store|compare.*store)\b/i,
      /\b(?:how many|quantity|left|remaining)\b/i,
      /\b(?:can I (?:buy|get|pick ?up))\b/i,
    ],
    weight: 1.0,
  },
  {
    intent: "policy",
    patterns: [
      /\b(?:return|refund|exchange|warranty)\b/i,
      /\b(?:delivery|shipping|ship|deliver)\b/i,
      /\b(?:pickup|pick[- ]?up|click.?collect)\b/i,
      /\b(?:policy|policies|FAQ|guide|rule)\b/i,
      /\b(?:assembl\w*|measure|dimension|install)\b/i,
      /\b(?:how (?:long|do|does|can|to))\b/i,
    ],
    weight: 0.9,
  },
  {
    intent: "recommendation",
    patterns: [
      /\b(?:recommend|suggest|should I|best|compare|which (?:one|is better))\b/i,
      /\b(?:alternative|similar|instead|option)\b/i,
      /\b(?:cheapest|affordable|budget|deal)\b/i,
    ],
    weight: 0.8,
  },
  {
    intent: "product_info",
    patterns: [
      /\b(?:price|cost|how much)\b/i,
      /\b(?:detail|spec|description|material|color|size)\b/i,
      /\b(?:what is|tell me about|info)\b/i,
      /\b(?:search|look ?up|find)\b.*\b(?:product|item|furniture)\b/i,
    ],
    weight: 0.7,
  },
];

// Item number patterns (IKEA-style: 8 digits, dotted, dashed)
const ITEM_NO_RE = /\b\d{3}[.\-]\d{3}[.\-]\d{2}\b|\b\d{6,9}\b/g;

// Country code after "in" or standalone
const COUNTRY_RE = /\b(?:in\s+)?(US|CA|Canada|United States)\b/i;

// Store ID (3-4 digit number after "store" context)
const STORE_HINT_RE = /\bstore\s*#?\s*(\d{3,4})\b/i;

export function classifyIntent(query: string): ClassifiedIntent {
  const matches: Array<{ intent: IntentType; score: number }> = [];

  for (const rule of RULES) {
    const matchCount = rule.patterns.filter((p) => p.test(query)).length;
    if (matchCount > 0) {
      matches.push({
        intent: rule.intent,
        score: (matchCount / rule.patterns.length) * rule.weight,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  const primary = matches[0]?.intent ?? "unknown";
  const secondary = matches
    .slice(1)
    .filter((m) => m.score > 0.2) // only meaningful secondary intents
    .map((m) => m.intent);

  // Extract item numbers
  const itemNos = [...query.matchAll(ITEM_NO_RE)].map((m) => m[0]);

  // Extract country code
  const countryMatch = query.match(COUNTRY_RE);
  let countryCode: string | null = null;
  if (countryMatch) {
    const raw = countryMatch[1].toUpperCase();
    countryCode = raw === "CANADA" ? "CA" : raw === "UNITED STATES" ? "US" : raw;
  }

  // Extract store hints
  const storeHints: string[] = [];
  const storeMatch = query.match(STORE_HINT_RE);
  if (storeMatch) storeHints.push(storeMatch[1]);

  const confidence = matches[0]?.score ?? 0;

  return { type: primary, secondary, itemNos, storeHints, countryCode, confidence };
}
