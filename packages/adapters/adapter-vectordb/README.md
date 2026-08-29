# @obyflow/adapter-vectordb

Vector-database and embedding instrumentation adapters for [Obyflow](https://github.com/Obyflow/obyflow) — wraps client calls to Pinecone, Qdrant, Weaviate, Chroma, pgvector, and Milvus, plus OpenAI/Anthropic/Cohere embedding calls, and emits `vector_op`/`embedding` events.

This package is consumed internally by [`@obyflow/node`](https://www.npmjs.com/package/@obyflow/node)'s `instrument.pinecone()`/`.qdrant()`/`.weaviate()`/`.chroma()`/`.pgvector()`/`.milvus()` helpers. Install it directly only if you're wiring vector-DB instrumentation into a custom setup outside the Node SDK.

## Install

```bash
npm install @obyflow/adapter-vectordb
```

Requires Node.js ≥ 22.

## Usage

```ts
import { instrumentPineconeIndex } from "@obyflow/adapter-vectordb";

const instrumentedIndex = instrumentPineconeIndex(index, {
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
