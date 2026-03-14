import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSearchTerms } from "../src/llm/keyword-extractor.js";
import type { LlmProvider, LlmResponse } from "../src/llm/provider.js";

function fakeProvider(response: string): LlmProvider {
  return {
    complete: async () => ({ content: response } as LlmResponse),
  };
}

function throwingProvider(): LlmProvider {
  return {
    complete: async () => { throw new Error("LLM down"); },
  };
}

describe("extractSearchTerms", () => {
  it("returns null for ASCII-only queries", async () => {
    const result = await extractSearchTerms("sofa bed", fakeProvider("should not be called"));
    assert.equal(result, null);
  });

  it("extracts English keywords from Korean query", async () => {
    const result = await extractSearchTerms("퀄리티 좋은 소파 침대", fakeProvider("quality sofa bed"));
    assert.equal(result, "quality sofa bed");
  });

  it("extracts English keywords from Japanese query", async () => {
    const result = await extractSearchTerms("本棚 おすすめ", fakeProvider("bookshelf recommended"));
    assert.equal(result, "bookshelf recommended");
  });

  it("returns null when LLM returns empty string", async () => {
    const result = await extractSearchTerms("소파", fakeProvider(""));
    assert.equal(result, null);
  });

  it("returns null when LLM throws", async () => {
    const result = await extractSearchTerms("소파", throwingProvider());
    assert.equal(result, null);
  });
});
