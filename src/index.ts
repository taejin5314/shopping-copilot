// Shopping Copilot — main exports
export { ask } from "./api/ask.js";
export type { CopilotConfig } from "./api/ask.js";
export { IkeaAdapter } from "./retailers/ikea/adapter.js";
export type { IkeaAdapterConfig } from "./retailers/ikea/adapter.js";
export { StubRetriever } from "./rag/retriever.js";
export { KeywordRetriever } from "./rag/keyword-retriever.js";
export { IKEA_CORPUS } from "./rag/corpus.js";
export type { RagRetriever } from "./rag/retriever.js";
export { classifyIntent } from "./domain/intent.js";
export { scoreStore, rankStores, buildRecommendation } from "./domain/scoring.js";
export { AnthropicProvider } from "./llm/anthropic.js";
export { LlmSynthesizer, fallbackAnswer } from "./llm/synthesizer.js";
export type { LlmProvider, LlmMessage, LlmResponse, LlmOptions } from "./llm/provider.js";
export type { Synthesizer, SynthesisInput } from "./llm/synthesizer.js";
export * from "./core/types.js";
