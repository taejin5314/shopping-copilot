# Shopilot

Retailer-agnostic shopping assistant that compares stores across multiple retailers using deterministic recommendation logic, policy retrieval (RAG), and optional LLM synthesis.

> **Status:** v0.1.0 — functional demo, deployed on [Google Cloud Run](https://cloud.google.com/run).

## What it does

Ask a natural-language question about furniture shopping and get a structured answer:

```bash
curl -X POST http://localhost:4000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Is KALLAX 40340622 in stock near me?",
    "retailer": "ikea",
    "countryCode": "US",
    "locationText": "Brooklyn, NY",
    "cart": [{ "itemNo": "40340622", "quantity": 2 }]
  }'
```

The copilot will:

1. **Classify intent** — stock check, policy question, recommendation, product info
2. **Geocode location** — free-text like "Toronto, ON" → lat/lng (via Nominatim)
3. **Fetch live data** — via MCP tools (IKEA) or REST APIs (Structube)
4. **Rank stores** — deterministic composite scoring: stock (50%) + convenience (25%) + price (15%) + distance (10%)
5. **Retrieve policies** — BM25 keyword search over curated retailer corpora
6. **Synthesize an answer** — LLM-powered (Anthropic Claude) or deterministic fallback

> **Note:** When a cart is provided, the stock/ranking path runs automatically — even if the query is in a non-English language the classifier doesn't recognize.

## Architecture

```
POST /ask
  │
  ▼
QueryInput (Zod validation)
  │
  ├─► locationText? ──► Geocoder (Nominatim) ──► {lat, lng}
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

**Key design principles:**

- **LLM is only for synthesis/presentation.** All routing, scoring, and data retrieval is deterministic.
- **Retailer adapters** abstract data access: IKEA uses MCP (Model Context Protocol), Structube uses a direct REST adapter.
- **No API keys required** for core functionality — Anthropic key is optional, Nominatim geocoding is free.
- **Graceful degradation** — missing location, price data, or LLM key all produce useful results with warnings.

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
# Copy env template
cp .env.example .env    # edit if needed

# Start ikea-mcp first (required for IKEA queries)
npx ikea-mcp@latest

# In another terminal
npm run dev:http
# → shopping-copilot listening on http://localhost:4000
# → Open http://localhost:4000 for the web UI
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `MCP_URL` | `http://localhost:3000` | ikea-mcp server URL |
| `MCP_API_KEY` | — | Optional API key for ikea-mcp |
| `ANTHROPIC_API_KEY` | — | Enables LLM synthesis (optional) |

Without `ANTHROPIC_API_KEY`, the copilot falls back to deterministic template answers.

## Demo

Once the server is running, open **http://localhost:4000** for the web UI, or use curl:

**1. Stock check with location (geocoded)**
```bash
curl -s -X POST http://localhost:4000/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Is KALLAX 40340622 in stock?",
    "retailer": "ikea",
    "countryCode": "US",
    "locationText": "Brooklyn, NY",
    "cart": [{ "itemNo": "40340622", "quantity": 2 }]
  }' | jq .recommendation.ranked[0]
```
→ Returns the top-ranked store with stock/distance/price scores.

**2. Policy question**
```bash
curl -s -X POST http://localhost:4000/ask \
  -H 'Content-Type: application/json' \
  -d '{ "query": "What is the return policy for Structube?", "retailer": "structube" }' \
  | jq '{ answer, citations }'
```
→ Returns policy text with source citations from the RAG corpus.

**3. Multi-item cart comparison**
```bash
curl -s -X POST http://localhost:4000/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Where can I get all of these?",
    "retailer": "ikea",
    "countryCode": "US",
    "locationText": "Toronto",
    "cart": [
      { "itemNo": "40340622", "quantity": 1 },
      { "itemNo": "30275861", "quantity": 2 }
    ]
  }' | jq '.recommendation.ranked[:3] | .[] | { store: .store.label, score: .totalScore }'
```
→ Returns top 3 stores ranked by composite score.

## API

### `POST /ask`

```jsonc
// Request
{
  "query": "What is the return policy?",       // required, 1-2000 chars
  "retailer": "structube",                     // optional, default: ikea
  "countryCode": "CA",                         // optional, 2-char ISO
  "locationText": "Toronto",                   // optional, free-text (geocoded server-side)
  "location": { "lat": 43.65, "lng": -79.38 },// optional, explicit coords (takes priority)
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
├── api/            HTTP server, Zod schemas, ask() entrypoint, geocode resolution
├── core/           Domain types, RetailerAdapter interface, CopilotError
├── domain/         Intent classifier, scoring engine, geo utilities, geocoder
├── llm/            LlmProvider interface, Anthropic provider, synthesizer
├── orchestration/  Routes intent → adapters/RAG → scorer → response
├── rag/            RagRetriever, BM25 keyword retriever, policy corpora
└── retailers/
    ├── ikea/       MCP SDK client adapter (live stock + prices)
    └── structube/  REST API adapter + static store data (15 locations)
```

## Tests

```bash
npm test              # unit tests (no external services needed)
npm run test:api      # API integration tests (requires live ikea-mcp)
npm run test:integration  # Full integration tests (requires live ikea-mcp)
npm run test:all      # All tests
```

| Test Suite | Count | What it covers |
|------------|-------|----------------|
| intent | 18 | Pattern-based classification, non-English handling |
| scoring | 13 | Stock coverage, ranking, recommendations |
| retriever | 15 | BM25 keyword retrieval, edge cases |
| synthesizer | 12 | LLM synthesis, fallback, prompt construction |
| structube-adapter | 19 | Adapter methods, pipeline, multi-retailer routing, cart override |
| distance | 18 | Haversine, score normalization, distance-aware ranking |
| price | 13 | Price normalization, cross-retailer, mixed signals |
| geocode | 12 | Nominatim resolution, failure modes, distance scoring integration |

## Offline quality review

The review pipeline scores logged pipeline outputs against a set of heuristics and reports findings by severity (`fail` / `warn` / `info`).

```bash
# Review a file and print findings
npm run review -- ci/sample-review-input.json

# Run the quality gate (exits 1 if any fail-severity finding is found)
npm run review:gate -- --max-failed=0 ci/sample-review-input.json

# Typecheck + tests + quality gate in one command
npm run ci:local
```

The CI workflow runs `npm run review:gate -- --max-failed=0 ci/sample-review-input.json` automatically on every push and pull request. The sample input at [`ci/sample-review-input.json`](ci/sample-review-input.json) is the checked-in fixture; `test/ci-sample.test.ts` verifies it stays in sync with the gate logic.

When running in GitHub Actions, the CLI automatically detects `$GITHUB_STEP_SUMMARY` and appends a concise GFM job summary (gate status, failed checks, key counts, fallback rate, top categories). Pass `--summary-file=<path>` to write the summary locally:

```bash
npm run review:gate -- --max-failed=0 --summary-file=summary.md ci/sample-review-input.json
```

## Tech Stack

- **TypeScript** (ES2022, ESM, strict mode)
- **Node.js >= 20** (built-in test runner, native fetch)
- **Zod** — input validation
- **@modelcontextprotocol/sdk** — MCP client for IKEA adapter
- **Anthropic Claude** — optional LLM synthesis (raw HTTP, no SDK)

Zero heavy dependencies. No vector database, no embedding model, no ORM.

## Deployment

The project ships with a multi-stage Dockerfile that bundles both shopping-copilot and ikea-mcp in a single container. A startup script waits for ikea-mcp to become healthy before accepting traffic.

### Docker (local)

```bash
docker build -t shopilot .
docker run -p 4000:4000 shopilot
# → http://localhost:4000

# With LLM synthesis:
docker run -p 4000:4000 -e ANTHROPIC_API_KEY=sk-ant-... shopilot
```

### Google Cloud Run (production)

Automated via GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). Every push to `master` builds the Docker image, pushes to Artifact Registry, and deploys to Cloud Run.

**Prerequisites (one-time GCP setup):**

1. Enable APIs: Cloud Run, Cloud Build, Artifact Registry, IAM Credentials, Secret Manager
2. Create Artifact Registry repository:
   ```bash
   gcloud artifacts repositories create shopilot \
     --repository-format=docker --location=us-central1
   ```
3. Set up [Workload Identity Federation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation)
4. Add GitHub Secrets: `GCP_PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`
5. Register API keys in Secret Manager:
   ```bash
   echo -n "sk-ant-..." | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
   ```

The container starts ikea-mcp internally on port 3000, so no separate MCP service is needed. Cloud Run scales to zero when idle — no cost when not in use.

### Analytics & Data Collection

Product click events are tracked via **Google Analytics 4** (`select_item` event with `item_id`, `item_name`, `item_brand`, `price`).

To enable:
1. Create a GA4 property and copy the Measurement ID (`G-XXXXXXXXXX`)
2. Replace `GA_MEASUREMENT_ID` in [`public/index.html`](public/index.html) with your ID
3. Enable **BigQuery Export** in GA4 → Admin → BigQuery Links

Click data flows into BigQuery automatically and can be used to build training datasets for recommendation model fine-tuning.

## License

MIT
