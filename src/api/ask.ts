import { QueryInput } from "./schemas.js";
import { handleQuery } from "../orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../orchestration/orchestrator.js";
import type { CopilotResponse } from "../core/types.js";
import { CopilotError } from "../core/types.js";
import type { RetailerAdapter } from "../core/adapter.js";
import type { RagRetriever } from "../rag/retriever.js";
import type { Synthesizer } from "../llm/synthesizer.js";

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
  maxStoreResults?: number;
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

  const { query, retailer: retailerKey, countryCode, cart } = parsed.data;
  const { adapter, retriever } = resolveRetailer(retailerKey, config);

  const orchConfig: OrchestratorConfig = {
    adapter,
    retriever,
    synthesizer: config.synthesizer,
    maxStoreResults: config.maxStoreResults,
  };

  return handleQuery(query, orchConfig, { retailer: retailerKey, countryCode, cart });
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
