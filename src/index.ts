// Shopping Copilot — main exports
export { ask } from "./api/ask.js";
export type { CopilotConfig } from "./api/ask.js";
export { IkeaAdapter } from "./retailers/ikea/adapter.js";
export type { IkeaAdapterConfig } from "./retailers/ikea/adapter.js";
export { StubRetriever } from "./rag/retriever.js";
export type { RagRetriever } from "./rag/retriever.js";
export { classifyIntent } from "./domain/intent.js";
export { scoreStore, rankStores, buildRecommendation } from "./domain/scoring.js";
export * from "./core/types.js";
