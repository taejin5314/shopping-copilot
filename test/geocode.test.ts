import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { geocode } from "../src/domain/geocode.js";

// ── Helpers ──

/** Build a fake fetch that returns the given Nominatim-shaped body. */
function fakeFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) =>
    ({
      ok: status >= 200 && status < 300,
      json: async () => body,
    }) as Response;
}

// ── Tests ──

describe("geocode — valid location", () => {
  it("resolves a city name to coords", async () => {
    const result = await geocode("Toronto", {
      fetch: fakeFetch([
        { lat: "43.6534817", lon: "-79.3839347", display_name: "Toronto, Ontario, Canada" },
      ]),
    });
    assert.ok(result);
    assert.ok(Math.abs(result.coords.lat - 43.653) < 0.01);
    assert.ok(Math.abs(result.coords.lng - -79.384) < 0.01);
    assert.equal(result.displayName, "Toronto, Ontario, Canada");
  });

  it("resolves a postal code to coords", async () => {
    const result = await geocode("M5V 2H1", {
      fetch: fakeFetch([
        { lat: "43.6426", lon: "-79.3871", display_name: "M5V 2H1, Toronto, ON, Canada" },
      ]),
    });
    assert.ok(result);
    assert.ok(Math.abs(result.coords.lat - 43.643) < 0.01);
    assert.ok(Math.abs(result.coords.lng - -79.387) < 0.01);
  });

  it("resolves a US zip code to coords", async () => {
    const result = await geocode("90210", {
      fetch: fakeFetch([
        { lat: "34.0901", lon: "-118.4065", display_name: "Beverly Hills, CA 90210, USA" },
      ]),
    });
    assert.ok(result);
    assert.ok(Math.abs(result.coords.lat - 34.09) < 0.01);
  });
});

describe("geocode — failure cases", () => {
  it("returns null for empty string", async () => {
    const result = await geocode("", { fetch: fakeFetch([]) });
    assert.equal(result, null);
  });

  it("returns null for whitespace-only string", async () => {
    const result = await geocode("   ", { fetch: fakeFetch([]) });
    assert.equal(result, null);
  });

  it("returns null when Nominatim returns empty array", async () => {
    const result = await geocode("xyznonexistent99999", {
      fetch: fakeFetch([]),
    });
    assert.equal(result, null);
  });

  it("returns null when Nominatim returns non-200", async () => {
    const result = await geocode("Toronto", {
      fetch: fakeFetch(null, 503),
    });
    assert.equal(result, null);
  });

  it("returns null when fetch throws (network error)", async () => {
    const result = await geocode("Toronto", {
      fetch: async () => { throw new Error("network down"); },
    });
    assert.equal(result, null);
  });

  it("returns null when coordinates are non-numeric", async () => {
    const result = await geocode("badplace", {
      fetch: fakeFetch([{ lat: "nope", lon: "nah", display_name: "Bad" }]),
    });
    assert.equal(result, null);
  });
});

describe("geocode — URL construction", () => {
  it("passes query and format params to Nominatim", async () => {
    let capturedUrl = "";
    const result = await geocode("Montreal", {
      fetch: async (url: string | URL | Request, _init?: RequestInit) => {
        capturedUrl = typeof url === "string" ? url : String(url);
        return { ok: true, json: async () => [{ lat: "45.50", lon: "-73.56", display_name: "Montreal" }] } as Response;
      },
    });
    assert.ok(result);
    assert.ok(capturedUrl.includes("q=Montreal"));
    assert.ok(capturedUrl.includes("format=jsonv2"));
    assert.ok(capturedUrl.includes("limit=1"));
  });
});

describe("geocode — integration with distance scoring", () => {
  it("resolved coords can be used with haversineKm", async () => {
    // Simulate: geocode Toronto, then compute distance to a store
    const { haversineKm, distanceToScore } = await import("../src/domain/geo.js");

    const toronto = await geocode("Toronto", {
      fetch: fakeFetch([
        { lat: "43.6534817", lon: "-79.3839347", display_name: "Toronto, ON" },
      ]),
    });
    assert.ok(toronto);

    // Structube Laval store coords (from stores.ts)
    const lavalStore = { lat: 45.5569, lng: -73.7498 };
    const km = haversineKm(toronto.coords, lavalStore);
    assert.ok(km > 400 && km < 700, `Expected ~540km, got ${km}`);

    const score = distanceToScore(km);
    assert.ok(score > 0 && score < 0.15, `Expected low score for ~540km, got ${score}`);
  });

  it("returns valid GeoCoord shape for scoring context", async () => {
    const result = await geocode("Ottawa", {
      fetch: fakeFetch([
        { lat: "45.4215", lon: "-75.6972", display_name: "Ottawa, ON" },
      ]),
    });
    assert.ok(result);
    assert.equal(typeof result.coords.lat, "number");
    assert.equal(typeof result.coords.lng, "number");
    assert.ok(result.coords.lat >= -90 && result.coords.lat <= 90);
    assert.ok(result.coords.lng >= -180 && result.coords.lng <= 180);
  });
});
