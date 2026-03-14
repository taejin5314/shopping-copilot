import { createHttpServer } from "./server.js";
import { IkeaAdapter } from "../retailers/ikea/adapter.js";
import { StructubeAdapter } from "../retailers/structube/adapter.js";
import { KeywordRetriever } from "../rag/keyword-retriever.js";
import { IKEA_CORPUS } from "../rag/corpus.js";
import { STRUCTUBE_CORPUS } from "../rag/structube-corpus.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { LlmSynthesizer } from "../llm/synthesizer.js";
import type { CopilotConfig } from "./ask.js";

const PORT = Number(process.env.PORT ?? 4000);
const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const provider = ANTHROPIC_API_KEY ? new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY }) : undefined;

const config: CopilotConfig = {
  // Default retailer: IKEA
  adapter: new IkeaAdapter({ mcpBaseUrl: MCP_URL, apiKey: process.env.MCP_API_KEY }),
  retriever: new KeywordRetriever(IKEA_CORPUS),
  // Additional retailers
  retailers: {
    structube: {
      adapter: new StructubeAdapter(),
      retriever: new KeywordRetriever(STRUCTUBE_CORPUS),
    },
  },
  maxStoreResults: 5,
  ...(provider && {
    synthesizer: new LlmSynthesizer(provider),
    llmProvider: provider,
  }),
};

const server = createHttpServer(config);
server.listen(PORT, () => {
  console.error(`shopping-copilot listening on http://localhost:${PORT}`);
  console.error(`POST /ask — query the copilot`);
  console.error(`GET  /health — health check`);
  console.error(`Retailers: ikea (default), structube`);
  console.error(`ikea-mcp upstream: ${MCP_URL}`);
});
