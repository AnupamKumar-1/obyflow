import { InstrumentationContext } from "../types.js";
import { emitEmbeddingEvent, timeAsync } from "../shared.js";

interface CohereEmbeddingResult {
  embeddings?: number[][];
  body?: {
    embeddings?: number[][];
  };
}

export function instrumentCohereEmbeddingsClient<T extends { embed: (...args: any[]) => any }>(
  client: T,
  ctx: InstrumentationContext,
): T {
  const original = client.embed.bind(client) as (...args: any[]) => Promise<any>;
  (client as any).embed = async (params: any) => {
    const { result, latencyMs } = await timeAsync<CohereEmbeddingResult>(() => original(params));
    const embeddings = result?.embeddings ?? result?.body?.embeddings ?? [];
    const firstEmbedding = Array.isArray(embeddings) ? embeddings[0] : null;
    emitEmbeddingEvent(ctx, "cohere", {
      model: params?.model ?? "unknown",
      dimensions: Array.isArray(firstEmbedding) ? firstEmbedding.length : null,
      latency_ms: latencyMs,
      batch_size: Array.isArray(params?.texts) ? params.texts.length : 1,
    });
    return result;
  };
  return client;
}
