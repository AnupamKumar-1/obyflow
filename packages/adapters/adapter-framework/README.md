# @obyflow/adapter-framework

LangChain callback handler adapter for [Obyflow](https://github.com/Obyflow/obyflow), turning LangChain chain/tool/LLM run callbacks into Obyflow `chain`, `tool_call`, and `llm_call` events.

This package is consumed internally by [`@obyflow/node`](https://www.npmjs.com/package/@obyflow/node)'s `instrument.langchain()` helper. Install it directly only if you're wiring LangChain instrumentation into a custom setup outside the Node SDK.

## Install

```bash
npm install @obyflow/adapter-framework
```

Requires Node.js ≥ 22. Has no dependency on `langchain` itself — it works structurally against any compatible callback-handler version.

## Usage

```ts
import { createLangChainCallbackHandler } from "@obyflow/adapter-framework";

const handler = createLangChainCallbackHandler({
  service: "checkout-api",
  emit: (event) => store.append(event),
});
```

## Links

- [Full documentation and repository](https://github.com/Obyflow/obyflow)
- [Node.js SDK](https://www.npmjs.com/package/@obyflow/node)
- [Report an issue](https://github.com/Obyflow/obyflow/issues)

## License

MIT © Anupam Kumar
