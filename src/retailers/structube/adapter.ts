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

// ──────────────────────────────────────────────
// Structube adapter — Magento 2 GraphQL backend
// Endpoint: https://www.structube.com/graphql
//
// Inventory is regional (province-level), not per individual store.
// The province → region_id mapping was discovered empirically via
// the getCustomerRegion GraphQL query with postal codes from each province.
// ──────────────────────────────────────────────

const ENDPOINT = "https://www.structube.com/graphql";

// Maps Structube province names to their regional inventory IDs.
const PROVINCE_REGION: Record<string, number> = {
  "Alberta": 66,
  "British Columbia": 67,
  "Manitoba": 68,
  "New Brunswick": 70,
  "Nova Scotia": 71,
  "Ontario": 74,
  "Quebec": 76,
  "Saskatchewan": 77,
};

// ── Raw GraphQL shapes ──

interface GqlStoreItem {
  identifier: string;
  short_name: string;
  city: string;
  /** Province name, e.g. "Ontario" — used to look up region_id */
  region: string;
  country_id: string;
  latitude: number;
  longitude: number;
}

interface GqlProductItem {
  sku: string;
  name: string;
  url_key: string;
  url_suffix: string;
  price: { regularPrice: { amount: { value: number; currency: string } } };
  small_image?: { url: string } | null;
}

interface GqlInventoryItem {
  sku: string;
  region_id: number;
  quantity: number;
  /** "IN_STOCK" | "OUT_OF_STOCK" */
  status: string;
}

export interface StructubeAdapterConfig {
  /** Override fetch for testing. */
  fetch?: typeof globalThis.fetch;
}

export class StructubeAdapter implements RetailerAdapter {
  readonly retailerId = "structube" as const;
  private readonly fetch: typeof globalThis.fetch;

  /**
   * Lazy store cache: loaded once, then reused.
   * Holds stores list + storeId→regionId mapping for inventory lookup.
   */
  private _storeData: Promise<{
    stores: StoreRef[];
    regionById: Map<string, number>;
  }> | null = null;

  constructor(config?: StructubeAdapterConfig) {
    this.fetch = config?.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listStores(countryCode?: string): Promise<StoreRef[]> {
    if (countryCode && countryCode.toUpperCase() !== "CA") return [];
    const { stores } = await this.loadStoreData();
    return stores;
  }

  async searchProducts(query: string, opts?: SearchOpts): Promise<ProductInfo[]> {
    const pageSize = opts?.maxResults ?? 5;
    let data: { products: { items: GqlProductItem[] } };
    try {
      data = await this.gql(
        `query($q: String!, $n: Int!) {
          products(search: $q, pageSize: $n) {
            items { sku name url_key url_suffix
              price { regularPrice { amount { value currency } } }
              small_image { url }
            }
          }
        }`,
        { q: query, n: pageSize },
      );
    } catch (err) {
      throw new CopilotError(
        "TOOL_FAILURE",
        `Structube search failed: ${err instanceof Error ? err.message : String(err)}`,
        "structube",
        err,
      );
    }
    return data.products.items.map((p) => this.mapProduct(p));
  }

  async checkStock(items: ProductRef[], storeIds: string[]): Promise<StoreStock[]> {
    const skus = items.map((i) => i.itemNo);
    const [{ stores, regionById }, inventory] = await Promise.all([
      this.loadStoreData(),
      this.fetchInventory(skus),
    ]);
    const regionStock = buildRegionStockMap(inventory);
    const filtered = storeIds.length > 0
      ? stores.filter((s) => storeIds.includes(s.storeId))
      : stores;
    return filtered.map((store) =>
      buildStoreStock(store, skus, regionStock, regionById.get(store.storeId)),
    );
  }

  async findStoresForCart(
    items: Array<{ itemNo: string; quantity: number }>,
    opts?: FindStoresOpts,
  ): Promise<StoreStock[]> {
    if (opts?.countryCode && opts.countryCode.toUpperCase() !== "CA") return [];
    const skus = items.map((i) => i.itemNo);
    const [{ stores, regionById }, inventory] = await Promise.all([
      this.loadStoreData(),
      this.fetchInventory(skus),
    ]);
    const regionStock = buildRegionStockMap(inventory);
    let filtered = opts?.storeIds
      ? stores.filter((s) => opts.storeIds!.includes(s.storeId))
      : stores;
    filtered = filtered.slice(0, opts?.maxResults ?? 20);
    return filtered.map((store) =>
      buildStoreStock(store, skus, regionStock, regionById.get(store.storeId), items),
    );
  }

  // ── Internal ──

  private loadStoreData() {
    if (!this._storeData) {
      this._storeData = this.gql<{ absoStores: { items: GqlStoreItem[] } }>(
        `{ absoStores(use_in_pickup: true) {
          items { identifier short_name city region country_id latitude longitude }
        } }`,
      ).then((data) => {
        const stores = data.absoStores.items.map(toStoreRef);
        const regionById = new Map(
          data.absoStores.items.map(
            (s) => [s.identifier, PROVINCE_REGION[s.region] ?? 0] as const,
          ),
        );
        return { stores, regionById };
      }).catch((err) => {
        this._storeData = null; // allow retry on next call
        throw err;
      });
    }
    return this._storeData;
  }

  private async fetchInventory(skus: string[]): Promise<GqlInventoryItem[]> {
    if (skus.length === 0) return [];
    try {
      const data = await this.gql<{ inventory: { items: GqlInventoryItem[] } }>(
        `query($skus: [String!]!) {
          inventory(skus: $skus) { items { sku region_id quantity status } }
        }`,
        { skus },
      );
      return data.inventory.items;
    } catch (err) {
      throw new CopilotError(
        "TOOL_FAILURE",
        `Structube inventory lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        "structube",
        err,
      );
    }
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await this.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "shopping-copilot/1.0",
        "Store": "en_ca",
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    if (!json.data) throw new Error("empty GraphQL response");
    return json.data;
  }

  private mapProduct(p: GqlProductItem): ProductInfo {
    return {
      retailer: this.retailerId,
      itemNo: p.sku,
      name: p.name,
      typeName: "product",
      price: {
        amount: p.price.regularPrice.amount.value,
        currency: p.price.regularPrice.amount.currency,
      },
      url: `https://www.structube.com/en_ca/${p.url_key}${p.url_suffix ?? ""}`,
      measureText: null,
      designText: null,
      imageUrl: p.small_image?.url ?? null,
    };
  }
}

// ── Pure helpers ──

function toStoreRef(s: GqlStoreItem): StoreRef {
  return {
    retailer: "structube",
    storeId: s.identifier,
    label: s.short_name,
    coords: { lat: s.latitude, lng: s.longitude },
  };
}

/** Build a nested map: region_id → sku → { quantity, status } */
function buildRegionStockMap(
  inventory: GqlInventoryItem[],
): Map<number, Map<string, { quantity: number; status: string }>> {
  const map = new Map<number, Map<string, { quantity: number; status: string }>>();
  for (const inv of inventory) {
    if (!map.has(inv.region_id)) map.set(inv.region_id, new Map());
    map.get(inv.region_id)!.set(inv.sku, { quantity: inv.quantity, status: inv.status });
  }
  return map;
}

function buildStoreStock(
  store: StoreRef,
  skus: string[],
  regionStock: Map<number, Map<string, { quantity: number; status: string }>>,
  regionId: number | undefined,
  cart?: Array<{ itemNo: string; quantity: number }>,
): StoreStock {
  const stockMap = regionId ? regionStock.get(regionId) : undefined;
  return {
    store,
    items: skus.map((sku) => {
      const inv = stockMap?.get(sku);
      const requested = cart?.find((c) => c.itemNo === sku)?.quantity ?? 1;
      return {
        itemNo: sku,
        available: inv !== undefined ? inv.quantity >= requested : false,
        quantity: inv?.quantity ?? null,
        stockLevel: inv?.status ?? "UNKNOWN",
        canNotify: null,
      };
    }),
  };
}
