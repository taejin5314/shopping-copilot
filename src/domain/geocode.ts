import type { GeoCoord } from "./geo.js";

// ──────────────────────────────────────────────
// Lightweight geocoding via OpenStreetMap Nominatim
// ──────────────────────────────────────────────

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "ShoppingCopilot/0.1 (portfolio project)";

// In-process cache keyed by normalized location text.
// Only populated when using the real global fetch (not test-injected fetch).
// City names and postal codes are stable — no TTL needed within a process lifetime.
const _geocodeCache = new Map<string, GeocodeResult>();

export interface GeocodeResult {
  coords: GeoCoord;
  /** Display name returned by Nominatim. */
  displayName: string;
}

export interface GeocodeOptions {
  /** Injectable fetch for testing. */
  fetch?: typeof globalThis.fetch;
  /** Abort signal for timeouts. */
  signal?: AbortSignal;
}

/**
 * Resolve a free-text location string (postal code, city, address)
 * to geographic coordinates via Nominatim.
 * Returns `null` when no results are found or the request fails.
 */
export async function geocode(
  locationText: string,
  opts: GeocodeOptions = {},
): Promise<GeocodeResult | null> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const trimmed = locationText.trim();
  if (!trimmed) return null;

  // Check cache only when using the real fetch (not a test-injected mock).
  const useCache = !opts.fetch;
  const cacheKey = trimmed.toLowerCase();
  if (useCache) {
    const hit = _geocodeCache.get(cacheKey);
    if (hit) return hit;
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  try {
    const res = await fetchFn(url.href, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: opts.signal,
    });
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as Record<string, unknown>;
    const lat = parseFloat(String(first.lat));
    const lng = parseFloat(String(first.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const result: GeocodeResult = {
      coords: { lat, lng },
      displayName: typeof first.display_name === "string" ? first.display_name : trimmed,
    };
    if (useCache) _geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
