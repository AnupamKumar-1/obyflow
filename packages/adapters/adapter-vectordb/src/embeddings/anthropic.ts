import { InstrumentationContext } from "../types.js";
import { emitEmbeddingEvent, timeAsync } from "../shared.js";

interface AnthropicEmbeddingResult {
  usage?: {
    input_tokens?: number;
  };
  embedding?: number[];
}

export function instrumentAnthropicEmbeddingsClient<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, ctx: InstrumentationContext): T {
  const original = client.embeddings.create.bind(client.embeddings) as (...args: any[]) => Promise<any>;
  client.embeddings.create = async (params: any) => {
    const { result, latencyMs } = await timeAsync<AnthropicEmbeddingResult>(() => original(params));
    const inputTokens = result?.usage?.input_tokens ?? null;
    const embedding = result?.embedding;
    emitEmbeddingEvent(ctx, "anthropic", {
      model: params?.model ?? "unknown",
      input_tokens: inputTokens,
      dimensions: Array.isArray(embedding) ? embedding.length : null,
      latency_ms: latencyMs,
      batch_size: Array.isArray(params?.input) ? params.input.length : 1,
    });
    return result;
  };
  return client;
}
