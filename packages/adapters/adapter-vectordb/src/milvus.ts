import { InstrumentationContext, MilvusClientLike } from "./types.js";
import { emitVectorOpEvent, timeAsync } from "./shared.js";

interface MilvusSearchResult {
  results?: Array<{ score?: number }>;
}

export function instrumentMilvusClient<T extends MilvusClientLike>(
  client: T,
  ctx: InstrumentationContext,
): T {
  if (typeof client.search === "function") {
    const original = client.search.bind(client);
    client.search = async (params: any) => {
      const { result, latencyMs } = await timeAsync<MilvusSearchResult>(() => original(params));
      const hits = result?.results ?? [];
      emitVectorOpEvent(ctx, "milvus", {
        operation: "query",
        collection: params?.collection_name ?? null,
        top_k: params?.limit ?? params?.topk ?? null,
        filter: params?.filter ?? null,
        result_count: Array.isArray(hits) ? hits.length : null,
        similarity_scores: Array.isArray(hits)
          ? hits.map((hit: any) => hit?.score).filter((score: any) => typeof score === "number")
          : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.insert === "function") {
    const original = client.insert.bind(client);
    client.insert = async (params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(params));
      const rows = params?.fields_data ?? params?.data ?? [];
      emitVectorOpEvent(ctx, "milvus", {
        operation: "upsert",
        collection: params?.collection_name ?? null,
        result_count: Array.isArray(rows) ? rows.length : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof client.delete === "function") {
    const original = client.delete.bind(client);
    client.delete = async (params: any) => {
      const { result, latencyMs } = await timeAsync(() => original(params));
      emitVectorOpEvent(ctx, "milvus", {
        operation: "delete",
        collection: params?.collection_name ?? null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  return client;
}
