import type {
  RetailerAdapter,
  SearchOpts,
  FindStoresOpts,
} from "../../core/adapter.js";
import type {
  StoreRef,
  StoreStock,
  ProductInfo,
  ProductRef,
  ItemAvailability,
} from "../../core/types.js";
import {
  SHOPPERS_STORES,
  SHOPPERS_PRODUCTS,
  SHOPPERS_AVAILABILITY,
  scoreBeautyProduct,
  tokenizeQuery,
} from "../beauty/mock-data.js";

// ──────────────────────────────────────────────
// Shoppers Drug Mart adapter — static mock data
// Replace SHOPPERS_AVAILABILITY lookups with real API calls when available.
// ──────────────────────────────────────────────

const MATCH_THRESHOLD = 0.15;
const DEFAULT_MAX_RESULTS = 5;

export class ShoppersAdapter implements RetailerAdapter {
  readonly retailerId = "shoppers" as const;

  async listStores(_countryCode?: string): Promise<StoreRef[]> {
    return SHOPPERS_STORES;
  }

  async searchProducts(query: string, opts?: SearchOpts): Promise<ProductInfo[]> {
    const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;
    const tokens = tokenizeQuery(query);

    if (tokens.length === 0) return [];

    return SHOPPERS_PRODUCTS
      .map((product) => ({ product, score: scoreBeautyProduct(product, tokens) }))
      .filter(({ score }) => score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ product }) => product as ProductInfo);
  }

  async checkStock(items: ProductRef[], storeIds: string[]): Promise<StoreStock[]> {
    return storeIds.map((storeId) => {
      const storeAvail = SHOPPERS_AVAILABILITY[storeId] ?? {};
      const storeRef = SHOPPERS_STORES.find((s) => s.storeId === storeId) ?? {
        retailer: this.retailerId,
        storeId,
        label: storeId,
      };
      return {
        store: storeRef,
        items: items.map((item) => resolveAvailability(item.itemNo, storeAvail)),
      };
    });
  }

  async findStoresForCart(
    items: Array<{ itemNo: string; quantity: number }>,
    opts?: FindStoresOpts,
  ): Promise<StoreStock[]> {
    const candidateStores = opts?.storeIds
      ? SHOPPERS_STORES.filter((s) => opts.storeIds!.includes(s.storeId))
      : SHOPPERS_STORES;

    const maxResults = opts?.maxResults ?? candidateStores.length;

    return candidateStores
      .slice(0, maxResults)
      .map((store) => {
        const storeAvail = SHOPPERS_AVAILABILITY[store.storeId] ?? {};
        return {
          store,
          items: items.map((item) => resolveAvailability(item.itemNo, storeAvail)),
        };
      });
  }
}

// ── Internal helper ──

function resolveAvailability(
  itemNo: string,
  storeAvail: Record<string, ItemAvailability>,
): ItemAvailability {
  const entry = storeAvail[itemNo];
  if (!entry) {
    return { itemNo, available: false, quantity: 0, stockLevel: "OUT_OF_STOCK", canNotify: true };
  }
  return { ...entry, itemNo };
}
