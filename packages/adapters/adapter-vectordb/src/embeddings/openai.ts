import { InstrumentationContext } from "../types.js";
import { emitEmbeddingEvent, timeAsync } from "../shared.js";

interface OpenAIEmbeddingResult {
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
  data?: Array<{ embedding?: number[] }>;
}

export function instrumentOpenAIEmbeddingsClient<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, ctx: InstrumentationContext): T {
  const original = client.embeddings.create.bind(client.embeddings) as (...args: any[]) => Promise<any>;
  client.embeddings.create = async (params: any) => {
    const { result, latencyMs } = await timeAsync<OpenAIEmbeddingResult>(() => original(params));
    const inputTokens = result?.usage?.prompt_tokens ?? result?.usage?.total_tokens ?? null;
    const firstEmbedding = result?.data?.[0]?.embedding;
    emitEmbeddingEvent(ctx, "openai", {
      model: params?.model ?? "unknown",
      input_tokens: inputTokens,
      dimensions: Array.isArray(firstEmbedding) ? firstEmbedding.length : null,
      latency_ms: latencyMs,
      batch_size: Array.isArray(params?.input) ? params.input.length : 1,
    });
    return result;
  };
  return client;
}
