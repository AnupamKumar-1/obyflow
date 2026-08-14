import { InstrumentationContext, WeaviateClientLike } from "./types.js";
import { emitVectorOpEvent, timeAsync } from "./shared.js";

interface WeaviateQueryResult {
  data?: { Get?: Record<string, unknown[]> };
  objects?: unknown[];
}

export function instrumentWeaviateClient<T extends WeaviateClientLike>(
  client: T,
  ctx: InstrumentationContext,
): T {
  if (typeof client.query === "function") {
    const original = client.query.bind(client);
    client.query = async (params: any) => {
      const { result, latencyMs } = await timeAsync<WeaviateQueryResult>(() => original(params));
      const items = result?.data?.Get
        ? Object.values(result.data.Get).flat()
        : result?.objects ?? [];
      emitVectorOpEvent(ctx, "weaviate", {
        operation: "query",
        collection: params?.className ?? null,
        top_k: params?.limit ?? null,
        filter: params?.where ?? null,
        result_count: Array.isArray(items) ? items.length : null,
        similarity_scores: Array.isArray(items)
          ? items
              .map((item: any) => item?._additional?.certainty ?? item?._additional?.distance)
              .filter((score: any) => typeof score === "number")
          : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.upsert === "function") {
    const original = client.upsert.bind(client);
    client.upsert = async (params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(params));
      const objects = params?.objects ?? [];
      emitVectorOpEvent(ctx, "weaviate", {
        operation: "upsert",
        collection: params?.className ?? null,
        result_count: Array.isArray(objects) ? objects.length : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.delete === "function") {
    const original = client.delete.bind(client);
    client.delete = async (params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(params));
      emitVectorOpEvent(ctx, "weaviate", {
        operation: "delete",
        collection: params?.className ?? null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  return client;
}
