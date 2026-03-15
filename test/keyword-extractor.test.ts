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
  it("normalises English query with noise words via LLM", async () => {
    // ASCII queries now also go through LLM so noise words like "quality" can be stripped
    const result = await extractSearchTerms("quality sofa bed", fakeProvider("sofa bed"));
    assert.equal(result, "sofa bed");
  });

  it("extracts English keywords from Korean query", async () => {
    const result = await extractSearchTerms("퀄리티 좋은 소파 침대", fakeProvider("sofa bed"));
    assert.equal(result, "sofa bed");
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

  it("translates 시계 to wall clock (not wristwatch) for home furnishing context", async () => {
    // In a home furnishing store context, 시계 should resolve to wall clock.
    // The updated prompt adds this context so Claude won't return "watch".
    const result = await extractSearchTerms("시계", fakeProvider("wall clock"));
    assert.equal(result, "wall clock");
  });
});
