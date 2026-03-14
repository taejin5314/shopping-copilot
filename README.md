# Shopping Copilot

Retailer-agnostic shopping assistant that compares stores across multiple retailers using deterministic recommendation logic, policy retrieval (RAG), and optional LLM synthesis.

> **Status:** Active development (v0.1.0) — not production-ready yet.

## What it does

Ask a natural-language question about furniture shopping and get a structured answer:

```bash
curl -X POST http://localhost:4000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Is KALLAX 40340622 in stock near me?",
    "retailer": "ikea",
    "countryCode": "US",
    "location": { "lat": 40.67, "lng": -73.98 },
    "cart": [{ "itemNo": "40340622", "quantity": 2 }]
  }'
```

The copilot will:

1. **Classify intent** — stock check, policy question, store recommendation, product info
2. **Fetch live data** — via MCP tools (IKEA) or REST APIs (Structube)
3. **Rank stores** — deterministic scoring: stock coverage (50%), convenience (25%), price (15%), distance (10%)
4. **Retrieve policies** — BM25 keyword search over curated policy corpora
5. **Synthesize an answer** — LLM-powered (Anthropic Claude) or deterministic fallback

## Architecture

```
POST /ask
  │
  ▼
QueryInput (Zod validation)
  │
  ▼
Intent Classifier (pattern-based, no LLM)
  │
  ├─► Stock path ──► RetailerAdapter.findStoresForCart()
  │                       │
  │                       ▼
  │                  Scoring Engine (stock + distance + price)
  │                       │
  │                       ▼
  │                  Recommendation (ranked stores + explanations)
  │
  ├─► Policy path ──► KeywordRetriever (BM25-lite)
  │                       │
  │                       ▼
  │                  PolicyHit[] with citations
  │
  └─► Synthesizer ──► LLM (grounded prompt) or deterministic fallback
          │
          ▼
    CopilotResponse
```

**Key design principle:** LLM is only used for synthesis/presentation. All routing, scoring, and data retrieval is deterministic.

## Supported Retailers

| Retailer   | Stock Data | Price Data | Store Coords | Policy Corpus |
|------------|:----------:|:----------:|:------------:|:-------------:|
| IKEA       | ✅ Live (MCP) | ✅ via search | ❌ (from adapter) | ✅ 15 chunks |
| Structube  | ⚠️ Limited  | ✅ via search | ✅ Static (15 stores) | ✅ 8 chunks |

Adding a new retailer: implement [`RetailerAdapter`](src/core/adapter.ts) (4 methods), add a policy corpus, register in [`http.ts`](src/api/http.ts).

## Setup

```bash
# Prerequisites: Node.js >= 20, pnpm/npm
npm install
npm run typecheck
npm test
```

### Running the HTTP server

```bash
# Start ikea-mcp first (required for IKEA adapter)
npx ikea-mcp@1.6.1

# In another terminal
npm run dev:http
# → shopping-copilot listening on http://localhost:4000
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `MCP_URL` | `http://localhost:3000` | ikea-mcp server URL |
| `MCP_API_KEY` | — | Optional API key for ikea-mcp |
| `ANTHROPIC_API_KEY` | — | Enables LLM synthesis (optional) |

Without `ANTHROPIC_API_KEY`, the copilot falls back to deterministic template answers.

## API

### `POST /ask`

```jsonc
// Request
{
  "query": "What is the return policy?",       // required, 1-2000 chars
  "retailer": "structube",                     // optional, default: ikea
  "countryCode": "CA",                         // optional, 2-char ISO
  "location": { "lat": 43.65, "lng": -79.38 },// optional, for distance scoring
  "cart": [                                    // optional, for stock scoring
    { "itemNo": "40340622", "quantity": 2 }
  ]
}
```

```jsonc
// Response
{
  "intent": { "type": "policy", "secondary": [], ... },
  "recommendation": null,
  "retrievedKnowledge": [{ "title": "...", "content": "...", "score": 0.8 }],
  "answer": "Structube offers a 30-day return policy...",
  "citations": [{ "label": "...", "url": "https://..." }],
  "warnings": ["No user location provided — distance scoring was not applied."],
  "toolCallsUsed": [{ "tool": "rag_retrieve", "durationMs": 3, "success": true }]
}
```

### `GET /health`

Returns `{ "status": "ok" }`.

## Scoring Engine

Pure deterministic functions — no I/O, no LLM.

| Signal | Weight | Source | Fallback |
|--------|--------|--------|----------|
| Stock coverage | 0.50 | Adapter `findStoresForCart` | 0 if unavailable |
| Convenience | 0.25 | Derived from stock coverage | 0 if unavailable |
| Price | 0.15 | Adapter `searchProducts` | null (neutral) |
| Distance | 0.10 | Haversine from user location | null (neutral) |

- **Distance:** `1 / (1 + km / 50)` — 0 km = 1.0, 50 km = 0.5, ~infinite = 0.0
- **Price:** Relative normalization across candidates — cheapest = 1.0, most expensive = 0.0
- Missing signals are treated as neutral (0 contribution), never penalized.

## Project Structure

```
src/
├── api/            HTTP server, Zod schemas, ask() entrypoint
├── core/           Domain types, RetailerAdapter interface, CopilotError
├── domain/         Intent classifier, scoring engine, geo utilities
├── llm/            LlmProvider interface, Anthropic provider, synthesizer
├── orchestration/  Routes intent → adapters/RAG → scorer → response
├── rag/            RagRetriever, BM25 keyword retriever, policy corpora
└── retailers/
    ├── ikea/       MCP SDK client adapter
    └── structube/  REST API adapter + static store data
```

## Tests

```bash
npm test              # 103 unit tests (scoring, intent, retriever, synthesizer, adapters, distance, price)
npm run test:api      # API integration tests (requires live ikea-mcp)
npm run test:integration  # Full integration tests (requires live ikea-mcp)
npm run test:all      # All tests
```

| Test Suite | Count | What it covers |
|------------|-------|----------------|
| intent | 15 | Pattern-based intent classification |
| scoring | 13 | Stock coverage, ranking, recommendations |
| retriever | 15 | BM25 keyword retrieval, edge cases |
| synthesizer | 12 | LLM synthesis, fallback, prompt construction |
| structube-adapter | 17 | Adapter methods, pipeline integration, multi-retailer routing |
| distance | 18 | Haversine, score normalization, distance-aware ranking |
| price | 13 | Price normalization, cross-retailer, mixed signals |

## Tech Stack

- **TypeScript** (ES2022, ESM, strict mode)
- **Node.js >= 20** (built-in test runner, native fetch)
- **Zod** — input validation
- **@modelcontextprotocol/sdk** — MCP client for IKEA adapter
- **Anthropic Claude** — optional LLM synthesis (raw HTTP, no SDK)

Zero heavy dependencies. No vector database, no embedding model, no ORM.

## License

MIT
