// ──────────────────────────────────────────────
// LLM provider contract — provider-agnostic
// ──────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Minimal LLM provider interface.
 * Implementations must handle their own auth, retries, and rate limits.
 */
export interface LlmProvider {
  complete(messages: LlmMessage[], opts?: LlmOptions): Promise<LlmResponse>;
}

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
}
