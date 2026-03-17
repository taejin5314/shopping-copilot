// ──────────────────────────────────────────────
// Core domain types — retailer-agnostic
// ──────────────────────────────────────────────

/** Identifies which retailer an adapter serves. */
export type RetailerId = string; // e.g. "ikea", "structube", "rh"

// ── Product ──

export interface ProductRef {
  retailer: RetailerId;
  itemNo: string;
  name?: string;
}

export interface ProductInfo extends ProductRef {
  name: string;
  typeName: string;
  price: { amount: number; currency: string } | null;
  url: string | null;
  measureText: string | null;
  /** Color/design variant descriptor (e.g. "Dark blue", "Beige"). */
  designText?: string | null;
  /** Product thumbnail URL, if provided by the retailer. */
  imageUrl?: string | null;
}

// ── Store ──

export interface StoreRef {
  retailer: RetailerId;
  storeId: string;
  label: string;
  /** Optional store coordinates for distance scoring. */
  coords?: { lat: number; lng: number };
}

export interface StoreStock {
  store: StoreRef;
  items: ItemAvailability[];
}

export interface ItemAvailability {
  itemNo: string;
  available: boolean;
  quantity: number | null;
  /** e.g. "HIGH_IN_STOCK", "OUT_OF_STOCK" */
  stockLevel: string | null;
  canNotify: boolean | null;
}

// ── Intent ──

export type IntentType = "stock" | "policy" | "recommendation" | "product_info" | "unknown";

export interface ClassifiedIntent {
  type: IntentType;
  /** Secondary intents for mixed queries (e.g. stock + policy). */
  secondary: IntentType[];
  /** Item numbers extracted from the query. */
  itemNos: string[];
  /** Store IDs or location hints extracted. */
  storeHints: string[];
  /** Country code if detected. */
  countryCode: string | null;
  /** Raw confidence signal — not an LLM probability, just a pattern-match quality score 0–1. */
  confidence: number;
}

// ── RAG / Policy ──

export interface PolicyHit {
  retailer: RetailerId;
  title: string;
  content: string;
  source: string;
  /** Relevance score from retrieval layer, 0–1. */
  score: number;
}

// ── Recommendation ──

export interface ScoredStore {
  store: StoreRef;
  /** 0–1; fraction of cart items meeting requested quantity. */
  stockCoverageScore: number;
  /** 0–1; 1.0 = single-store trip, decays as more stores needed. */
  convenienceScore: number;
  /** 0–1; placeholder for distance-based scoring. */
  distanceScore: number | null;
  /** Raw distance in km — used for user-facing display. Null when location is unavailable. */
  distanceKm: number | null;
  /** 0–1; placeholder for price-based scoring. */
  priceScore: number | null;
  /** Weighted composite. */
  totalScore: number;
  /** Per-item breakdown for explainability. */
  itemDetails: ItemScoreDetail[];
}

export interface ItemScoreDetail {
  itemNo: string;
  requested: number;
  available: number | null;
  sufficient: boolean;
}

export interface RecommendationResult {
  ranked: ScoredStore[];
  /** Human-readable explanation points for the LLM to weave into its answer. */
  explanationPoints: string[];
  warnings: string[];
}

// ── Explanation ──

export interface ExplanationMetadata {
  /** Retailer scope used ("ikea", "structube", "all", …). */
  retailerScope: string | null;
  /** Router confidence 0–1, or null when router was not invoked. */
  routerConfidence: number | null;
  /** matchScore of the top candidate (0–1), null when no candidates. */
  topCandidateScore: number | null;
  /** Whether the top candidate's price fits the budget. */
  budgetStatus: "within" | "exceeded" | "way_exceeded" | "unknown" | null;
  /** QU attributes found in the top candidate. */
  attributesMatched: string[];
  /** QU attributes requested but not found in the top candidate. */
  attributesMissed: string[];
  /** Whether topVariantGroup was applied (product-discovery mode). */
  variantGroupingApplied: boolean;
  /** Data source used to drive the inventory lookup. */
  inputSource: "finderCandidates" | "foundProducts" | null;
  /** true when Route B (basic keyword search) was used instead of Product Finder. */
  fallbackUsed: boolean;
  /** Number of scored Product Finder candidates (0 for Route B). */
  candidateCount: number;
}

export interface ExplanationOutput {
  /** One-sentence user-facing summary. */
  summary: string;
  /** Ordered explanation points about match quality, constraints, scope, and path. */
  explanationPoints: string[];
  /** Warnings surfaced by the explanation layer (e.g. low router confidence). */
  warnings: string[];
  /** Structured fields for UI or debugging. */
  metadata: ExplanationMetadata;
}

// ── Response ──

export interface CopilotResponse {
  intent: ClassifiedIntent;
  toolCallsUsed: ToolCallRecord[];
  retrievedKnowledge: PolicyHit[];
  recommendation: RecommendationResult | null;
  answer: string;
  citations: Citation[];
  warnings: string[];
  /** Product search results, if any. Used for richer answer synthesis. */
  products?: ProductInfo[];
  /** Deterministic explanation of what was found and why. */
  explanation?: ExplanationOutput;
}

export interface ToolCallRecord {
  tool: string;
  retailer: RetailerId;
  input: Record<string, unknown>;
  durationMs: number;
  success: boolean;
}

export interface Citation {
  label: string;
  url: string | null;
}

// ── Errors ──

export type CopilotErrorCode =
  | "INVALID_ITEM"
  | "NO_STOCK"
  | "TOOL_FAILURE"
  | "NO_DOCUMENTS"
  | "UNKNOWN_INTENT"
  | "ADAPTER_NOT_FOUND"
  | "INTERNAL";

export class CopilotError extends Error {
  constructor(
    public readonly code: CopilotErrorCode,
    message: string,
    public readonly retailer?: RetailerId,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CopilotError";
  }
}
