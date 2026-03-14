import { createHttpServer } from "./server.js";
import { IkeaAdapter } from "../retailers/ikea/adapter.js";
import { StubRetriever } from "../rag/retriever.js";

const PORT = Number(process.env.PORT ?? 4000);
const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000";

const config = {
  adapter: new IkeaAdapter({ mcpBaseUrl: MCP_URL, apiKey: process.env.MCP_API_KEY }),
  retriever: new StubRetriever(),
  maxStoreResults: 5,
};

const server = createHttpServer(config);
server.listen(PORT, () => {
  console.error(`shopping-copilot listening on http://localhost:${PORT}`);
  console.error(`POST /ask — query the copilot`);
  console.error(`GET  /health — health check`);
  console.error(`ikea-mcp upstream: ${MCP_URL}`);
});
