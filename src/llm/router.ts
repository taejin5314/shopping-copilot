import { z } from "zod";
import type { LlmProvider } from "./provider.js";

// ──────────────────────────────────────────────
// Router Agent — classifies queries into routing decisions
// Uses Claude as the routing brain; returns a structured JSON decision.
// ──────────────────────────────────────────────

// ── Schema ──

export const RouterOutputSchema = z.object({
  intent: z.enum(["search_product", "find_best_store", "check_cart"]),
  retailerScope: z.enum(["ikea", "structube", "all", "unknown"]),
  locationRequired: z.boolean(),
  locationProvided: z.boolean(),
  itemCardinality: z.enum(["single", "multiple", "unknown"]),
  nextAgent: z.enum(["query_understanding", "product_finder", "inventory_store", "response"]),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  reasoningSummary: z.string(),
});

export type RouterOutput = z.infer<typeof RouterOutputSchema>;

// ── Failure types ──

export type RouterFailureReason =
  | "provider_error"
  | "invalid_json"
  | "schema_error"
  | "empty_response"
  | "timeout";

export type RouterResult =
  | { ok: true; output: RouterOutput }
  | { ok: false; reason: RouterFailureReason; detail?: string };

// ── Options ──

export interface RouterCallOpts {
  /** Abort the provider call after this many ms and return a timeout failure. */
  timeoutMs?: number;
}

// ── System prompt ──

const ROUTER_SYSTEM_PROMPT = `You are the Router Agent for a shopping copilot application.

Your job is NOT to search products, check inventory, compare stores, or generate final shopping recommendations.

Your only responsibility is to classify the user's request into a structured routing decision so downstream agents and tools can handle it.

You must read the user's message and return a single JSON object only.

## Primary responsibilities

Given a user shopping-related query, determine:

1. intent
2. retailerScope
3. whether location matters
4. whether the request refers to a single item or multiple items
5. what the next agent should be
6. whether there are ambiguities or warnings that downstream agents should know

## Allowed intents

You must choose exactly one of the following intents:

- "search_product"
  - The user is looking for a product, product type, recommendation, or options.
  - Examples:
    - "I want a comfortable sofa bed under $800"
    - "Find me a good desk for a small apartment"
    - "Show me dining tables"

- "find_best_store"
  - The user already has a product or product candidate and wants the best store, nearest store, best availability, or best pickup option.
  - Examples:
    - "Which store near Vancouver has this in stock?"
    - "Find the best store for this item"
    - "Where should I buy this near me?"

- "check_cart"
  - The user wants to know whether multiple items can be bought together from one store, or wants cart-level availability.
  - Examples:
    - "Can I get these 3 items from one store?"
    - "Check if this cart is available near Toronto"
    - "Which store has all of these items?"

## Allowed retailerScope values

Choose exactly one:

- "ikea"
- "structube"
- "all"
- "unknown"

Rules:
- Use a specific retailer if the user explicitly mentions it.
- Use "all" if the user does not specify a retailer and the request sounds retailer-agnostic.
- Use "unknown" only if the request is too incomplete to decide.

## Allowed nextAgent values

Choose exactly one:

- "query_understanding"
- "product_finder"
- "inventory_store"
- "response"

Normally:
- "search_product" -> "query_understanding"
- "find_best_store" -> "inventory_store" if the item is already identified, otherwise "query_understanding"
- "check_cart" -> "inventory_store" if the cart/items are already identified, otherwise "query_understanding"

## Input interpretation rules

- Do not invent product IDs, store IDs, SKUs, or retailer names.
- Do not assume stock availability.
- Do not assume geographic proximity unless location is clearly mentioned.
- Do not perform recommendation logic.
- Do not rewrite the user's request into a final answer.
- Do not ask follow-up questions.
- Do your best with the information available.

## Location rules

Set "locationRequired" to true if the request depends on proximity, nearest store, local stock, or a city/area-based decision.

Set "locationProvided" to true if the user explicitly gives a city, region, neighborhood, or phrases like:
- "near me"
- "near Toronto"
- "in Vancouver"
- "close to North York"

If "near me" is used, treat locationRequired as true and locationProvided as true, because downstream systems may resolve user location separately.

## Item cardinality rules

Set "itemCardinality" to:
- "single" for one product/item request
- "multiple" for cart or multiple distinct items
- "unknown" when unclear

## Ambiguity handling

Include warnings when:
- the request is too vague
- the product is not clearly identified
- the request mixes multiple goals
- retailer scope is unclear
- store-finding is requested without a usable product reference

## Output format

Return JSON only with this exact shape:

{
  "intent": "search_product" | "find_best_store" | "check_cart",
  "retailerScope": "ikea" | "structube" | "all" | "unknown",
  "locationRequired": true | false,
  "locationProvided": true | false,
  "itemCardinality": "single" | "multiple" | "unknown",
  "nextAgent": "query_understanding" | "product_finder" | "inventory_store" | "response",
  "confidence": number,
  "warnings": string[],
  "reasoningSummary": string
}

## Confidence

Return a confidence score from 0 to 1.
Use lower confidence when the request is vague or mixes multiple tasks.

## reasoningSummary

Keep this brief and operational, 1-2 sentences max.
It should explain why you chose the route.
Do not include chain-of-thought.
Do not include hidden reasoning.
Just provide a short decision summary.`;

// ── Structured logging ──

function routerLog(fields: Record<string, unknown>): void {
  console.error("[router]", JSON.stringify(fields));
}

// ── JSON extraction ──

function extractJson(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

// ── Core implementation ──

/**
 * Routes a user query and returns a discriminated RouterResult.
 * Failure reasons are one of: provider_error | invalid_json | schema_error | empty_response | timeout.
 * Never throws — all errors are captured in the result.
 */
export async function routeQueryDetailed(
  query: string,
  provider: LlmProvider,
  opts?: RouterCallOpts,
): Promise<RouterResult> {
  // ── Provider call (with optional timeout) ──
  let rawContent: string;
  try {
    const call = provider.complete(
      [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      { maxTokens: 300, temperature: 0 },
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
        const reason: RouterFailureReason = timedOut ? "timeout" : "provider_error";
        const detail = err instanceof Error ? err.message : String(err);
        routerLog({ event: "routing_failed", reason, detail });
        return { ok: false, reason, detail };
      }
    } else {
      response = await call;
    }
    rawContent = response.content;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    routerLog({ event: "routing_failed", reason: "provider_error", detail });
    return { ok: false, reason: "provider_error", detail };
  }

  // ── Empty response ──
  const text = rawContent.trim();
  if (!text) {
    routerLog({ event: "routing_failed", reason: "empty_response" });
    return { ok: false, reason: "empty_response" };
  }

  // ── JSON extraction (strip markdown fences and surrounding prose) ──
  const jsonText = text.startsWith("{") ? text : extractJson(text);
  if (!jsonText) {
    routerLog({ event: "routing_failed", reason: "invalid_json", detail: "no JSON object found in response" });
    return { ok: false, reason: "invalid_json", detail: "no JSON object found in response" };
  }

  // ── JSON parse ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    routerLog({ event: "routing_failed", reason: "invalid_json", detail });
    return { ok: false, reason: "invalid_json", detail };
  }

  // ── Schema validation ──
  const validated = RouterOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const detail = validated.error.issues.map((i) => i.message).join("; ");
    routerLog({ event: "routing_failed", reason: "schema_error", detail });
    return { ok: false, reason: "schema_error", detail };
  }

  routerLog({
    event: "routing_succeeded",
    intent: validated.data.intent,
    retailerScope: validated.data.retailerScope,
    confidence: validated.data.confidence,
    nextAgent: validated.data.nextAgent,
    warningCount: validated.data.warnings.length,
  });

  return { ok: true, output: validated.data };
}

/**
 * Routes a user query via Claude, returning a structured RouterOutput.
 * Returns null on any failure — callers must treat null as "router unavailable, proceed with defaults".
 * This is the primary public surface; it preserves the RouterOutput | null contract for existing callers.
 */
export async function routeQuery(
  query: string,
  provider: LlmProvider,
  opts?: RouterCallOpts,
): Promise<RouterOutput | null> {
  const result = await routeQueryDetailed(query, provider, opts);
  return result.ok ? result.output : null;
}
