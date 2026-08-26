# Obyflow

**AI-native, CLI-first observability platform** for tracing, debugging, and understanding modern applications — LLM calls, vector-store queries, and framework (LangChain) steps included.

Obyflow captures structured events locally (SQLite, no external backend required), correlates them into traces, and uses an LLM of your choice to turn raw evidence into a plain-English investigation of what went wrong.

## Features

- **Tracing** for HTTP requests, LLM calls, vector DB operations, and LangChain chains
- **AI-assisted investigation** — ask a question, get an evidence-backed root-cause summary
- **Local-first storage** via SQLite, zero external infra to get started
- **Pluggable LLM providers** — Anthropic, OpenAI, Gemini, Ollama, or none
- **Node.js and Python SDKs** with matching instrumentation

## Repository layout

```
packages/
  core/                   shared event model, storage, config, evidence & anomaly logic
  cli/                    the `obyflow` CLI (init, start, traces, logs, investigate, ask, incident, ...)
  node-sdk/               @obyflow/node — instrumentation SDK for Node.js apps
  adapters/
    adapter-framework/    LangChain callback handler adapter
    adapter-vectordb/     Pinecone / Qdrant / Weaviate / Chroma / pgvector / Milvus adapters
  llm/
    llm-core/             shared LLM adapter interface
    llm-anthropic/ llm-openai/ llm-gemini/ llm-ollama/
python/
  obyflow-python/         Python SDK (ASGI middleware, LangChain callback, vector/analysis helpers)
```

This is a pnpm + Turborepo monorepo for the TypeScript packages, plus a standalone Python package.

## Getting started

### Prerequisites

- Node.js ≥ 22 (CI targets 24) and [pnpm](https://pnpm.io) 10.x
- A C/C++ toolchain and Python 3 (needed to compile the `better-sqlite3` native addon — most Linux/macOS setups already have these; on Debian/Ubuntu: `apt install build-essential python3`)
- Python ≥ 3.9 (only if you're using the Python SDK)

### Install & build

```bash
git clone https://github.com/AnupamKumar-1/obyflow.git
cd obyflow
pnpm install
pnpm build     # builds every package in dependency order (via turbo)
pnpm test      # runs every package's test suite
```

### Use the CLI

```bash
# from inside your project
npx obyflow init                                # detect the project, write obyflow.config.json
npx obyflow start                                # initialize local SQLite storage
npx obyflow config llm --provider anthropic      # pick an LLM provider for investigations
npx obyflow traces                               # list recent traces
npx obyflow logs                                 # list log events
npx obyflow metrics                              # list metric events
npx obyflow errors                               # list error/critical severity events
npx obyflow services                             # list observed services with event/error counts
npx obyflow usage                                # summarize LLM token consumption and estimated cost by service
npx obyflow investigate <traceId>                # AI-assisted root-cause investigation
npx obyflow investigate --since 1h               # investigate the worst incident in a time window
npx obyflow ask "why did checkout fail today?"
npx obyflow incident summarize                   # summarize the most severe incidents in a time window
npx obyflow incident resolve <traceId> --status resolved   # record how an incident was actually resolved
npx obyflow export --format csv --out events.csv # export events as JSON, CSV, or OTLP
npx obyflow prune --older-than 30d --yes          # delete events older than an age threshold
npx obyflow config list                          # show the current config
npx obyflow config get llm.provider              # read a single config value
npx obyflow config set llm.model <model-id>      # set and persist a config value
```

The read commands (`traces`, `logs`, `metrics`, `errors`, `usage`, `export`) accept `--db <path>` (defaults to `obyflow.db`), `--service <name>`, and `--since <window>` (e.g. `15m`, `2h`, `1d`) to scope results; run `npx obyflow <command> --help` for the full flag list on any command.

Supported LLM providers: `anthropic`, `openai`, `gemini`, `ollama`, or `none` (evidence-only mode, no LLM key required).

### Instrument a Node.js app

```ts
import { start } from "@obyflow/node";

const obyflow = start({ service: "checkout-api" });

// Inbound AND outbound HTTP are both instrumented automatically by start();
// wrap LangChain, vector-db clients, and embedding clients explicitly as needed
const pineconeIndex = obyflow.instrument.pinecone(index);
const langchainHandler = obyflow.instrument.langchain();
```

The SDK also exports the same instrumentation helpers directly if you'd rather not go through `obyflow.instrument.*` (`instrumentOutboundHttp`, `instrumentLangChain`, `instrumentPinecone`/`Qdrant`/`Weaviate`/`Chroma`/`PgVector`/`Milvus`, `instrumentOpenAIEmbeddings`/`AnthropicEmbeddings`/`CohereEmbeddings`) plus trace-context helpers (`runWithTraceContext`, `getActiveTraceId`) for manual instrumentation.

### Instrument a Python app

```python
from obyflow import start
from obyflow.instrumentation.asgi import ObyflowASGIMiddleware

handle = start(service="checkout-api")
app.add_middleware(ObyflowASGIMiddleware, service="checkout-api", store=handle.store)
```

`start()` auto-instruments outbound HTTP; the Python SDK also ships `instrumentation/langchain.py` and `instrumentation/vectordb.py` for LangChain and vector-db instrumentation, an `analysis/` module (`anomaly.py`, `stats.py`) mirroring the TypeScript evidence/anomaly logic, and `redaction.py` for scrubbing sensitive fields before they're stored.

## Development

```bash
pnpm install       # install all workspace dependencies
pnpm build         # turbo run build (respects package dependency order)
pnpm test          # turbo run test
pnpm --filter @obyflow/core test   # test a single package
```

Python SDK:

```bash
cd python/obyflow-python
pip install -e ".[dev]"
pytest
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, coding conventions, and how to submit a pull request.

## License

[MIT](./LICENSE) © Anupam Kumar
