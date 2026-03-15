import { QueryInput } from "./schemas.js";
import { handleQuery } from "../orchestration/orchestrator.js";
import type { OrchestratorConfig, QueryContext } from "../orchestration/orchestrator.js";
import type { CopilotResponse, RecommendationResult } from "../core/types.js";
import { CopilotError } from "../core/types.js";
import type { RetailerAdapter } from "../core/adapter.js";
import type { RagRetriever } from "../rag/retriever.js";
import type { Synthesizer } from "../llm/synthesizer.js";
import { fallbackAnswer } from "../llm/synthesizer.js";
import type { LlmProvider } from "../llm/provider.js";
import { geocode } from "../domain/geocode.js";
import type { GeocodeOptions } from "../domain/geocode.js";

// ──────────────────────────────────────────────
// API entrypoint — single function surface
// ──────────────────────────────────────────────

export interface RetailerEntry {
  adapter: RetailerAdapter;
  retriever: RagRetriever;
}

export interface CopilotConfig {
  /** Default adapter (used when no retailer specified in request). */
  adapter: RetailerAdapter;
  /** Default retriever. */
  retriever: RagRetriever;
  /** Additional retailers keyed by retailerId. */
  retailers?: Record<string, RetailerEntry>;
  synthesizer?: Synthesizer;
  /** Optional LLM provider for lightweight tasks (e.g. keyword extraction). */
  llmProvider?: LlmProvider;
  maxStoreResults?: number;
  maxProductResults?: number;
  /** Options forwarded to the geocoder (e.g. injectable fetch for tests). */
  geocodeOptions?: GeocodeOptions;
}

/**
 * Main entrypoint for the shopping copilot.
 * Validates input, routes to the correct retailer, returns structured response.
 */
export async function ask(
  rawInput: unknown,
  config: CopilotConfig,
): Promise<CopilotResponse> {
  const parsed = QueryInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new CopilotError(
      "INVALID_ITEM",
      `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const { query, retailer: retailerKey, countryCode, locationText, location, radiusKm, cart } = parsed.data;
  // Auto-detect retailer from query text when not explicitly specified.
  const resolvedRetailerKey = retailerKey ??
    Object.keys(config.retailers ?? {}).find((id) => new RegExp(`\\b${id}\\b`, "i").test(query));

  // Resolve location: explicit coords take priority, then geocode locationText.
  let resolvedLocation = location;
  const warnings: string[] = [];
  if (!resolvedLocation && locationText) {
    const result = await geocode(locationText, config.geocodeOptions);
    if (result) {
      resolvedLocation = result.coords;
    } else {
      warnings.push(`Could not resolve location "${locationText}". Distance scoring disabled.`);
    }
  }

  const context: QueryContext = { retailer: retailerKey, countryCode, location: resolvedLocation, radiusKm, cart };

  // No explicit retailer → query all registered retailers in parallel.
  const allEntries: RetailerEntry[] = [
    { adapter: config.adapter, retriever: config.retriever },
    ...Object.values(config.retailers ?? {}),
  ];
  if (!resolvedRetailerKey && allEntries.length > 1) {
    const response = await queryAll(allEntries, query, config, context);
    response.warnings = [...warnings, ...response.warnings];
    return response;
  }

  const { adapter, retriever } = resolveRetailer(resolvedRetailerKey, config);
  const orchConfig: OrchestratorConfig = {
    adapter,
    retriever,
    synthesizer: config.synthesizer,
    llmProvider: config.llmProvider,
    maxStoreResults: config.maxStoreResults,
  };

  const response = await handleQuery(query, orchConfig, context);
  // Prepend geocode warnings so they appear first.
  response.warnings = [...warnings, ...response.warnings];
  return response;
}

function resolveRetailer(
  retailerKey: string | undefined,
  config: CopilotConfig,
): RetailerEntry {
  if (!retailerKey || retailerKey === config.adapter.retailerId) {
    return { adapter: config.adapter, retriever: config.retriever };
  }
  const entry = config.retailers?.[retailerKey];
  if (!entry) {
    throw new CopilotError("ADAPTER_NOT_FOUND", `No adapter registered for "${retailerKey}"`);
  }
  return entry;
}

async function queryAll(
  entries: RetailerEntry[],
  query: string,
  config: CopilotConfig,
  context: QueryContext,
): Promise<CopilotResponse> {
  const responses = await Promise.all(
    entries.map((entry) =>
      handleQuery(query, {
        adapter: entry.adapter,
        retriever: entry.retriever,
        // Do not synthesize per-retailer: queryAll merges and synthesizes once at the end.
        synthesizer: undefined,
        llmProvider: config.llmProvider,
        maxStoreResults: config.maxStoreResults,
        maxProductResults: config.maxProductResults,
      }, context).catch((err) => {
        console.error(`[ask] ${entry.adapter.retailerId} failed:`, err);
        return null;
      }),
    ),
  );
  const valid = responses.filter((r): r is CopilotResponse => r !== null);
  if (valid.length === 0) throw new CopilotError("INTERNAL", "All retailers failed to respond");

  const allRanked = valid
    .flatMap((r) => r.recommendation?.ranked ?? [])
    .sort((a, b) => b.totalScore - a.totalScore);
  const recommendation: RecommendationResult | null = allRanked.length > 0 ? {
    ranked: allRanked.slice(0, config.maxStoreResults ?? 5),
    // Deduplicate explanation points that repeat across retailers with identical store data
    explanationPoints: [...new Set(valid.flatMap((r) => r.recommendation?.explanationPoints ?? []))],
    warnings: [...new Set(valid.flatMap((r) => r.recommendation?.warnings ?? []))],
  } : null;

  const knowledge = valid.flatMap((r) => r.retrievedKnowledge);
  const warnings = [...new Set(valid.flatMap((r) => r.warnings))];
  const base = valid[0];
  // Deduplicate citations by URL (same product may appear from multiple retailer entries)
  const seenUrls = new Set<string>();
  const citations = valid.flatMap((r) => r.citations).filter((c) => {
    if (c.url === null) return true; // keep null-URL citations as-is
    if (seenUrls.has(c.url)) return false;
    seenUrls.add(c.url);
    return true;
  });

  // Merge products from individual responses, dedup by retailer+itemNo
  const seenProductKeys = new Set<string>();
  const products = valid.flatMap((r) => r.products ?? []).filter((p) => {
    const key = `${p.retailer}:${p.itemNo}`;
    if (seenProductKeys.has(key)) return false;
    seenProductKeys.add(key);
    return true;
  });

  const answer = config.synthesizer
    ? await config.synthesizer.synthesize({ query, intent: base.intent, recommendation, knowledge, products, warnings })
        .catch(() => fallbackAnswer({ query, intent: base.intent, recommendation, knowledge, products, warnings }))
    : fallbackAnswer({ query, intent: base.intent, recommendation, knowledge, products, warnings });

  return {
    intent: base.intent,
    toolCallsUsed: valid.flatMap((r) => r.toolCallsUsed),
    retrievedKnowledge: knowledge,
    recommendation,
    answer,
    citations,
    products,
    warnings,
  };
}
