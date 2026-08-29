# @obyflow/llm-core

Shared `LLMAdapter` interface and provider-agnostic helpers for [Obyflow](https://github.com/Obyflow/obyflow)'s AI-assisted investigation features — implemented by [`@obyflow/llm-anthropic`](https://www.npmjs.com/package/@obyflow/llm-anthropic), [`@obyflow/llm-openai`](https://www.npmjs.com/package/@obyflow/llm-openai), [`@obyflow/llm-gemini`](https://www.npmjs.com/package/@obyflow/llm-gemini), and [`@obyflow/llm-ollama`](https://www.npmjs.com/package/@obyflow/llm-ollama), and consumed internally by the [`obyflow`](https://www.npmjs.com/package/obyflow) CLI's `investigate`/`ask` commands.

Install it directly only if you're implementing a custom `LLMAdapter` for a provider Obyflow doesn't ship.

## Install

```bash
npm install @obyflow/llm-core
```

Requires Node.js ≥ 22.

## What's included

- **`LLMAdapter` interface** — the contract every provider adapter implements
- **Token usage & cost tracking** — `estimateTokenCount`, `getContextLimit`, `estimateCostUsd` with built-in pricing tables (Claude, GPT-4o/5, Gemini)
- **Resilient calls** — `withRetry`/`isRetryableLLMError`, automatic retry with exponential backoff on 429/503/network errors
- **Grounding validation** — `validateEvidenceGrounding`, flags LLM citations that don't match real evidence
- **Context trimming** — `trimEvidenceForContext`, token-budget-aware evidence trimming

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [`obyflow` CLI](https://www.npmjs.com/package/obyflow)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)

## License

MIT © Anupam Kumar
