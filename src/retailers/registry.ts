import type { RetailerAdapter } from "../core/adapter.js";
import type { RetailerId } from "../core/types.js";
import { CopilotError } from "../core/types.js";

// ──────────────────────────────────────────────
// Adapter registry — maps retailer IDs to adapters
// ──────────────────────────────────────────────

const adapters = new Map<RetailerId, RetailerAdapter>();

export function registerAdapter(adapter: RetailerAdapter): void {
  adapters.set(adapter.retailerId, adapter);
}

export function getAdapter(retailerId: RetailerId): RetailerAdapter {
  const adapter = adapters.get(retailerId);
  if (!adapter) {
    throw new CopilotError("ADAPTER_NOT_FOUND", `No adapter registered for "${retailerId}"`);
  }
  return adapter;
}

export function listAdapters(): RetailerId[] {
  return [...adapters.keys()];
}
