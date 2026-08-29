# @obyflow/node

Node.js instrumentation SDK for [Obyflow](https://github.com/Obyflow/obyflow) — an AI-native, CLI-first observability platform for tracing, debugging, and understanding modern applications (LLM calls, vector-store queries, LangChain steps, and plain HTTP included).

Events are captured locally to SQLite (no external backend required) and can then be explored, correlated, and investigated with the [`obyflow`](https://www.npmjs.com/package/obyflow) CLI.

## Install

```bash
npm install @obyflow/node
```

Requires Node.js ≥ 22.

## Quick start

```ts
import { start } from "@obyflow/node";

const obyflow = start({ service: "checkout-api" });

// Inbound AND outbound HTTP are both instrumented automatically by start(),
// including automatic trace-context propagation (x-obyflow-trace-id /
// x-obyflow-parent-span-id headers) across outbound calls to other services.

// Wrap vector-db clients, embedding clients, and LangChain explicitly as needed:
const pineconeIndex = obyflow.instrument.pinecone(index);
const langchainHandler = obyflow.instrument.langchain();
```

Then, in the same project:

```bash
npx obyflow init
npx obyflow traces
npx obyflow investigate --since 15m
```

## What's instrumented

- **HTTP** — inbound requests and outbound `http`/`https`/`fetch` calls, with automatic cross-service trace propagation
- **LangChain** — chain/tool/LLM call events via a callback handler (`instrument.langchain()`); no dependency on `langchain` itself, works structurally against any compatible version
- **Vector databases** — Pinecone, Qdrant, Weaviate, Chroma, pgvector, and Milvus (`instrument.pinecone`, `.qdrant`, `.weaviate`, `.chroma`, `.pgvector`, `.milvus`)
- **Embeddings** — OpenAI, Anthropic, and Cohere embedding calls (`instrument.openaiEmbeddings`, `.anthropicEmbeddings`, `.cohereEmbeddings`)

Every instrumented event is automatically tagged with resource attributes — hostname, PID, Node version, and the current git commit SHA (from CI env vars or a local `git rev-parse HEAD`) — which is what powers commit-based "what changed" correlation in the CLI, with no extra setup.

## API

```ts
const obyflow = start({
  service: "checkout-api",     // required
  dbPath: "obyflow.db",         // optional, defaults to obyflow.db / config
  deploymentId: "v1.2.3",       // optional
  redaction: { ... },            // optional, overrides obyflow.config.json
  resourceAttributes: { ... },   // optional extra tags, object or () => object
});

obyflow.emit({ type: "custom", service: "checkout-api", attributes: { ... } });
obyflow.getTrace(traceId);
obyflow.stop();
```

The same instrumentation helpers are also exported directly if you'd rather not go through `obyflow.instrument.*`: `instrumentOutboundHttp`, `instrumentLangChain`, `instrumentPinecone`/`Qdrant`/`Weaviate`/`Chroma`/`PgVector`/`Milvus`, `instrumentOpenAIEmbeddings`/`AnthropicEmbeddings`/`CohereEmbeddings`, plus trace-context helpers `runWithTraceContext`/`getActiveTraceId`/`getActiveRequestId` for manual instrumentation.

Sensitive fields (passwords, tokens, credit cards, SSNs, API keys) are redacted before storage by default — see [redaction config](https://github.com/Obyflow/obyflow#readme).

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [`obyflow` CLI](https://www.npmjs.com/package/obyflow)
- [Python SDK](https://pypi.org/project/obyflow-python/)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)

## License

MIT © Anupam Kumar
