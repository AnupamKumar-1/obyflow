import { EmbeddingDetails, EmbeddingProvider, InstrumentationContext, VectorDbProvider, VectorOpDetails } from "./types.js";

export function emitVectorOpEvent(
  ctx: InstrumentationContext,
  provider: VectorDbProvider,
  details: VectorOpDetails,
): void {
  ctx.emit({
    type: "vector_op",
    trace_id: ctx.getTraceId ? ctx.getTraceId() : null,
    request_id: ctx.getRequestId ? ctx.getRequestId() : null,
    service: ctx.service,
    host: null,
    container: null,
    deployment_id: ctx.deploymentId ?? null,
    duration_ms: details.latency_ms ?? null,
    severity: null,
    attributes: {
      operation: details.operation,
      db_provider: provider,
      collection: details.collection ?? null,
      top_k: details.top_k ?? null,
      filter: details.filter ?? null,
      result_count: details.result_count ?? null,
      similarity_scores: details.similarity_scores ?? null,
      latency_ms: details.latency_ms ?? null,
    },
  });
}

export function emitEmbeddingEvent(
  ctx: InstrumentationContext,
  provider: EmbeddingProvider,
  details: EmbeddingDetails,
): void {
  ctx.emit({
    type: "embedding",
    trace_id: ctx.getTraceId ? ctx.getTraceId() : null,
    request_id: ctx.getRequestId ? ctx.getRequestId() : null,
    service: ctx.service,
    host: null,
    container: null,
    deployment_id: ctx.deploymentId ?? null,
    duration_ms: details.latency_ms ?? null,
    severity: null,
    attributes: {
      model: details.model,
      input_tokens: details.input_tokens ?? null,
      dimensions: details.dimensions ?? null,
      provider,
      latency_ms: details.latency_ms ?? null,
      batch_size: details.batch_size ?? null,
    },
  });
}

export async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const startedAt = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - startedAt };
}

export function extractNumericField(rows: Array<Record<string, unknown>>, keys: string[]): number[] | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const firstRow = rows[0];
  const matchedKey = Object.keys(firstRow).find((key) => keys.includes(key.toLowerCase()));
  if (!matchedKey) return null;
  const values = rows
    .map((row) => row[matchedKey])
    .filter((value): value is number => typeof value === "number");
  return values.length > 0 ? values : null;
}
