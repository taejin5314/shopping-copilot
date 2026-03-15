import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { LlmSynthesizer, fallbackAnswer } from "../src/llm/synthesizer.js";
import type { SynthesisInput } from "../src/llm/synthesizer.js";
import type { LlmProvider, LlmMessage, LlmResponse, LlmOptions } from "../src/llm/provider.js";
import type { ClassifiedIntent, RecommendationResult, PolicyHit, ScoredStore } from "../src/core/types.js";

// ── Fixtures ──

function makeIntent(overrides?: Partial<ClassifiedIntent>): ClassifiedIntent {
  return {
    type: "stock",
    secondary: [],
    itemNos: ["40340622"],
    storeHints: [],
    countryCode: "us",
    confidence: 0.9,
    ...overrides,
  };
}

function makeStore(label: string, score: number): ScoredStore {
  return {
    store: { storeId: "123", label, countryCode: "us" },
    stockCoverageScore: score,
    convenienceScore: 1,
    distanceScore: null,
    priceScore: null,
    totalScore: score,
    itemDetails: [
      { itemNo: "40340622", requested: 1, available: 5, sufficient: true },
    ],
  };
}

function makeRecommendation(stores?: ScoredStore[]): RecommendationResult {
  return {
    ranked: stores ?? [makeStore("IKEA Brooklyn", 0.95)],
    explanationPoints: ["1 store has all items in stock."],
    warnings: [],
  };
}

function makePolicyHit(title: string): PolicyHit {
  return {
    retailer: "ikea",
    title,
    content: `This is the content for ${title}.`,
    source: "https://www.ikea.com/us/en/customer-service/",
    score: 0.8,
  };
}

function makeInput(overrides?: Partial<SynthesisInput>): SynthesisInput {
  return {
    query: "Is KALLAX in stock near Brooklyn?",
    intent: makeIntent(),
    recommendation: makeRecommendation(),
    knowledge: [],
    warnings: [],
    ...overrides,
  };
}

function mockProvider(response: string): LlmProvider {
  return {
    complete: mock.fn(async (_msgs: LlmMessage[], _opts?: LlmOptions): Promise<LlmResponse> => ({
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    })),
  };
}

function failingProvider(error: Error): LlmProvider {
  return {
    complete: mock.fn(async (): Promise<LlmResponse> => { throw error; }),
  };
}

// ── fallbackAnswer tests ──

describe("fallbackAnswer", () => {
  it("renders recommendation with store details", () => {
    const input = makeInput();
    const answer = fallbackAnswer(input);
    assert.ok(answer.includes("IKEA Brooklyn"));
    assert.ok(answer.includes("40340622"));
    assert.ok(answer.includes("in stock"));
  });

  it("renders policy knowledge", () => {
    const input = makeInput({
      intent: makeIntent({ type: "policy" }),
      recommendation: null,
      knowledge: [makePolicyHit("Return Policy")],
    });
    const answer = fallbackAnswer(input);
    assert.ok(answer.includes("Relevant policy information:"));
    assert.ok(answer.includes("Return Policy"));
  });

  it("renders warnings", () => {
    const input = makeInput({
      recommendation: null,
      warnings: ["Stock lookup failed: timeout"],
    });
    const answer = fallbackAnswer(input);
    assert.ok(answer.includes("⚠ Stock lookup failed"));
  });

  it("returns default message when no data", () => {
    const input = makeInput({
      recommendation: null,
      knowledge: [],
      warnings: [],
    });
    const answer = fallbackAnswer(input);
    assert.ok(answer.includes("wasn't able to find"));
  });

  it("combines recommendation + knowledge + warnings", () => {
    const input = makeInput({
      knowledge: [makePolicyHit("Delivery Info")],
      warnings: ["Partial stock data"],
    });
    const answer = fallbackAnswer(input);
    assert.ok(answer.includes("IKEA Brooklyn"));
    assert.ok(answer.includes("Delivery Info"));
    assert.ok(answer.includes("Partial stock data"));
  });
});

// ── LlmSynthesizer tests ──

describe("LlmSynthesizer", () => {
  it("returns LLM response for recommendation input", async () => {
    const provider = mockProvider("KALLAX is available at IKEA Brooklyn with 5 units in stock.");
    const synth = new LlmSynthesizer(provider);
    const result = await synth.synthesize(makeInput());
    assert.equal(result, "KALLAX is available at IKEA Brooklyn with 5 units in stock.");
  });

  it("passes system and user messages to provider", async () => {
    const provider = mockProvider("answer");
    const synth = new LlmSynthesizer(provider);
    await synth.synthesize(makeInput());

    const completeFn = provider.complete as ReturnType<typeof mock.fn>;
    assert.equal(completeFn.mock.calls.length, 1);
    const [messages, opts] = completeFn.mock.calls[0].arguments as [LlmMessage[], LlmOptions];
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.ok(messages[1].content.includes("KALLAX"));
    assert.equal(opts.maxTokens, 250);
    assert.equal(opts.temperature, 0);
  });

  it("includes recommendation evidence in prompt", async () => {
    const provider = mockProvider("answer");
    const synth = new LlmSynthesizer(provider);
    await synth.synthesize(makeInput());

    const completeFn = provider.complete as ReturnType<typeof mock.fn>;
    const [messages] = completeFn.mock.calls[0].arguments as [LlmMessage[]];
    const userContent = messages[1].content;
    assert.ok(userContent.includes("Store Recommendation"));
    assert.ok(userContent.includes("IKEA Brooklyn"));
    assert.ok(userContent.includes("40340622"));
  });

  it("includes policy knowledge in prompt", async () => {
    const provider = mockProvider("Your return window is 365 days.");
    const synth = new LlmSynthesizer(provider);
    const input = makeInput({
      intent: makeIntent({ type: "policy" }),
      knowledge: [makePolicyHit("Return Policy")],
    });
    await synth.synthesize(input);

    const completeFn = provider.complete as ReturnType<typeof mock.fn>;
    const [messages] = completeFn.mock.calls[0].arguments as [LlmMessage[]];
    const userContent = messages[1].content;
    assert.ok(userContent.includes("Retrieved Policy Knowledge"));
    assert.ok(userContent.includes("Return Policy"));
  });

  it("includes warnings in prompt", async () => {
    const provider = mockProvider("answer");
    const synth = new LlmSynthesizer(provider);
    const input = makeInput({ warnings: ["Partial stock data"] });
    await synth.synthesize(input);

    const completeFn = provider.complete as ReturnType<typeof mock.fn>;
    const [messages] = completeFn.mock.calls[0].arguments as [LlmMessage[]];
    const userContent = messages[1].content;
    assert.ok(userContent.includes("Warnings"));
    assert.ok(userContent.includes("Partial stock data"));
  });

  it("falls back to deterministic answer on LLM error", async () => {
    const provider = failingProvider(new Error("API rate limit"));
    const synth = new LlmSynthesizer(provider);
    const result = await synth.synthesize(makeInput());
    // Should get the same output as fallbackAnswer
    assert.ok(result.includes("IKEA Brooklyn"));
    assert.ok(result.includes("40340622"));
  });

  it("falls back on network error", async () => {
    const provider = failingProvider(new TypeError("fetch failed"));
    const synth = new LlmSynthesizer(provider);
    const result = await synth.synthesize(makeInput({ recommendation: null }));
    assert.ok(result.includes("wasn't able to find"));
  });
});
