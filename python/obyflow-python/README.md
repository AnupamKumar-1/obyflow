# obyflow-python

Python instrumentation SDK for [Obyflow](https://github.com/Obyflow/obyflow) — an AI-native, CLI-first observability platform for tracing, debugging, and understanding modern applications (LLM calls, vector-store queries, LangChain steps, and plain HTTP included).

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

For synchronous WSGI apps (Flask, Django sync views), use `ObyflowWSGIMiddleware` instead:

```python
from obyflow import start
from obyflow.instrumentation.wsgi import ObyflowWSGIMiddleware

handle = start(service="checkout-api")
app.wsgi_app = ObyflowWSGIMiddleware(app.wsgi_app, service="checkout-api", store=handle.store)
```

Unlike the Node SDK, which auto-instruments any `http`-based server via a runtime patch installed by `start()`, Python's inbound HTTP tracing requires this explicit middleware registration by design (Node's global `http.Server.prototype.emit` patch has no equivalent that's safe across Python's various sync/async server models).

`start()` auto-instruments outbound HTTP, including automatic cross-service trace propagation (`x-obyflow-trace-id` / `x-obyflow-parent-span-id` headers), so traces stay linked across service boundaries with no manual header wiring.

`handle.instrument` is pre-bound to `service`/`store`/`deployment_id`/`resource_attributes`, so vector-store and LangChain instrumentation don't need those threaded through every call site:

```python
handle.instrument.pinecone(index)
handle.instrument.langchain()
```

For manual trace-context propagation, use `with_trace_context` as a scoped context manager instead of the lower-level `set_trace_context`/`reset_trace_context` pair:

```python
from obyflow import TraceContext, with_trace_context

with with_trace_context(TraceContext(trace_id="trace_123", request_id="req_123")):
    ...
```

Then, from the same project:

```bash
npx obyflow init
npx obyflow traces
npx obyflow investigate --since 15m
```

## What's included

- **Canonical event model** — `Event`, `EmbeddingAttributes`, `VectorOpAttributes`, `ChainAttributes`, `ToolCallAttributes`, `LlmCallAttributes`, with `validate_event`/`safe_validate_event`
- **ASGI middleware** (`ObyflowASGIMiddleware`) — automatic inbound request tracing for FastAPI/Starlette and other ASGI apps
- **WSGI middleware** (`ObyflowWSGIMiddleware`) — automatic inbound request tracing for Flask and Django (sync) apps
- **Outbound HTTP instrumentation** (`instrument_outbound_http`) — wraps outbound calls (requests/httpx) with automatic trace-context propagation
- **LangChain instrumentation** (`ObyflowLangChainCallbackHandler` / `create_langchain_callback_handler`) — chain, tool, and LLM call events
- **Vector database instrumentation** — Pinecone, Qdrant, Weaviate, Chroma, pgvector, and Milvus, plus OpenAI/Anthropic/Cohere embedding calls
- **Statistical anomaly detection** (`compute_baseline_stats`, `classify_severity`) — plain mean/stddev z-scored deviation baselining; a separate, Python-only convenience toolkit, not a port of the TypeScript core's rolling/robust baseline engine (see "Anomaly detection: Node vs Python" below)
- **ML-based anomaly detection** (`detect_ml_anomalies`, `[analysis]` extra) — scikit-learn-backed anomaly scoring over event duration/error-rate features; Python-exclusive, with no TypeScript/core equivalent

## Anomaly detection: Node vs Python

| Capability | Node/CLI (`packages/core`) | Python (`obyflow.analysis`) |
|---|---|---|
| Mean/stddev baselining | Yes | Yes |
| Median/MAD ("robust") baselining | Yes | No |
| Rolling time-windowed buckets | Yes | No |
| Deployment-aware bucketing | Yes | No |
| Configurable z-score threshold | Yes | No (fixed thresholds in `classify_severity`) |
| ML-based detection (IsolationForest) | No | Yes (`detect_ml_anomalies`, `[analysis]` extra) |

`obyflow.analysis.stats`/`obyflow.analysis.anomaly` are a separate, Python-only convenience toolkit rather than a port of the CLI's `packages/core/src/anomaly/baseline.ts` engine. A Python caller of `compute_baseline_stats` should not expect the same rigor (robust/rolling/deployment-aware baselining) the CLI's `investigate`/`ask`/`incident` commands get from core.
- **Redaction** (`redaction.py`) — scrubs sensitive fields (passwords, tokens, credit cards, SSNs, API keys) before events are stored
- **Resource attributes** (`resource_attributes.py`) — every event is auto-tagged with hostname, PID, Python version, and the current git commit SHA (from CI env vars or a local `git rev-parse HEAD`), powering commit-based "what changed" correlation in the CLI with no extra setup
- **Trace context propagation** (`context.py`) — `get_active_trace_id`, `get_active_request_id`, `get_active_span_id`, `get_active_parent_span_id`, `get_active_trace_context`, and the scoped `with_trace_context` context manager for manual instrumentation

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [`obyflow` CLI](https://www.npmjs.com/package/obyflow)
- [Node.js SDK](https://www.npmjs.com/package/@obyflow/node)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)

## License

MIT © Anupam Kumar
