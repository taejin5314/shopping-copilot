import type { PolicyHit, RetailerId } from "../core/types.js";

// ──────────────────────────────────────────────
// RAG retriever contract + in-memory stub
// ──────────────────────────────────────────────

export interface RagRetriever {
  retrieve(query: string, retailer?: RetailerId, topK?: number): Promise<PolicyHit[]>;
}

/**
 * Stub retriever for Phase 1. Returns empty results.
 * Replace with vector store (e.g. ChromaDB, Pinecone) in Phase 2.
 */
export class StubRetriever implements RagRetriever {
  async retrieve(_query: string, _retailer?: RetailerId, _topK?: number): Promise<PolicyHit[]> {
    return [];
  }
}
