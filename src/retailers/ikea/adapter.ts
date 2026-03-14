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
import { CopilotError } from "../../core/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ──────────────────────────────────────────────
// IKEA adapter — calls ikea-mcp tools via MCP SDK client
// ──────────────────────────────────────────────

/**
 * Shape returned by ikea-mcp's `list_stores` tool.
 */
interface McpStore {
  storeId: string;
  label: string;
}

interface McpProductHit {
  itemNo: string;
  name: string;
  typeName: string;
  salesPrice: { amount: number; currencyCode: string };
  pipUrl: string;
  designText: string | null;
  measureText: string | null;
}

interface McpStockRow {
  itemNo: string;
  availableForCashCarry: boolean;
  quantity: number | null;
  messageType: string | null;
  eligibleForStockNotification: boolean | null;
}

interface McpCartStoreResult {
  storeId: string;
  storeLabel: string;
  fulfilledCount: number;
  totalCount: number;
  allSufficient: boolean;
  items: Array<{
    itemNo: string;
    quantity: number;
    inStock: number | null;
    sufficient: boolean;
  }>;
}

export interface IkeaAdapterConfig {
  /** Base URL of the ikea-mcp HTTP server (e.g. "http://localhost:3000"). */
  mcpBaseUrl: string;
  /** Optional API key for the ikea-mcp server. */
  apiKey?: string;
}

export class IkeaAdapter implements RetailerAdapter {
  readonly retailerId = "ikea" as const;
  private readonly mcpUrl: string;
  private readonly apiKey: string | undefined;
  private client: Client | null = null;

  constructor(config: IkeaAdapterConfig) {
    this.mcpUrl = config.mcpBaseUrl.replace(/\/+$/, "") + "/mcp";
    this.apiKey = config.apiKey;
  }

  /** Lazily connect MCP client on first use. */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    const headers: Record<string, string> = {};
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const transport = new StreamableHTTPClientTransport(
      new URL(this.mcpUrl),
      { requestInit: { headers } },
    );

    this.client = new Client({ name: "shopping-copilot", version: "0.1.0" });
    try {
      await this.client.connect(transport);
    } catch (err) {
      this.client = null;
      throw new CopilotError("TOOL_FAILURE", `Failed to connect to ikea-mcp: ${String(err)}`, "ikea", err);
    }
    return this.client;
  }

  async listStores(countryCode?: string): Promise<StoreRef[]> {
    const result = await this.callTool<McpStore[]>(
      "list_stores",
      countryCode ? { countryCode } : {},
    );
    return result.map((s) => ({
      retailer: this.retailerId,
      storeId: s.storeId,
      label: s.label,
    }));
  }

  async searchProducts(query: string, opts?: SearchOpts): Promise<ProductInfo[]> {
    const result = await this.callTool<{ results: McpProductHit[]; total: number }>(
      "search_products",
      {
        query,
        countryCode: opts?.countryCode ?? "US",
        langCode: opts?.langCode ?? "en",
        size: opts?.maxResults ?? 5,
      },
    );
    return result.results.map((p) => this.mapProduct(p));
  }

  async checkStock(items: ProductRef[], storeIds: string[]): Promise<StoreStock[]> {
    // For each store, call check_multi_item_stock
    const results: StoreStock[] = [];
    for (const storeId of storeIds) {
      const rows = await this.callTool<McpStockRow[]>(
        "check_multi_item_stock",
        { storeId, itemNos: items.map((i) => i.itemNo) },
      );
      results.push({
        store: { retailer: this.retailerId, storeId, label: storeId },
        items: rows.map((r) => this.mapAvailability(r)),
      });
    }
    return results;
  }

  async findStoresForCart(
    items: Array<{ itemNo: string; quantity: number }>,
    opts?: FindStoresOpts,
  ): Promise<StoreStock[]> {
    const result = await this.callTool<McpCartStoreResult[]>(
      "find_best_store_for_cart",
      {
        items: items.map((i) => ({ itemNo: i.itemNo, quantity: i.quantity })),
        ...(opts?.storeIds && { storeIds: opts.storeIds }),
        ...(opts?.countryCode && { countryCode: opts.countryCode }),
        ...(opts?.maxResults && { maxResults: opts.maxResults }),
      },
    );
    return result.map((r) => ({
      store: { retailer: this.retailerId, storeId: r.storeId, label: r.storeLabel },
      items: r.items.map((i) => ({
        itemNo: i.itemNo,
        available: i.sufficient,
        quantity: i.inStock,
        stockLevel: null,
        canNotify: null,
      })),
    }));
  }

  // ── Internal helpers ──

  private async callTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    let result;
    try {
      const client = await this.getClient();
      result = await client.callTool({ name: toolName, arguments: args });
    } catch (err) {
      if (err instanceof CopilotError) throw err;
      throw new CopilotError("TOOL_FAILURE", `ikea-mcp call failed for ${toolName}: ${String(err)}`, "ikea", err);
    }

    const content = result.content as Array<{ type: string; text?: string }>;

    if (result.isError) {
      const msg = content?.[0]?.text ?? "unknown tool error";
      throw new CopilotError("TOOL_FAILURE", `ikea-mcp error: ${msg}`, "ikea");
    }

    const text = content?.[0]?.text;
    if (!text) {
      throw new CopilotError("TOOL_FAILURE", `Empty response from ikea-mcp ${toolName}`, "ikea");
    }

    return JSON.parse(text) as T;
  }

  private mapProduct(p: McpProductHit): ProductInfo {
    return {
      retailer: this.retailerId,
      itemNo: p.itemNo,
      name: p.name,
      typeName: p.typeName,
      price: p.salesPrice ? { amount: p.salesPrice.amount, currency: p.salesPrice.currencyCode } : null,
      url: p.pipUrl,
      measureText: p.measureText,
    };
  }

  private mapAvailability(r: McpStockRow): ItemAvailability {
    return {
      itemNo: r.itemNo,
      available: r.availableForCashCarry,
      quantity: r.quantity,
      stockLevel: r.messageType,
      canNotify: r.eligibleForStockNotification,
    };
  }
}
