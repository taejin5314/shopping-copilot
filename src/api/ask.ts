import { QueryInput } from "./schemas.js";
import { handleQuery } from "../orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../orchestration/orchestrator.js";
import type { CopilotResponse } from "../core/types.js";
import { CopilotError } from "../core/types.js";
import type { RetailerAdapter } from "../core/adapter.js";
import type { RagRetriever } from "../rag/retriever.js";
import type { Synthesizer } from "../llm/synthesizer.js";
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

  const { query, retailer: retailerKey, countryCode, locationText, location, cart } = parsed.data;
  const { adapter, retriever } = resolveRetailer(retailerKey, config);

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

  const orchConfig: OrchestratorConfig = {
    adapter,
    retriever,
    synthesizer: config.synthesizer,
    llmProvider: config.llmProvider,
    maxStoreResults: config.maxStoreResults,
  };

  const response = await handleQuery(query, orchConfig, {
    retailer: retailerKey,
    countryCode,
    location: resolvedLocation,
    cart,
  });
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
