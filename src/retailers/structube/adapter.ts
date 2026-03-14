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
} from "../../core/types.js";
import { CopilotError } from "../../core/types.js";
import { STRUCTUBE_STORES, type StructubeStore } from "./stores.js";

// ──────────────────────────────────────────────
// Structube adapter — proves multi-retailer abstraction
//
// Uses Structube's public web endpoints for product search.
// Stock checking is limited: Structube does not expose per-store
// inventory via public API, so we return online-only availability.
// ──────────────────────────────────────────────

/** Raw product shape from Structube's search endpoint. */
interface StructubeSearchHit {
  sku: string;
  name: string;
  type_id: string;
  price: number;
  url: string;
  description?: string;
}

export interface StructubeAdapterConfig {
  /** Base URL for Structube website (default: https://www.structube.com). */
  baseUrl?: string;
  /** Language/country: "en_ca" or "fr_ca" (default: "en_ca"). */
  locale?: string;
  /** Override fetch for testing. */
  fetch?: typeof globalThis.fetch;
}

export class StructubeAdapter implements RetailerAdapter {
  readonly retailerId = "structube" as const;
  private readonly baseUrl: string;
  private readonly locale: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config?: StructubeAdapterConfig) {
    this.baseUrl = (config?.baseUrl ?? "https://www.structube.com").replace(/\/+$/, "");
    this.locale = config?.locale ?? "en_ca";
    this.fetch = config?.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listStores(countryCode?: string): Promise<StoreRef[]> {
    // Structube only operates in Canada
    if (countryCode && countryCode.toUpperCase() !== "CA") {
      return [];
    }
    return STRUCTUBE_STORES.map(toStoreRef);
  }

  async searchProducts(query: string, opts?: SearchOpts): Promise<ProductInfo[]> {
    const maxResults = opts?.maxResults ?? 5;
    const url = `${this.baseUrl}/${this.locale}/rest/V1/search/products?q=${encodeURIComponent(query)}&pageSize=${maxResults}`;

    let data: { items?: StructubeSearchHit[] };
    try {
      const res = await this.fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      data = await res.json() as { items?: StructubeSearchHit[] };
    } catch (err) {
      throw new CopilotError(
        "TOOL_FAILURE",
        `Structube search failed: ${err instanceof Error ? err.message : String(err)}`,
        "structube",
        err,
      );
    }

    return (data.items ?? []).slice(0, maxResults).map((hit) => this.mapProduct(hit));
  }

  async checkStock(items: ProductRef[], storeIds: string[]): Promise<StoreStock[]> {
    // Structube does not expose per-store stock via public API.
    // Return online-only availability for each requested store.
    return storeIds.map((storeId) => {
      const store = STRUCTUBE_STORES.find((s) => s.storeId === storeId);
      return {
        store: store ? toStoreRef(store) : { retailer: this.retailerId, storeId, label: storeId },
        items: items.map((item) => ({
          itemNo: item.itemNo,
          available: false,
          quantity: null,
          stockLevel: "UNKNOWN" as const,
          canNotify: null,
        })),
      };
    });
  }

  async findStoresForCart(
    items: Array<{ itemNo: string; quantity: number }>,
    opts?: FindStoresOpts,
  ): Promise<StoreStock[]> {
    // Without per-store stock data, return all matching stores with unknown availability.
    // The scoring engine will rank them low, and warnings will explain the limitation.
    const stores = opts?.storeIds
      ? STRUCTUBE_STORES.filter((s) => opts.storeIds!.includes(s.storeId))
      : STRUCTUBE_STORES;

    const limited = stores.slice(0, opts?.maxResults ?? 5);

    return limited.map((store) => ({
      store: toStoreRef(store),
      items: items.map((item) => ({
        itemNo: item.itemNo,
        available: false,
        quantity: null,
        stockLevel: "UNKNOWN" as const,
        canNotify: null,
      })),
    }));
  }

  // ── Internal ──

  private mapProduct(hit: StructubeSearchHit): ProductInfo {
    return {
      retailer: this.retailerId,
      itemNo: hit.sku,
      name: hit.name,
      typeName: hit.type_id ?? "product",
      price: hit.price != null ? { amount: hit.price, currency: "CAD" } : null,
      url: hit.url.startsWith("http") ? hit.url : `${this.baseUrl}/${this.locale}/${hit.url}`,
      measureText: null,
    };
  }
}

function toStoreRef(s: StructubeStore): StoreRef {
  return { retailer: s.retailer, storeId: s.storeId, label: s.label };
}
