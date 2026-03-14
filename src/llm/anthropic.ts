import type { LlmProvider, LlmMessage, LlmOptions, LlmResponse } from "./provider.js";

// ──────────────────────────────────────────────
// Anthropic Claude provider — raw HTTP, no SDK dependency
// ──────────────────────────────────────────────

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async complete(messages: LlmMessage[], opts?: LlmOptions): Promise<LlmResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const body = {
      model: this.model,
      max_tokens: opts?.maxTokens ?? 1024,
      temperature: opts?.temperature ?? 0.3,
      ...(systemMsg && { system: systemMsg.content }),
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json() as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const content = json.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content,
      usage: json.usage
        ? { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens }
        : undefined,
    };
  }
}
