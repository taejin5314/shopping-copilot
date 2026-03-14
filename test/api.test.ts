import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createHttpServer } from "../src/api/server.js";
import { IkeaAdapter } from "../src/retailers/ikea/adapter.js";
import { StubRetriever } from "../src/rag/retriever.js";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000";
const PORT = 4123; // test-only port

let server: Server;
let mcpReachable = false;

before(async () => {
  try {
    const res = await fetch(`${MCP_URL}/health`);
    mcpReachable = res.ok;
  } catch {
    mcpReachable = false;
  }
  if (!mcpReachable) {
    console.log("⚠ ikea-mcp not reachable — skipping API tests that need live MCP");
  }

  const config = {
    adapter: new IkeaAdapter({ mcpBaseUrl: MCP_URL }),
    retriever: new StubRetriever(),
    maxStoreResults: 3,
  };
  server = createHttpServer(config);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});

after(() => {
  server?.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as Record<string, unknown>;
  return { status: res.status, json };
}

describe("HTTP /health", () => {
  it("returns 200 ok", async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    assert.equal(res.status, 200);
    const json = await res.json() as Record<string, unknown>;
    assert.equal(json.status, "ok");
  });
});

describe("HTTP /ask — validation", () => {
  it("returns 400 for empty body", async () => {
    const { status, json } = await post("/ask", {});
    assert.equal(status, 400);
    assert.equal(json.error, "INVALID_ITEM");
  });

  it("returns 400 for missing query", async () => {
    const { status, json } = await post("/ask", { cart: [] });
    assert.equal(status, 400);
    assert.equal(json.error, "INVALID_ITEM");
  });
});

describe("HTTP /ask — live", () => {
  it("returns 200 with CopilotResponse shape for policy query", async () => {
    const { status, json } = await post("/ask", { query: "What is the return policy?" });
    assert.equal(status, 200);
    assert.ok(json.intent, "has intent");
    assert.ok(json.answer, "has answer");
    assert.ok(Array.isArray(json.warnings), "has warnings array");
    assert.ok(Array.isArray(json.toolCallsUsed), "has toolCallsUsed array");
  });

  it("returns 200 with recommendation for stock query (live MCP)", async () => {
    if (!mcpReachable) {
      assert.fail("ikea-mcp not reachable");
    }
    const { status, json } = await post("/ask", {
      query: "Is 20275885 in stock?",
      cart: [{ itemNo: "20275885", quantity: 1 }],
    });
    assert.equal(status, 200);
    assert.ok(json.recommendation, "has recommendation");
  });
});

describe("HTTP 404", () => {
  it("returns 404 for unknown route", async () => {
    const res = await fetch(`http://localhost:${PORT}/unknown`);
    assert.equal(res.status, 404);
  });
});
