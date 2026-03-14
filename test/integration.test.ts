import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ask } from "../src/api/ask.js";
import { IkeaAdapter } from "../src/retailers/ikea/adapter.js";
import { StubRetriever } from "../src/rag/retriever.js";
import { CopilotError } from "../src/core/types.js";
import type { CopilotResponse } from "../src/core/types.js";
import type { CopilotConfig } from "../src/api/ask.js";

// ──────────────────────────────────────────────
// Integration tests — requires live ikea-mcp at localhost:3000
// Run:  npm run start:http (in ikea-mcp)  then  npm run test:integration
// ──────────────────────────────────────────────

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000";

// Known stable test data
const KALLAX_ITEM = "20275885";       // KALLAX shelf — widely stocked
const BOGUS_ITEM = "99999999";        // does not exist
const KNOWN_STORE = "399";            // Burbank, CA
const BOGUS_STORE = "000";            // not a real store

let config: CopilotConfig;
let isReachable = false;

before(async () => {
  config = {
    adapter: new IkeaAdapter({ mcpBaseUrl: MCP_URL }),
    retriever: new StubRetriever(),
    maxStoreResults: 3,
  };

  // Skip all tests if ikea-mcp is not running
  try {
    const res = await fetch(`${MCP_URL}/health`);
    isReachable = res.ok;
  } catch {
    isReachable = false;
  }

  if (!isReachable) {
    console.log("⚠ ikea-mcp not reachable at %s — skipping integration tests", MCP_URL);
  }
});

function skipIfOffline(): void {
  if (!isReachable) {
    // node:test doesn't have skip() in before, so we assert with a message
    assert.fail(`ikea-mcp not reachable at ${MCP_URL}`);
  }
}

/** Validate the invariant shape of every CopilotResponse. */
function assertResponseShape(r: CopilotResponse): void {
  assert.ok(r.intent, "response.intent exists");
  assert.ok(typeof r.intent.type === "string", "intent.type is string");
  assert.ok(Array.isArray(r.toolCallsUsed), "toolCallsUsed is array");
  assert.ok(Array.isArray(r.retrievedKnowledge), "retrievedKnowledge is array");
  assert.ok(Array.isArray(r.citations), "citations is array");
  assert.ok(Array.isArray(r.warnings), "warnings is array");
  assert.ok(typeof r.answer === "string", "answer is string");

  for (const tc of r.toolCallsUsed) {
    assert.ok(typeof tc.tool === "string");
    assert.ok(typeof tc.retailer === "string");
    assert.ok(typeof tc.durationMs === "number");
    assert.ok(typeof tc.success === "boolean");
  }
}

function assertRecommendationShape(r: CopilotResponse): void {
  assert.ok(r.recommendation, "recommendation exists");
  assert.ok(Array.isArray(r.recommendation.ranked), "ranked is array");
  assert.ok(Array.isArray(r.recommendation.explanationPoints), "explanationPoints is array");

  for (const store of r.recommendation.ranked) {
    assert.ok(typeof store.store.storeId === "string");
    assert.ok(typeof store.store.label === "string");
    assert.ok(typeof store.stockCoverageScore === "number");
    assert.ok(store.stockCoverageScore >= 0 && store.stockCoverageScore <= 1);
    assert.ok(typeof store.totalScore === "number");
    assert.ok(Array.isArray(store.itemDetails));

    for (const d of store.itemDetails) {
      assert.ok(typeof d.itemNo === "string");
      assert.ok(typeof d.requested === "number");
      assert.ok(typeof d.sufficient === "boolean");
      // available can be number or null
      assert.ok(d.available === null || typeof d.available === "number");
    }
  }
}

// ── Tests ──

describe("integration: stock query with known item", () => {
  it("returns valid response shape with recommendation", async () => {
    skipIfOffline();
    const r = await ask(
      {
        query: `Is ${KALLAX_ITEM} in stock in US?`,
        countryCode: "US",
        cart: [{ itemNo: KALLAX_ITEM, quantity: 1 }],
      },
      config,
    );
    assertResponseShape(r);
    assert.ok(r.intent.type === "stock" || r.intent.type === "recommendation");
    assertRecommendationShape(r);
    assert.ok(r.recommendation!.ranked.length > 0, "at least one store returned");
    assert.ok(
      r.toolCallsUsed.some((tc) => tc.success),
      "at least one successful tool call",
    );
  });
});

describe("integration: cart with multiple items", () => {
  it("ranks stores and reports per-item details", async () => {
    skipIfOffline();
    const r = await ask(
      {
        query: "Which store has these items?",
        countryCode: "US",
        cart: [
          { itemNo: KALLAX_ITEM, quantity: 1 },
          { itemNo: "40522047", quantity: 2 },  // ALEX drawer
        ],
      },
      config,
    );
    assertResponseShape(r);
    assertRecommendationShape(r);

    const best = r.recommendation!.ranked[0];
    assert.equal(best.itemDetails.length, 2, "two items in cart");
    // Scores are deterministic: sorted descending
    const scores = r.recommendation!.ranked.map((s) => s.totalScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] <= scores[i - 1], "ranked descending by totalScore");
    }
  });
});

describe("integration: bogus item number", () => {
  it("returns response with warnings instead of crashing", async () => {
    skipIfOffline();
    const r = await ask(
      {
        query: `Is ${BOGUS_ITEM} in stock?`,
        cart: [{ itemNo: BOGUS_ITEM, quantity: 1 }],
      },
      config,
    );
    assertResponseShape(r);
    // Should still produce a response — bogus items appear as insufficient
    if (r.recommendation) {
      for (const store of r.recommendation.ranked) {
        const detail = store.itemDetails.find((d) => d.itemNo === BOGUS_ITEM);
        if (detail) {
          // Bogus item should not be marked sufficient
          assert.equal(detail.sufficient, false);
        }
      }
    }
  });
});

describe("integration: explicit bogus store via adapter", () => {
  it("handles 405 store gracefully", async () => {
    skipIfOffline();
    const adapter = new IkeaAdapter({ mcpBaseUrl: MCP_URL });
    // Direct adapter call with a bogus store
    const stocks = await adapter.findStoresForCart(
      [{ itemNo: KALLAX_ITEM, quantity: 1 }],
      { storeIds: [BOGUS_STORE], maxResults: 1 },
    );
    // Should return results (possibly empty) without throwing
    assert.ok(Array.isArray(stocks));
  });
});

describe("integration: policy query (RAG stub)", () => {
  it("returns empty knowledge without crashing", async () => {
    skipIfOffline();
    const r = await ask(
      { query: "What is the return policy for furniture?" },
      config,
    );
    assertResponseShape(r);
    assert.equal(r.intent.type, "policy");
    assert.equal(r.retrievedKnowledge.length, 0, "stub returns no docs");
    assert.ok(r.warnings.some((w) => w.includes("No relevant policy")));
  });
});

describe("integration: unknown intent", () => {
  it("returns unknown with warning", async () => {
    skipIfOffline();
    const r = await ask({ query: "hello" }, config);
    assertResponseShape(r);
    assert.equal(r.intent.type, "unknown");
    assert.ok(r.warnings.some((w) => w.includes("Could not determine")));
  });
});

describe("integration: invalid input", () => {
  it("throws CopilotError on empty query", async () => {
    skipIfOffline();
    await assert.rejects(
      () => ask({ query: "" }, config),
      (err: unknown) => {
        assert.ok(err instanceof CopilotError);
        assert.equal(err.code, "INVALID_ITEM");
        return true;
      },
    );
  });
});

describe("integration: tool call timing", () => {
  it("records durationMs for each tool call", async () => {
    skipIfOffline();
    const r = await ask(
      {
        query: `Is ${KALLAX_ITEM} in stock?`,
        cart: [{ itemNo: KALLAX_ITEM, quantity: 1 }],
      },
      config,
    );
    for (const tc of r.toolCallsUsed) {
      assert.ok(tc.durationMs >= 0, "durationMs is non-negative");
    }
  });
});
