// Mirrors backend CopilotResponse shape

export interface Price {
  amount: number;
  currency: string;
}

export interface ProductInfo {
  retailer: string;
  itemNo: string;
  name: string;
  typeName: string;
  price: Price | null;
  url: string | null;
  measureText: string | null;
  designText: string | null;
  imageUrl: string | null;
}

export interface StoreRef {
  retailer: string;
  storeId: string;
  label: string;
  coords: { lat: number; lng: number };
}

export interface ItemDetail {
  itemNo: string;
  requested: number;
  available: number | null;
  sufficient: boolean;
}

export interface RankedStore {
  store: StoreRef;
  stockCoverageScore: number;
  convenienceScore: number;
  distanceScore: number | null;
  priceScore: number | null;
  totalScore: number;
  itemDetails: ItemDetail[];
}

export interface RecommendationResult {
  ranked: RankedStore[];
  explanationPoints: string[];
  warnings: string[];
}

export interface Citation {
  label: string;
  url: string | null;
}

export interface KnowledgeItem {
  title: string;
  content: string;
  score: number;
}

export interface ClassifiedIntent {
  type: string;
}

export interface CopilotResponse {
  intent: ClassifiedIntent;
  answer: string;
  products: ProductInfo[];
  recommendation: RecommendationResult | null;
  citations: Citation[];
  retrievedKnowledge: KnowledgeItem[];
  warnings: string[];
  toolCallsUsed: { tool: string; retailer: string; success: boolean; durationMs: number }[];
}

export interface QueryRequest {
  query: string;
  retailer?: string;
  location?: { lat: number; lng: number };
  radiusKm?: number;
}
