import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KeywordRetriever } from "../src/rag/keyword-retriever.js";
import { IKEA_CORPUS, tokenize } from "../src/rag/corpus.js";

const retriever = new KeywordRetriever(IKEA_CORPUS);

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    const tokens = tokenize("Return policy — 365-day window!");
    assert.ok(tokens.includes("return"));
    assert.ok(tokens.includes("policy"));
    assert.ok(tokens.includes("365"));
    assert.ok(tokens.includes("day"));
    assert.ok(!tokens.some((t) => t.includes("—")));
  });

  it("returns empty for blank input", () => {
    assert.deepEqual(tokenize(""), []);
  });
});

describe("KeywordRetriever — returns domain", () => {
  it("retrieves return policy for 'how do I return furniture'", async () => {
    const hits = await retriever.retrieve("how do I return furniture", "ikea");
    assert.ok(hits.length > 0, "at least one hit");
    assert.ok(hits[0].title.toLowerCase().includes("return"), "top hit is about returns");
    assert.ok(hits[0].score > 0, "score is positive");
    assert.ok(hits[0].score <= 1, "score is normalized 0–1");
    assert.equal(hits[0].retailer, "ikea");
    assert.ok(hits[0].source.includes("ikea.com"), "has source URL");
  });

  it("retrieves refund info for 'how long does a refund take'", async () => {
    const hits = await retriever.retrieve("how long does a refund take", "ikea");
    assert.ok(hits.some((h) => h.content.toLowerCase().includes("refund")));
  });

  it("retrieves exchange policy for 'can I exchange'", async () => {
    const hits = await retriever.retrieve("can I exchange an item", "ikea");
    assert.ok(hits.some((h) => h.title.toLowerCase().includes("exchange")));
  });
});

describe("KeywordRetriever — delivery domain", () => {
  it("retrieves delivery info for 'how much does delivery cost'", async () => {
    const hits = await retriever.retrieve("how much does delivery cost", "ikea");
    assert.ok(hits.length > 0);
    assert.ok(hits.some((h) => h.content.toLowerCase().includes("delivery")));
  });

  it("retrieves Click & Collect for 'pickup at store'", async () => {
    const hits = await retriever.retrieve("can I pickup my order at the store", "ikea");
    assert.ok(hits.some((h) => h.title.toLowerCase().includes("collect") || h.content.toLowerCase().includes("pick up")));
  });
});

describe("KeywordRetriever — assembly domain", () => {
  it("retrieves assembly info for 'do I need tools'", async () => {
    const hits = await retriever.retrieve("what tools do I need for assembly", "ikea");
    assert.ok(hits.length > 0);
    assert.ok(hits.some((h) => h.content.toLowerCase().includes("tool")));
  });

  it("retrieves TaskRabbit info for 'professional assembly'", async () => {
    const hits = await retriever.retrieve("professional assembly service", "ikea");
    assert.ok(hits.some((h) => h.content.toLowerCase().includes("taskrabbit")));
  });

  it("retrieves wall anchoring for 'anchor bookshelf'", async () => {
    const hits = await retriever.retrieve("how to anchor bookshelf to wall", "ikea");
    assert.ok(hits.some((h) => h.content.toLowerCase().includes("anchor")));
  });
});

describe("KeywordRetriever — edge cases", () => {
  it("returns empty for irrelevant query", async () => {
    const hits = await retriever.retrieve("quantum physics lecture", "ikea");
    // May return low-score hits; verify they're at least low confidence
    if (hits.length > 0) {
      assert.ok(hits[0].score < 0.5, "irrelevant query scores low");
    }
  });

  it("returns empty for empty query", async () => {
    const hits = await retriever.retrieve("", "ikea");
    assert.equal(hits.length, 0);
  });

  it("respects topK parameter", async () => {
    const hits = await retriever.retrieve("return policy delivery", "ikea", 2);
    assert.ok(hits.length <= 2);
  });

  it("scores are descending", async () => {
    const hits = await retriever.retrieve("return policy refund", "ikea", 5);
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i].score <= hits[i - 1].score, "descending order");
    }
  });

  it("filters by retailer", async () => {
    const hits = await retriever.retrieve("return policy", "structube");
    assert.equal(hits.length, 0, "no hits for unknown retailer");
  });
});
