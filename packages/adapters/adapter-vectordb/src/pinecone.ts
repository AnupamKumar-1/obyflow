import { InstrumentationContext, PineconeIndexLike } from "./types.js";
import { emitVectorOpEvent, timeAsync } from "./shared.js";

interface PineconeQueryResult {
  matches?: Array<{ score?: number }>;
}

export function instrumentPineconeIndex<T extends PineconeIndexLike>(
  index: T,
  ctx: InstrumentationContext,
  collection: string | null = null,
): T {
  if (typeof index.query === "function") {
    const original = index.query.bind(index);
    index.query = async (request: any) => {
      const { result, latencyMs } = await timeAsync<PineconeQueryResult>(() => original(request));
      const matches = result?.matches ?? [];
      emitVectorOpEvent(ctx, "pinecone", {
        operation: "query",
        collection: collection ?? request?.namespace ?? null,
        top_k: request?.topK ?? null,
        filter: request?.filter ?? null,
        result_count: Array.isArray(matches) ? matches.length : null,
        similarity_scores: Array.isArray(matches)
          ? matches.map((match: any) => match?.score).filter((score: any) => typeof score === "number")
          : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof index.upsert === "function") {
    const original = index.upsert.bind(index);
    index.upsert = async (request: any) => {
      const { result, latencyMs } = await timeAsync(() => original(request));
      const vectors = Array.isArray(request) ? request : request?.vectors;
      emitVectorOpEvent(ctx, "pinecone", {
        operation: "upsert",
        collection: collection ?? null,
        result_count: Array.isArray(vectors) ? vectors.length : null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  if (typeof index.deleteMany === "function") {
    const original = index.deleteMany.bind(index);
    index.deleteMany = async (request: any) => {
      const { result, latencyMs } = await timeAsync(() => original(request));
      emitVectorOpEvent(ctx, "pinecone", {
        operation: "delete",
        collection: collection ?? null,
        latency_ms: latencyMs,
      });
      return result;
    };
  }

  return index;
}
