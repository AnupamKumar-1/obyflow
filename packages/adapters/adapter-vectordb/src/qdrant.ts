import { InstrumentationContext, QdrantClientLike } from "./types.js";
import { emitVectorOpEvent, timeAsync } from "./shared.js";

interface QdrantSearchResult {
  result?: Array<{ score?: number }>;
}

export function instrumentQdrantClient<T extends QdrantClientLike>(
  client: T,
  ctx: InstrumentationContext,
): T {
  if (typeof client.search === "function") {
    const original = client.search.bind(client);
    client.search = async (collectionName: string, params: any) => {
      const { result, latencyMs } = await timeAsync<QdrantSearchResult | Array<{ score?: number }>>(() => original(collectionName, params));
      const points = Array.isArray(result) ? result : result?.result ?? [];
      emitVectorOpEvent(ctx, "qdrant", {
        operation: "query",
        collection: collectionName ?? null,
        top_k: params?.limit ?? null,
        filter: params?.filter ?? null,
        result_count: Array.isArray(points) ? points.length : null,
        similarity_scores: Array.isArray(points)
          ? points.map((point: any) => point?.score).filter((score: any) => typeof score === "number")
          : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.upsert === "function") {
    const original = client.upsert.bind(client);
    client.upsert = async (collectionName: string, params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(collectionName, params));
      const points = params?.points ?? [];
      emitVectorOpEvent(ctx, "qdrant", {
        operation: "upsert",
        collection: collectionName ?? null,
        result_count: Array.isArray(points) ? points.length : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.delete === "function") {
    const original = client.delete.bind(client);
    client.delete = async (collectionName: string, params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(collectionName, params));
      emitVectorOpEvent(ctx, "qdrant", {
        operation: "delete",
        collection: collectionName ?? null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  return client;
}
