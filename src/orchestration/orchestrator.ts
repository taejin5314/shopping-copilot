import type {
  CopilotResponse,
  ToolCallRecord,
  PolicyHit,
  RecommendationResult,
  Citation,
  StoreStock,
  ClassifiedIntent,
  ProductInfo,
  ExplanationOutput,
} from "../core/types.js";
import { CopilotError } from "../core/types.js";
import type { RetailerAdapter } from "../core/adapter.js";
import type { RagRetriever } from "../rag/retriever.js";
import type { Synthesizer } from "../llm/synthesizer.js";
import { fallbackAnswer } from "../llm/synthesizer.js";
import type { LlmProvider } from "../llm/provider.js";
import { extractSearchTerms } from "../llm/keyword-extractor.js";
import type { RouterOutput } from "../llm/router.js";
import type { QueryUnderstandingOutput } from "../llm/query-understanding.js";
import { normalizeForRetail } from "../domain/retail-query-normalizer.js";
import { findProducts, candidateToProductInfo } from "../domain/product-finder.js";
import type { ProductCandidate } from "../domain/product-finder.js";
import { buildExplanation } from "../domain/explanation.js";
import type { ExplanationInput } from "../domain/explanation.js";
import { classifyIntent } from "../domain/intent.js";
import { rankStores, buildRecommendation } from "../domain/scoring.js";
import type { CartItem, ScoringContext } from "../domain/scoring.js";
import type { GeoCoord } from "../domain/geo.js";
import { haversineKm } from "../domain/geo.js";
import { buildCaptureRecord } from "../capture/capture-exporter.js";
import type { CaptureExporter } from "../capture/capture-exporter.js";

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
  /**
   * Skip LLM synthesis for stock/recommendation intents that have no retrieved
   * knowledge — the deterministic fallback is sufficient and faster.
   * Default: true. Set to false to always use LLM synthesis.
   */
  skipLlmForStructuredResults?: boolean;
  /**
   * Optional capture exporter. When provided, a compact CaptureRecord is built
   * after each successful request and passed to this callback.
   * Use makeLogExporter() to emit records to stderr for offline review, or
   * makeNullExporter() (the default) for no-op behaviour.
   * The callback runs after the response is built; failures are non-fatal.
   */
  captureExporter?: CaptureExporter;
}

export interface QueryContext {
  /** Override retailer (default: adapter's retailerId). */
  retailer?: string;
  /** Override country code. */
  countryCode?: string;
  /** User location for distance-based scoring and radius filtering. */
  location?: GeoCoord;
  /** Only query stores within this distance of `location`. Omit to query all stores. */
  radiusKm?: number;
  /** Pre-parsed cart items (skip extraction from query). */
  cart?: CartItem[];
  /** Structured routing decision from the Router Agent. */
  routerOutput?: RouterOutput;
  /** Normalized query fields from the Query Understanding Agent. */
  queryUnderstandingOutput?: QueryUnderstandingOutput;
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
  const _t0 = performance.now();
  const retailer = config.adapter.retailerId;
  const perf = (label: string, since: number) =>
    console.error(`[perf][${retailer}] ${label}: ${Math.round(performance.now() - since)}ms`);

  const _tIntent = performance.now();
  const intent: ClassifiedIntent = classifyIntent(query);
  perf("classifyIntent", _tIntent);
  const toolCalls: ToolCallRecord[] = [];
  const warnings: string[] = [];

  // Snapshot intent after pattern classifier (before any overrides) for observability.
  const _intentAfterClassifier = intent.type;

  // If user provided a cart, treat as stock query regardless of intent classification.
  // This handles non-English queries and ambiguous intents where the cart is a strong signal.
  const hasExplicitCart = (context?.cart?.length ?? 0) > 0;
  if (hasExplicitCart && intent.type === "unknown") {
    intent.type = "stock";
  }

  // Snapshot after cart override, before router override.
  const _intentAfterCart = intent.type;

  // Apply router output: upgrade intent when the pattern-based classifier returned "unknown".
  // "find_best_store" and "check_cart" both map to the stock pipeline.
  // "search_product" stays "unknown" — the unknown block below (Route A / Route B) runs the
  //   actual product search and sets intent to "product_info" once products are found.
  //   Upgrading to "product_info" here would skip the search entirely.
  const ro = context?.routerOutput;
  if (ro && intent.type === "unknown") {
    if (ro.intent === "find_best_store" || ro.intent === "check_cart") {
      intent.type = "stock";
    }
  }

  // Structured decision log — single line, easy to grep and parse.
  console.error("[router:decision]", JSON.stringify({
    patternIntent: _intentAfterClassifier,
    cartOverrideApplied: _intentAfterClassifier !== _intentAfterCart,
    routerIntent: ro?.intent ?? null,
    routerConfidence: ro?.confidence ?? null,
    routerOverrideApplied: _intentAfterCart !== intent.type,
    finalIntent: intent.type,
  }));

  // Merge router warnings, tagged with source so callers can distinguish them.
  if (ro?.warnings.length) {
    warnings.push(...ro.warnings.map((w) => `[Router] ${w}`));
  }
  let recommendation: RecommendationResult | null = null;
  let retrievedKnowledge: PolicyHit[] = [];
  let foundProducts: ProductInfo[] = [];
  let explanation: ExplanationOutput | undefined;
  const citations: Citation[] = [];

  const { adapter, retriever } = config;
  const countryCode = context?.countryCode ?? intent.countryCode ?? undefined;

  try {
    // ── Stock and Policy paths — run concurrently when both are needed ──
    const stockTask = needsStock(intent)
      ? async () => {
          const cart = context?.cart ?? cartFromIntent(intent);
          if (cart.length === 0) {
            warnings.push("No item numbers detected in the query. Please specify the item numbers you are looking for.");
            return;
          }
          try {
            const storeStocks = await fetchStoreStocks(adapter, cart, countryCode, intent, config, toolCalls, context);
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
              warnings.push("No user location provided — distance scoring and radius filtering were not applied.");
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
      : null;

    const policyTask = needsPolicy(intent)
      ? async () => {
          try {
            retrievedKnowledge = await fetchPolicy(retriever, query, adapter.retailerId, toolCalls);
            if (retrievedKnowledge.length === 0) {
              warnings.push("No relevant policy documents found.");
            }
            for (const hit of retrievedKnowledge) {
              if (hit.source) citations.push({ label: hit.title, url: hit.source });
            }
          } catch (err) {
            const msg = err instanceof CopilotError ? err.message : String(err);
            warnings.push(`Policy lookup failed: ${msg}`);
          }
        }
      : null;

    const _tStockPolicy = performance.now();
    await Promise.all([stockTask?.(), policyTask?.()]);
    if (stockTask || policyTask) perf("stock+policy concurrent", _tStockPolicy);

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

    // ── Unknown intent — product search ──
    // Route A (Router → QU → Product Finder): when Query Understanding output is available,
    //   delegate to findProducts for scored, attribute-filtered candidates.
    // Route B (existing path): normalizeForRetail → optional LLM extraction → searchProducts.
    // Both routes converge on foundProducts; citations and auto-rank run once below.
    if (intent.type === "unknown") {
      const quOutput = context?.queryUnderstandingOutput;
      const _tUnknown = performance.now();

      // finderCandidates is set by Route A; used by the auto-rank block to scope
      // inventory lookup to variants of a single product (prevents mixing sofa with desk).
      let finderCandidates: ProductCandidate[] | null = null;

      if (quOutput) {
        // ── Route A: Product Finder ──
        try {
          const finderResult = await findProducts(
            { rawQuery: query, routerOutput: ro, quOutput, retailerScope: ro?.retailerScope },
            [adapter],
            { maxResults: config.maxProductResults ?? 3, countryCode },
          );
          console.error(
            `[orchestrator] product-finder: "${finderResult.searchQuery}" → ${finderResult.candidates.length} candidates`,
          );
          warnings.push(...finderResult.warnings);
          if (finderResult.candidates.length > 0) {
            finderCandidates = finderResult.candidates;
            foundProducts = finderResult.candidates.map(candidateToProductInfo);
          } else {
            warnings.push("Could not find products matching your query. Try asking about stock availability, store comparison, or return policies.");
          }
        } catch (err) {
          console.error("[orchestrator] product finder failed:", err);
          warnings.push("Could not determine the intent of your question. Try asking about stock availability, store comparison, or return policies.");
        }
      } else {
        // ── Route B: Existing path ──
        // Step 1: domain-aware pre-normalization
        const norm = normalizeForRetail(query);
        let searchQuery = norm.normalizedQuery;
        console.error(`[orchestrator] retail normalize: "${query}" → "${searchQuery}" (${norm.confidence})`);

        // Step 2: LLM translation for low-confidence (non-English) queries
        if (norm.confidence === "low" && config.llmProvider) {
          const _tLlmExtract = performance.now();
          const translated = await extractSearchTerms(query, config.llmProvider);
          perf("llm keyword extraction", _tLlmExtract);
          console.error(`[orchestrator] llm extraction: "${query}" → "${translated}"`);
          if (translated) {
            searchQuery = translated;
          } else {
            warnings.push("Search term could not be translated to English. Try searching in English for best results.");
          }
        } else if (norm.confidence === "low") {
          warnings.push("Search term appears to be non-English. Try searching in English for best results.");
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
            foundProducts = products;
          } else {
            const nonEnglishHint = norm.confidence === "low" && searchQuery === norm.normalizedQuery
              ? " Your query appears to be non-English — try searching in English."
              : "";
            warnings.push(`Could not find products matching your query.${nonEnglishHint} Try asking about stock availability, store comparison, or return policies.`);
          }
        } catch (err) {
          console.error("[orchestrator] product search fallback failed:", err);
          warnings.push("Could not determine the intent of your question. Try asking about stock availability, store comparison, or return policies.");
        }
      }

      perf("product search", _tUnknown);

      // ── Shared: if products found, set intent, build citations, auto-rank stores ──
      if (foundProducts.length > 0) {
        intent.type = "product_info";
        for (const p of foundProducts) {
          if (p.url) citations.push({ label: productCitationLabel(p), url: p.url });
        }
        // Auto-rank stores — build the inventory lookup cart via the contract helper.
        // isCartIntent: QU says multiple product types → preserve distinct items.
        //               check_cart via router upgrades intent to "stock" before this
        //               block is reached, so it only fires here as a defence-in-depth.
        const isCartIntent = quOutput?.itemCardinality === "multiple" || ro?.intent === "check_cart";
        let autoRankCartResult: AutoRankCart | null = null;
        try {
          autoRankCartResult = buildAutoRankCart(finderCandidates, foundProducts, { isCartIntent, maxVariants: 3 });
          const { cart: variantCart, inputSource: autoRankSource, variantGroupingApplied } = autoRankCartResult;
          console.error("[orchestrator:auto-rank]", JSON.stringify({
            inputSource: autoRankSource,
            variantGroupingApplied,
            cartSize: variantCart.length,
            isCartIntent,
          }));
          const storeStocks = await fetchStoreStocks(adapter, variantCart, countryCode, intent, config, toolCalls, context);

          // Pick the variant SKU with the most stores having it available.
          const skuAvailCount = new Map<string, number>();
          for (const ss of storeStocks) {
            for (const item of ss.items) {
              if (item.available) skuAvailCount.set(item.itemNo, (skuAvailCount.get(item.itemNo) ?? 0) + 1);
            }
          }
          let bestSku = variantCart[0].itemNo;
          let bestCount = 0;
          for (const [sku, count] of skuAvailCount) {
            if (count > bestCount) { bestCount = count; bestSku = sku; }
          }
          const topCart: CartItem[] = [{ itemNo: bestSku, quantity: 1 }];
          const filteredStocks = storeStocks.map((ss) => ({
            store: ss.store,
            items: ss.items.filter((i) => i.itemNo === bestSku),
          }));
          const scoringCtx: ScoringContext = { userLocation: context?.location };
          const ranked = rankStores(filteredStocks, topCart, undefined, scoringCtx);
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

        // Build deterministic explanation from all pipeline outputs.
        const explanationInput: ExplanationInput = {
          query,
          routerOutput: ro,
          queryUnderstandingOutput: quOutput ?? undefined,
          finderCandidates: finderCandidates ?? undefined,
          foundProductCount: finderCandidates == null ? foundProducts.length : undefined,
          variantGroupingApplied: autoRankCartResult?.variantGroupingApplied,
          inputSource: autoRankCartResult?.inputSource,
          isCartIntent,
          pipelineWarnings: [...warnings],
        };
        explanation = buildExplanation(explanationInput);
        console.error("[explanation]", JSON.stringify({
          built: true,
          inputSource: autoRankCartResult?.inputSource ?? null,
          candidateCount: finderCandidates?.length ?? 0,
          fallbackUsed: autoRankCartResult?.inputSource === "foundProducts",
        }));
        // Merge explanation warnings into pipeline warnings (deduplicated).
        for (const w of explanation.warnings) {
          if (!warnings.includes(w)) warnings.push(w);
        }
      }
    }

    const structuredOnly =
      config.skipLlmForStructuredResults !== false &&
      (intent.type === "stock" || intent.type === "recommendation") &&
      retrievedKnowledge.length === 0;
    const synthInput = { query, intent, recommendation, knowledge: retrievedKnowledge, products: foundProducts, warnings, explanation };
    const _tSynth = performance.now();
    const answer = config.synthesizer && !structuredOnly
      ? await config.synthesizer.synthesize(synthInput)
      : fallbackAnswer(synthInput);
    perf(config.synthesizer && !structuredOnly ? "synthesis (llm)" : "synthesis (fallback)", _tSynth);
    perf("handleQuery total", _t0);

    const response: CopilotResponse = {
      intent,
      toolCallsUsed: toolCalls,
      retrievedKnowledge,
      recommendation,
      answer,
      citations,
      products: foundProducts.length > 0 ? foundProducts : undefined,
      warnings,
      explanation,
    };

    // ── Capture export (opt-in, non-fatal) ──
    if (config.captureExporter) {
      try {
        const captureRecord = buildCaptureRecord({
          query,
          routerOutput: ro,
          queryUnderstandingOutput: context?.queryUnderstandingOutput,
          explanation,
          warnings: [...warnings],
          isCartIntent:
            context?.queryUnderstandingOutput?.itemCardinality === "multiple" ||
            ro?.intent === "check_cart",
        });
        config.captureExporter(captureRecord);
      } catch (captureErr) {
        console.error("[capture] export failed:", captureErr);
      }
    }

    return response;
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
  context?: QueryContext,
): Promise<StoreStock[]> {
  // Explicit store hints always take priority over radius filtering.
  let storeIds: string[] | undefined =
    intent.storeHints.length > 0 ? intent.storeHints : undefined;

  // If the user supplied a location + radius, pre-filter to nearby stores only.
  // This avoids fetching inventory for hundreds of stores the user can't reach.
  if (!storeIds && context?.location && context.radiusKm) {
    const allStores = await adapter.listStores(countryCode);
    const nearby = allStores.filter((s) => {
      if (!s.coords) return true; // no coords → include conservatively
      return haversineKm(context.location!, s.coords) <= context.radiusKm!;
    });
    if (nearby.length === 0) return []; // no stores in range
    storeIds = nearby.map((s) => s.storeId);
  }

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
  const entries = await Promise.all(
    cart.map(async (item): Promise<[string, number] | null> => {
      try {
        const products = await timed(
          () => adapter.searchProducts(item.itemNo, { countryCode, maxResults: 1 }),
          "search_products_price",
          adapter.retailerId,
          toolCalls,
        );
        const match = products.find((p) => p.itemNo === item.itemNo);
        return match?.price ? [item.itemNo, match.price.amount] : null;
      } catch {
        return null; // Individual item price lookup failure is non-fatal
      }
    }),
  );
  const prices = Object.fromEntries(entries.filter((e): e is [string, number] => e !== null));
  return Object.keys(prices).length > 0 ? prices : undefined;
}

/**
 * Return variants of the single highest-scored product from a sorted candidate list.
 * Groups by retailer + product name so color/size variants of the same item are kept
 * together, while unrelated products (e.g. sofa vs desk) are excluded.
 * Falls back to the top candidate alone when no same-name siblings exist.
 */
function topVariantGroup(candidates: ProductCandidate[]): ProductCandidate[] {
  if (candidates.length === 0) return [];
  const top = candidates[0];
  const groupKey = `${top.retailer}:${top.name.toLowerCase().trim()}`;
  const group = candidates.filter(
    (c) => `${c.retailer}:${c.name.toLowerCase().trim()}` === groupKey,
  );
  return group.length > 0 ? group : [top];
}

// ── Auto-rank cart contract ──

/** Identifies which data source was used to build the inventory lookup cart. */
export type AutoRankInputSource = "finderCandidates" | "foundProducts";

export interface AutoRankCart {
  cart: CartItem[];
  /** Whether topVariantGroup narrowing was applied (product-discovery mode only). */
  variantGroupingApplied: boolean;
  /** Input source used to derive the cart. */
  inputSource: AutoRankInputSource;
}

/**
 * Build the CartItem list for the post-search auto-rank inventory lookup.
 *
 * Two modes, determined by `isCartIntent`:
 *
 * Product-discovery (isCartIntent=false, default):
 *   Applies topVariantGroup to restrict the cart to variants of the single
 *   highest-scored product.  Prevents unrelated products (sofa + desk) from
 *   being checked together as if they were a cart.
 *
 * Cart-intent (isCartIntent=true — triggered by QU itemCardinality="multiple"):
 *   Preserves all distinct candidates as separate line items.  Used when the
 *   user explicitly requested multiple product types ("I want a sofa and a desk").
 *
 * Fallback (finderCandidates null or empty — Route B):
 *   Uses foundProducts unchanged.  Identical to the pre-Route-A behaviour.
 *
 * Always prefers itemNo; falls back to productId when itemNo is null.
 */
export function buildAutoRankCart(
  finderCandidates: ProductCandidate[] | null,
  foundProducts: ProductInfo[],
  opts: { isCartIntent: boolean; maxVariants?: number },
): AutoRankCart {
  const maxVariants = opts.maxVariants ?? 3;

  if (finderCandidates && finderCandidates.length > 0) {
    const grouped = opts.isCartIntent
      ? finderCandidates.slice(0, maxVariants)            // cart intent: all distinct items
      : topVariantGroup(finderCandidates).slice(0, maxVariants); // discovery: best product's variants
    return {
      cart: grouped.map((c) => ({ itemNo: c.itemNo ?? c.productId, quantity: 1 })),
      variantGroupingApplied: !opts.isCartIntent,
      inputSource: "finderCandidates",
    };
  }

  // Route B / no candidates: unchanged fallback.
  return {
    cart: foundProducts.slice(0, maxVariants).map((p) => ({ itemNo: p.itemNo, quantity: 1 })),
    variantGroupingApplied: false,
    inputSource: "foundProducts",
  };
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
