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
npx obyflow investigate <traceId>                # AI-assisted root-cause investigation
npx obyflow ask "why did checkout fail today?"
```

Supported LLM providers: `anthropic`, `openai`, `gemini`, `ollama`, or `none` (evidence-only mode, no LLM key required).

### Instrument a Node.js app

```ts
import { start } from "@obyflow/node";

const obyflow = await start({ service: "checkout-api" });

// wrap outbound HTTP, LangChain, and vector-db clients as needed
obyflow.instrumentHttp();
```

### Instrument a Python app

```python
from obyflow import start
from obyflow.instrumentation.asgi import ObyflowASGIMiddleware

handle = start(service="checkout-api")
app.add_middleware(ObyflowASGIMiddleware, handle=handle)
```

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
