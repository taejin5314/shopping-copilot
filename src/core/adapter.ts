import type {
  RetailerId,
  StoreRef,
  StoreStock,
  ProductInfo,
  ProductRef,
} from "./types.js";

// ──────────────────────────────────────────────
// Retailer adapter contract
// ──────────────────────────────────────────────

/**
 * Each retailer implements this interface.
 * The copilot orchestrator talks only to this contract — never to raw APIs.
 */
export interface RetailerAdapter {
  readonly retailerId: RetailerId;

  /** List stores, optionally filtered by country. */
  listStores(countryCode?: string): Promise<StoreRef[]>;

  /** Search products by keyword. */
  searchProducts(query: string, opts?: SearchOpts): Promise<ProductInfo[]>;

  /** Check stock for items at specific stores. */
  checkStock(items: ProductRef[], storeIds: string[]): Promise<StoreStock[]>;

  /**
   * Find the best stores for a cart.
   * Returns per-store stock breakdown — scoring is done by the recommendation engine, not here.
   */
  findStoresForCart(
    items: Array<{ itemNo: string; quantity: number }>,
    opts?: FindStoresOpts,
  ): Promise<StoreStock[]>;
}

export interface SearchOpts {
  countryCode?: string;
  langCode?: string;
  maxResults?: number;
}

export interface FindStoresOpts {
  storeIds?: string[];
  countryCode?: string;
  maxResults?: number;
}
