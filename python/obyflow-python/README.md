# obyflow-python

Python instrumentation SDK for [Obyflow](https://github.com/AnupamKumar-1/obyflow) — an AI-native, CLI-first observability platform for tracing, debugging, and understanding modern applications (LLM calls, vector-store queries, LangChain steps, and plain HTTP included).

Events are captured locally to SQLite (no external backend required) and can then be explored, correlated, and investigated with the [`obyflow`](https://www.npmjs.com/package/obyflow) CLI.

## Installation

```bash
pip install obyflow-python
```

Requires Python ≥ 3.9.

### Optional extras

```bash
pip install "obyflow-python[langchain]"   # LangChain callback instrumentation
pip install "obyflow-python[analysis]"    # scikit-learn/numpy-backed ML anomaly detection
```

## Quick start

```python
from obyflow import start
from obyflow.instrumentation.asgi import ObyflowASGIMiddleware

handle = start(service="checkout-api")
app.add_middleware(ObyflowASGIMiddleware, service="checkout-api", store=handle.store)
```

`start()` auto-instruments outbound HTTP, including automatic cross-service trace propagation (`x-obyflow-trace-id` / `x-obyflow-parent-span-id` headers), so traces stay linked across service boundaries with no manual header wiring.

Then, from the same project:

```bash
npx obyflow init
npx obyflow traces
npx obyflow investigate --since 15m
```

## What's included

- **Canonical event model** — `Event`, `EmbeddingAttributes`, `VectorOpAttributes`, `ChainAttributes`, `ToolCallAttributes`, `LlmCallAttributes`, with `validate_event`/`safe_validate_event`
- **ASGI middleware** (`ObyflowASGIMiddleware`) — automatic inbound request tracing for FastAPI/Starlette and other ASGI apps
- **Outbound HTTP instrumentation** (`instrument_outbound_http`) — wraps outbound calls (requests/httpx) with automatic trace-context propagation
- **LangChain instrumentation** (`ObyflowLangChainCallbackHandler` / `create_langchain_callback_handler`) — chain, tool, and LLM call events
- **Vector database instrumentation** — Pinecone, Qdrant, Weaviate, Chroma, pgvector, and Milvus, plus OpenAI/Anthropic/Cohere embedding calls
- **Statistical anomaly detection** (`compute_baseline_stats`, `classify_severity`) — mean/stddev and z-scored deviation baselining, mirroring the TypeScript core
- **ML-based anomaly detection** (`detect_ml_anomalies`, `[analysis]` extra) — scikit-learn-backed anomaly scoring over event duration/error-rate features, as a complement to the pure statistical baseline
- **Redaction** (`redaction.py`) — scrubs sensitive fields (passwords, tokens, credit cards, SSNs, API keys) before events are stored
- **Resource attributes** (`resource_attributes.py`) — every event is auto-tagged with hostname, PID, Python version, and the current git commit SHA (from CI env vars or a local `git rev-parse HEAD`), powering commit-based "what changed" correlation in the CLI with no extra setup
- **Trace context propagation** (`context.py`) — `get_active_trace_id`, `get_active_request_id`, `get_active_trace_context` for manual instrumentation

## Links

- [Full documentation and repository](https://github.com/AnupamKumar-1/obyflow)
- [`obyflow` CLI](https://www.npmjs.com/package/obyflow)
- [Node.js SDK](https://www.npmjs.com/package/@obyflow/node)
- [Report an issue](https://github.com/AnupamKumar-1/obyflow/issues)

## License

MIT © Anupam Kumar
