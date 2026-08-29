# obyflow

**AI-native, CLI-first observability for tracing, debugging, and understanding modern applications** — LLM calls, vector-store queries, and framework (LangChain) steps included.

Obyflow captures structured events locally (SQLite, no external backend required), correlates them into traces, and uses an LLM of your choice to turn raw evidence into a plain-English investigation of what went wrong.

```bash
npx obyflow init                                # detect the project, write obyflow.config.json
npx obyflow start                                # initialize local SQLite storage
npx obyflow config llm --provider anthropic      # pick an LLM provider for investigations
npx obyflow investigate --since 1h               # AI-assisted root-cause investigation
npx obyflow ask "why did checkout fail today?"
```

## Install

```bash
npm install -g obyflow
# or just use npx, no install needed:
npx obyflow --help
```

Requires Node.js ≥ 22.

## What it does

- **Structured event model** — 10 typed event kinds (`trace`, `log`, `metric`, `error`, `embedding`, `vector_op`, `chain`, `tool_call`, `llm_call`, `custom`)
- **Trace correlation** — joins events by trace/span/request id into a single correlated trace across services
- **Anomaly detection** — statistical baselining (mean/stddev and median/MAD) with z-scored deviations
- **Evidence graph & diagnosis engines** — purpose-built diagnosis for LangChain/LangGraph/LlamaIndex chain failures and vector-DB retrieval issues
- **"What changed" correlation** — correlates incidents against deployments, git commits, config changes, feature flags, and dependency changes
- **Confidence scoring** — HIGH/MEDIUM/LOW investigation confidence based on evidence volume and correlation strength
- **Incident memory** — fingerprints incidents and surfaces similar past incidents, learning from recorded resolutions
- **Telemetry health checks** — detects dropped events and coverage gaps in your instrumentation
- **AI-assisted investigation** — evidence-backed root-cause summaries with grounding validation (flags LLM citations that don't match real evidence) and token-budget-aware context trimming
- **Token usage & cost tracking** — per-service token consumption and estimated USD cost, built-in pricing tables for Claude/GPT/Gemini
- **Resilient LLM calls** — automatic retry with exponential backoff on rate limits and transient failures
- **Redaction** — configurable field-level and pattern-based redaction (passwords, tokens, credit cards, SSNs, API keys) applied at ingestion or evidence time
- **Pluggable LLM providers** — Anthropic, OpenAI, Gemini, Ollama, or `none` (evidence-only mode, no LLM key required)
- **Data export** — JSON, CSV, or OpenTelemetry OTLP
- **Live-updating views** — `--watch` to poll and re-render traces/logs/metrics/errors as new events arrive

## Commands

```bash
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
```

The read commands (`traces`, `logs`, `metrics`, `errors`, `usage`, `export`) accept `--db <path>`, `--service <name>`, and `--since <window>` (e.g. `15m`, `2h`, `1d`); `traces`/`logs`/`metrics`/`errors` also support `--detail` and `--watch [seconds]`. Run `npx obyflow <command> --help` for the full flag list on any command.

## Instrumenting your app

This CLI reads events written by the Obyflow SDKs. Instrument your app with:

- **Node.js**: [`@obyflow/node`](https://www.npmjs.com/package/@obyflow/node)
- **Python**: [`obyflow-python`](https://pypi.org/project/obyflow-python/)

```ts
import { start } from "@obyflow/node";
const obyflow = start({ service: "checkout-api" });
```

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)
- [Contributing guide](https://github.com/Obyflow/obyflow/blob/main/CONTRIBUTING.md)

## License

MIT © Anupam Kumar
