# @obyflow/core

Shared event model, local storage, evidence graph, anomaly detection, and correlation engine that power [Obyflow](https://github.com/Obyflow/obyflow) — an AI-native, CLI-first observability platform for tracing, debugging, and understanding modern applications.

This package is the foundation consumed internally by the [`obyflow`](https://www.npmjs.com/package/obyflow) CLI and the [`@obyflow/node`](https://www.npmjs.com/package/@obyflow/node) SDK. Install it directly only if you're building custom tooling on top of Obyflow's event/storage model.

## Install

```bash
npm install @obyflow/core
```

Requires Node.js ≥ 22.

## What's included

- **Event model** — `EventSchema`, `Event`, `validateEvent`/`safeValidateEvent` for the 10 typed event kinds (`trace`, `log`, `metric`, `error`, `embedding`, `vector_op`, `chain`, `tool_call`, `llm_call`, `custom`)
- **Storage** — `SqliteStore`, a local SQLite-backed event store with no external backend required
- **Trace correlation** — `correlateTrace`, `buildSpanTree`, and join-key helpers for stitching events into a single trace
- **Anomaly detection** — `computeBaselineStats`, `computeRollingBaseline`, `detectAnomalies` and friends (mean/stddev and median/MAD baselining, z-scored deviations)
- **Evidence graph & diagnosis engines** — chain/tool-call diagnosis for LangChain/LangGraph/LlamaIndex failures, and vector-DB retrieval diagnosis
- **"What changed" correlation** — correlates incidents against deployments, git commits, config, feature flags, and dependency changes
- **Confidence scoring**, **incident memory**, and **telemetry health checks**
- **Redaction** — configurable field-level and pattern-based redaction (passwords, tokens, credit cards, SSNs, API keys)
- **Config store** — reads/writes `obyflow.config.json`, project detection

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [`obyflow` CLI](https://www.npmjs.com/package/obyflow)
- [Node.js SDK](https://www.npmjs.com/package/@obyflow/node)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)

## License

MIT © Anupam Kumar
