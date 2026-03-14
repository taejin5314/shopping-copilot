import type {
  CopilotResponse,
  ToolCallRecord,
  PolicyHit,
  RecommendationResult,
  Citation,
  StoreStock,
  ClassifiedIntent,
  ProductInfo,
} from "../core/types.js";
import { CopilotError } from "../core/types.js";
import type { RetailerAdapter } from "../core/adapter.js";
import type { RagRetriever } from "../rag/retriever.js";
import type { Synthesizer } from "../llm/synthesizer.js";
import { fallbackAnswer } from "../llm/synthesizer.js";
import type { LlmProvider } from "../llm/provider.js";
import { extractSearchTerms } from "../llm/keyword-extractor.js";
import { classifyIntent } from "../domain/intent.js";
import { rankStores, buildRecommendation } from "../domain/scoring.js";
import type { CartItem, ScoringContext } from "../domain/scoring.js";
import type { GeoCoord } from "../domain/geo.js";

// ──────────────────────────────────────────────
// Orchestration — routes intent → adapters/RAG → scorer → response
// ──────────────────────────────────────────────

export interface OrchestratorConfig {
  adapter: RetailerAdapter;
  retriever: RagRetriever;
  /** Optional LLM synthesizer. Falls back to deterministic answer if absent. */
  synthesizer?: Synthesizer;
  /** Optional LLM provider for lightweight tasks (e.g. keyword extraction). */
  llmProvider?: LlmProvider;
  maxStoreResults?: number;
  maxProductResults?: number;
}

export interface QueryContext {
  /** Override retailer (default: adapter's retailerId). */
  retailer?: string;
  /** Override country code. */
  countryCode?: string;
  /** User location for distance-based scoring. */
  location?: GeoCoord;
  /** Pre-parsed cart items (skip extraction from query). */
  cart?: CartItem[];
}

/** Build a descriptive citation label that distinguishes product variants. */
function productCitationLabel(p: ProductInfo): string {
  const extras: string[] = [];
  if (p.designText) extras.push(p.designText);
  if (p.measureText) extras.push(p.measureText);
  if (extras.length > 0) return `${p.name} — ${extras.join(", ")}`;
  // No variant info available — append SKU so same-named variants are distinguishable
  return `${p.name} (${p.itemNo})`;
}

export async function handleQuery(
  query: string,
  config: OrchestratorConfig,
  context?: QueryContext,
): Promise<CopilotResponse> {
  const intent: ClassifiedIntent = classifyIntent(query);
  const toolCalls: ToolCallRecord[] = [];
  const warnings: string[] = [];

  // If user provided a cart, treat as stock query regardless of intent classification.
  // This handles non-English queries and ambiguous intents where the cart is a strong signal.
  const hasExplicitCart = (context?.cart?.length ?? 0) > 0;
  if (hasExplicitCart && intent.type === "unknown") {
    console.error(`[orchestrator] Cart override: unknown → stock (cart has ${context!.cart!.length} items)`);
    intent.type = "stock";
  }
  let recommendation: RecommendationResult | null = null;
  let retrievedKnowledge: PolicyHit[] = [];
  let foundProducts: ProductInfo[] = [];
  const citations: Citation[] = [];

  const { adapter, retriever } = config;
  const countryCode = context?.countryCode ?? intent.countryCode ?? undefined;

  try {
    // ── Stock / Recommendation path ──
    if (needsStock(intent)) {
      const cart = context?.cart ?? cartFromIntent(intent);

      if (cart.length === 0) {
        warnings.push("No item numbers detected in the query. Please specify the item numbers you are looking for.");
      } else {
        try {
          const storeStocks = await fetchStoreStocks(adapter, cart, countryCode, intent, config, toolCalls);
          const itemPrices = await fetchItemPrices(adapter, cart, countryCode, toolCalls);
          const scoringCtx: ScoringContext = {
            userLocation: context?.location,
            getItemPrice: itemPrices
              ? (_storeId, itemNo) => itemPrices[itemNo] ?? null
              : undefined,
          };
          const ranked = rankStores(storeStocks, cart, undefined, scoringCtx);
          recommendation = buildRecommendation(ranked, cart, config.maxStoreResults ?? 3);
          if (!context?.location) {
            warnings.push("No user location provided — distance scoring was not applied.");
          }
          if (!itemPrices) {
            warnings.push("Price data not available — price scoring was not applied.");
          }
          const allStockUnknown = storeStocks.every((ss) =>
            ss.items.every((item) => item.stockLevel === "UNKNOWN"),
          );
          if (allStockUnknown) {
            warnings.push("Real-time stock levels unavailable for this retailer — rankings reflect location and convenience only.");
          }
          warnings.push(...recommendation.warnings);
        } catch (err) {
          const msg = err instanceof CopilotError ? err.message : String(err);
          warnings.push(`Stock lookup failed: ${msg}`);
        }
      }
    }

    // ── Policy / FAQ path ──
    if (needsPolicy(intent)) {
      retrievedKnowledge = await fetchPolicy(retriever, query, adapter.retailerId, toolCalls);
      if (retrievedKnowledge.length === 0) {
        warnings.push("No relevant policy documents found.");
      }
      for (const hit of retrievedKnowledge) {
        if (hit.source) citations.push({ label: hit.title, url: hit.source });
      }
    }

    // ── Product info path ──
    if (intent.type === "product_info" && intent.itemNos.length > 0) {
      // Delegate to search — lightweight for now
      foundProducts = await timed(
        () => adapter.searchProducts(intent.itemNos[0], { countryCode, maxResults: config.maxProductResults ?? 3 }),
        "search_products",
        adapter.retailerId,
        toolCalls,
      );
      if (foundProducts.length > 0) {
        citations.push({ label: productCitationLabel(foundProducts[0]), url: foundProducts[0].url });
      }
    }

    // ── Unknown intent — product search fallback ──
    if (intent.type === "unknown") {
      // If query text exists but intent is unrecognized (e.g. non-English),
      // try a product search as a best-effort fallback.
      // If the original query contains non-ASCII characters AND we have an LLM,
      // translate to English keywords first so the retailer API can understand.
      let searchQuery = query;
      if (config.llmProvider) {
        const translated = await extractSearchTerms(query, config.llmProvider);
        console.error(`[orchestrator] keyword extraction: "${query}" → "${translated}"`);
        if (translated) searchQuery = translated;
      } else {
        console.error("[orchestrator] no llmProvider configured — skipping keyword extraction");
      }

      try {
        console.error(`[orchestrator] product search fallback query: "${searchQuery}"`);
        const products = await timed(
          () => adapter.searchProducts(searchQuery, { countryCode, maxResults: config.maxProductResults ?? 3 }),
          "search_products",
          adapter.retailerId,
          toolCalls,
        );
        console.error(`[orchestrator] product search returned ${products.length} results`);
        if (products.length > 0) {
          intent.type = "product_info";
          foundProducts = products;
          for (const p of products) {
            if (p.url) citations.push({ label: productCitationLabel(p), url: p.url });
          }
          // Auto-rank stores for the found products so the user gets a recommendation,
          // not just a flat product list. Limit to top 3 products to avoid excess API calls.
          try {
            const topCart: CartItem[] = products.slice(0, 3).map((p) => ({ itemNo: p.itemNo, quantity: 1 }));
            const storeStocks = await fetchStoreStocks(adapter, topCart, countryCode, intent, config, toolCalls);
            const scoringCtx: ScoringContext = { userLocation: context?.location };
            const ranked = rankStores(storeStocks, topCart, undefined, scoringCtx);
            recommendation = buildRecommendation(ranked, topCart, config.maxStoreResults ?? 3);
            const allStockUnknown = storeStocks.every((ss) =>
              ss.items.every((item) => item.stockLevel === "UNKNOWN"),
            );
            if (allStockUnknown) {
              warnings.push("Real-time stock levels unavailable for this retailer — rankings reflect location and convenience only.");
            }
            warnings.push(...recommendation.warnings);
          } catch (rankErr) {
            console.error("[orchestrator] store ranking after product search failed:", rankErr);
            // Non-fatal: products are still returned even if store ranking fails
          }
        } else {
          warnings.push("Could not determine the intent of your question. Try asking about stock availability, store comparison, or return policies.");
        }
      } catch (err) {
        console.error("[orchestrator] product search fallback failed:", err);
        warnings.push("Could not determine the intent of your question. Try asking about stock availability, store comparison, or return policies.");
      }
    }

    const answer = config.synthesizer
      ? await config.synthesizer.synthesize({ query, intent, recommendation, knowledge: retrievedKnowledge, products: foundProducts, warnings })
      : fallbackAnswer({ query, intent, recommendation, knowledge: retrievedKnowledge, products: foundProducts, warnings });

    return {
      intent,
      toolCallsUsed: toolCalls,
      retrievedKnowledge,
      recommendation,
      answer,
      citations,
      products: foundProducts.length > 0 ? foundProducts : undefined,
      warnings,
    };
  } catch (err) {
    if (err instanceof CopilotError) throw err;
    throw new CopilotError("INTERNAL", `Orchestration failed: ${String(err)}`, adapter.retailerId, err);
  }
}

// ── Helpers ──

function needsStock(intent: ClassifiedIntent): boolean {
  return intent.type === "stock" || intent.type === "recommendation" || intent.secondary.includes("stock");
}

function needsPolicy(intent: ClassifiedIntent): boolean {
  return intent.type === "policy" || intent.secondary.includes("policy");
}

function cartFromIntent(intent: ClassifiedIntent): CartItem[] {
  return intent.itemNos.map((itemNo) => ({ itemNo, quantity: 1 }));
}

async function fetchStoreStocks(
  adapter: RetailerAdapter,
  cart: CartItem[],
  countryCode: string | undefined,
  intent: ClassifiedIntent,
  config: OrchestratorConfig,
  toolCalls: ToolCallRecord[],
): Promise<StoreStock[]> {
  const storeIds = intent.storeHints.length > 0 ? intent.storeHints : undefined;
  return timed(
    () => adapter.findStoresForCart(cart, {
      storeIds,
      countryCode,
      maxResults: config.maxStoreResults ?? 10,
    }),
    "find_best_store_for_cart",
    adapter.retailerId,
    toolCalls,
  );
}

async function fetchPolicy(
  retriever: RagRetriever,
  query: string,
  retailerId: string,
  toolCalls: ToolCallRecord[],
): Promise<PolicyHit[]> {
  return timed(
    () => retriever.retrieve(query, retailerId, 3),
    "rag_retrieve",
    retailerId,
    toolCalls,
  );
}

/**
 * Best-effort price lookup for cart items via searchProducts.
 * Returns a map of itemNo → unit price, or undefined if no prices found.
 */
async function fetchItemPrices(
  adapter: RetailerAdapter,
  cart: CartItem[],
  countryCode: string | undefined,
  toolCalls: ToolCallRecord[],
): Promise<Record<string, number> | undefined> {
  const prices: Record<string, number> = {};
  for (const item of cart) {
    try {
      const products = await timed(
        () => adapter.searchProducts(item.itemNo, { countryCode, maxResults: 5 }),
        "search_products_price",
        adapter.retailerId,
        toolCalls,
      );
      const match = products.find((p) => p.itemNo === item.itemNo);
      if (match?.price) {
        prices[item.itemNo] = match.price.amount;
      }
    } catch {
      // Individual item price lookup failure is non-fatal
    }
  }
  return Object.keys(prices).length > 0 ? prices : undefined;
}

async function timed<T>(
  fn: () => Promise<T>,
  toolName: string,
  retailer: string,
  toolCalls: ToolCallRecord[],
): Promise<T> {
  const start = performance.now();
  let success = true;
  try {
    return await fn();
  } catch (err) {
    success = false;
    throw err;
  } finally {
    toolCalls.push({
      tool: toolName,
      retailer,
      input: {},
      durationMs: Math.round(performance.now() - start),
      success,
    });
  }
}
