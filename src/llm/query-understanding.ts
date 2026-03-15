import { z } from "zod";
import type { LlmProvider } from "./provider.js";

// ──────────────────────────────────────────────
// Query Understanding Agent — normalizes raw queries into structured shopping fields
// Uses Claude as the parsing brain; returns a structured JSON object.
// ──────────────────────────────────────────────

// ── Schema ──

export const QueryUnderstandingOutputSchema = z.object({
  /** Main product category as a short English noun phrase (e.g. "sofa bed", "desk"). Empty string if unknown. */
  category: z.string(),
  /** Key search terms useful for a product search engine. */
  keywords: z.array(z.string()),
  /** Lower budget bound in the user's currency. Null if not mentioned. */
  budgetMin: z.number().nullable(),
  /** Upper budget bound in the user's currency. Null if not mentioned. */
  budgetMax: z.number().nullable(),
  /** Color mentioned by the user, or null. */
  color: z.string().nullable(),
  /** Size descriptor (e.g. "queen", "small", "90x200cm"), or null. */
  size: z.string().nullable(),
  /** Material mentioned (e.g. "oak", "leather"), or null. */
  material: z.string().nullable(),
  /** Aesthetic style mentioned (e.g. "minimalist", "scandinavian"), or null. */
  style: z.string().nullable(),
  /** Explicit retailer preference, or "all" if none specified. */
  retailerPreference: z.enum(["ikea", "structube", "all", "unknown"]),
  /** True only when the user explicitly requires the item to be in stock. */
  mustBeInStock: z.boolean(),
  /** All location hints extracted verbatim (e.g. ["near me", "in Vancouver"]). */
  locationTerms: z.array(z.string()),
  /** Whether the query refers to one or multiple distinct products. */
  itemCardinality: z.enum(["single", "multiple", "unknown"]),
  /** Warnings for downstream agents: vague category, missing info, ambiguities. */
  warnings: z.array(z.string()),
});

export type QueryUnderstandingOutput = z.infer<typeof QueryUnderstandingOutputSchema>;

// ── Failure types ──

export type QueryUnderstandingFailureReason =
  | "provider_error"
  | "invalid_json"
  | "schema_error"
  | "empty_response"
  | "timeout";

export type QueryUnderstandingResult =
  | { ok: true; output: QueryUnderstandingOutput }
  | { ok: false; reason: QueryUnderstandingFailureReason; detail?: string };

// ── Options ──

export interface QueryUnderstandingCallOpts {
  /** Abort the provider call after this many ms and return a timeout failure. */
  timeoutMs?: number;
}

// ── System prompt ──

const QU_SYSTEM_PROMPT = `You are the Query Understanding Agent for a shopping copilot application.

Your job is NOT to search products, check inventory, compare stores, or generate recommendations.

Your only responsibility is to parse and normalize the user's shopping query into a structured JSON object so downstream agents can search products and check inventory more effectively.

## Primary responsibilities

Given a user shopping query, extract:
1. Product category
2. Key search keywords
3. Budget range (min / max)
4. Product attributes: color, size, material, style
5. Retailer preference
6. Whether the user explicitly needs in-stock items
7. Location terms mentioned
8. How many distinct items (single vs multiple)
9. Any ambiguities worth flagging

## Field rules

### category
The main product category as a short English noun phrase (e.g. "sofa bed", "desk", "dining table", "bed frame").
Use an empty string if the category cannot be determined.

### keywords
An array of specific English search terms. Include the product name, key adjectives, and any descriptor that would help a search engine find the right product.
Minimum 1 keyword. Maximum 8. Translate to English if the query is in another language.

### budgetMin / budgetMax
Extract numeric budget bounds in the user's currency without converting.
- "under $800" → budgetMin: null, budgetMax: 800
- "over $500" / "$500+" → budgetMin: 500, budgetMax: null
- "between $300 and $700" / "$300–$700" → budgetMin: 300, budgetMax: 700
- No budget mentioned → both null

### color
The color the user mentioned (e.g. "white", "dark brown", "grey"). Null if not mentioned.

### size
A size descriptor (e.g. "queen", "king", "small", "large", "90x200cm"). Null if not mentioned.

### material
The material mentioned (e.g. "oak", "leather", "velvet", "fabric", "metal"). Null if not mentioned.

### style
The aesthetic style mentioned (e.g. "minimalist", "scandinavian", "modern", "industrial"). Null if not mentioned.

### retailerPreference
- "ikea" if the user explicitly mentioned IKEA
- "structube" if the user explicitly mentioned Structube
- "all" if the user did not specify a retailer
- "unknown" if the query is too incomplete to decide

### mustBeInStock
True only when the user explicitly requires availability.
Trigger phrases: "must be in stock", "available now", "in stock", "has it in stock".
Default: false.

### locationTerms
All location hints as verbatim strings. Examples:
- "near me" → ["near me"]
- "in Vancouver" → ["in Vancouver"]
- "near downtown Toronto" → ["near downtown Toronto"]
- Multiple → include all
Empty array if no location is mentioned.

### itemCardinality
- "single" — one distinct product type
- "multiple" — multiple distinct product types or a cart
- "unknown" — genuinely unclear

### warnings
Include a warning when:
- Category is empty or too vague to search
- Product is described so loosely that a search is unlikely to find the right item
- Multiple conflicting attributes are detected

## Hard rules
- Do not invent product IDs, SKUs, or prices.
- Do not recommend any specific products.
- Do not assume stock levels.
- Extract only what the user explicitly stated or strongly implied.
- Return JSON only — no prose, no explanation.

## Output format

Return a single JSON object with this exact shape:

{
  "category": string,
  "keywords": string[],
  "budgetMin": number | null,
  "budgetMax": number | null,
  "color": string | null,
  "size": string | null,
  "material": string | null,
  "style": string | null,
  "retailerPreference": "ikea" | "structube" | "all" | "unknown",
  "mustBeInStock": boolean,
  "locationTerms": string[],
  "itemCardinality": "single" | "multiple" | "unknown",
  "warnings": string[]
}`;

// ── Structured logging ──

function quLog(fields: Record<string, unknown>): void {
  console.error("[query-understanding]", JSON.stringify(fields));
}

// ── JSON extraction ──

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

// ── Core implementation ──

/**
 * Parses a user shopping query and returns a discriminated QueryUnderstandingResult.
 * Failure reasons: provider_error | invalid_json | schema_error | empty_response | timeout.
 * Never throws — all errors are captured in the result.
 */
export async function runQueryUnderstandingDetailed(
  query: string,
  provider: LlmProvider,
  opts?: QueryUnderstandingCallOpts,
): Promise<QueryUnderstandingResult> {
  // ── Provider call (with optional timeout) ──
  let rawContent: string;
  try {
    const call = provider.complete(
      [
        { role: "system", content: QU_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      { maxTokens: 512, temperature: 0 },
    );

    let response: { content: string };
    if (opts?.timeoutMs) {
      let timedOut = false;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, opts.timeoutMs),
      );
      try {
        response = await Promise.race([call, timeoutPromise]);
      } catch (err) {
        const reason: QueryUnderstandingFailureReason = timedOut ? "timeout" : "provider_error";
        const detail = err instanceof Error ? err.message : String(err);
        quLog({ event: "qu_failed", reason, detail });
        return { ok: false, reason, detail };
      }
    } else {
      response = await call;
    }
    rawContent = response.content;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    quLog({ event: "qu_failed", reason: "provider_error", detail });
    return { ok: false, reason: "provider_error", detail };
  }

  // ── Empty response ──
  const text = rawContent.trim();
  if (!text) {
    quLog({ event: "qu_failed", reason: "empty_response" });
    return { ok: false, reason: "empty_response" };
  }

  // ── JSON extraction ──
  const jsonText = text.startsWith("{") ? text : extractJson(text);
  if (!jsonText) {
    quLog({ event: "qu_failed", reason: "invalid_json", detail: "no JSON object found in response" });
    return { ok: false, reason: "invalid_json", detail: "no JSON object found in response" };
  }

  // ── JSON parse ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    quLog({ event: "qu_failed", reason: "invalid_json", detail });
    return { ok: false, reason: "invalid_json", detail };
  }

  // ── Schema validation ──
  const validated = QueryUnderstandingOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const detail = validated.error.issues.map((i) => i.message).join("; ");
    quLog({ event: "qu_failed", reason: "schema_error", detail });
    return { ok: false, reason: "schema_error", detail };
  }

  quLog({
    event: "qu_succeeded",
    category: validated.data.category,
    keywordCount: validated.data.keywords.length,
    budgetMin: validated.data.budgetMin,
    budgetMax: validated.data.budgetMax,
    retailerPreference: validated.data.retailerPreference,
    itemCardinality: validated.data.itemCardinality,
    mustBeInStock: validated.data.mustBeInStock,
    warningCount: validated.data.warnings.length,
  });

  return { ok: true, output: validated.data };
}

/**
 * Parses a user shopping query into a normalized QueryUnderstandingOutput.
 * Returns null on any failure — callers treat null as "QU unavailable, use raw query".
 */
export async function runQueryUnderstanding(
  query: string,
  provider: LlmProvider,
  opts?: QueryUnderstandingCallOpts,
): Promise<QueryUnderstandingOutput | null> {
  const result = await runQueryUnderstandingDetailed(query, provider, opts);
  return result.ok ? result.output : null;
}
