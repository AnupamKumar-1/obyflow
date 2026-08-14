import { describe, it, expect } from "vitest";
import { diagnoseRetrievalLayer } from "./retrieval-diagnosis.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "vector_op",
    trace_id: overrides.trace_id ?? "t1",
    request_id: overrides.request_id ?? null,
    service: overrides.service ?? "search-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    severity: overrides.severity ?? null,
  };
}

describe("diagnoseRetrievalLayer", () => {
  it("reports no signals when there are no vector or embedding events", () => {
    const result = diagnoseRetrievalLayer({ vector_ops: [], embeddings: [] });
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
    expect(result.summary).toBeNull();
  });

  it("detects an empty result set", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: { operation: "query", db_provider: "pgvector", result_count: 0 },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [event], embeddings: [] });
    expect(result.detected).toBe(true);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].type).toBe("empty_results");
    expect(result.signals[0].reason).toBe("vector query returned zero results");
  });

  it("detects low similarity scores below the default threshold", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: {
        operation: "query",
        db_provider: "pinecone",
        similarity_scores: [0.12, 0.2, 0.31],
      },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [event], embeddings: [] });
    expect(result.detected).toBe(true);
    expect(result.signals[0].type).toBe("low_similarity");
    expect(result.signals[0].detail["top_similarity"]).toBeCloseTo(0.31);
  });

  it("does not flag similarity scores above threshold", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: {
        operation: "query",
        db_provider: "pinecone",
        similarity_scores: [0.81, 0.9],
      },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [event], embeddings: [] });
    expect(result.detected).toBe(false);
  });

  it("detects a slow vector query above the configured threshold", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: { operation: "query", db_provider: "qdrant", latency_ms: 1200 },
    });
    const result = diagnoseRetrievalLayer(
      { vector_ops: [event], embeddings: [] },
      { slowVectorQueryMs: 500 },
    );
    expect(result.signals[0].type).toBe("slow_vector_query");
  });

  it("ignores non-query vector operations for latency and similarity checks", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: {
        operation: "upsert",
        db_provider: "chroma",
        latency_ms: 5000,
        similarity_scores: [0.01],
      },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [event], embeddings: [] });
    expect(result.detected).toBe(false);
  });

  it("detects high embedding latency", () => {
    const event = makeEvent({
      type: "embedding",
      attributes: { model: "text-embedding-3-small", provider: "openai", latency_ms: 2500 },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [], embeddings: [event] });
    expect(result.detected).toBe(true);
    expect(result.signals[0].type).toBe("embedding_latency");
  });

  it("respects a custom embedding latency threshold", () => {
    const event = makeEvent({
      type: "embedding",
      attributes: { model: "text-embedding-3-small", provider: "openai", latency_ms: 200 },
    });
    const result = diagnoseRetrievalLayer(
      { vector_ops: [], embeddings: [event] },
      { embeddingLatencyMs: 100 },
    );
    expect(result.detected).toBe(true);
  });

  it("produces a summary describing multiple distinct signal types", () => {
    const vectorEvent = makeEvent({
      type: "vector_op",
      attributes: { operation: "query", db_provider: "milvus", result_count: 0 },
    });
    const embeddingEvent = makeEvent({
      type: "embedding",
      attributes: { model: "embed-v3", provider: "cohere", latency_ms: 3000 },
    });
    const result = diagnoseRetrievalLayer({
      vector_ops: [vectorEvent],
      embeddings: [embeddingEvent],
    });
    expect(result.summary).toContain("empty result sets");
    expect(result.summary).toContain("high embedding latency");
  });

  it("ignores malformed similarity_scores and latency attributes", () => {
    const event = makeEvent({
      type: "vector_op",
      attributes: {
        operation: "query",
        db_provider: "weaviate",
        similarity_scores: ["not-a-number"],
        latency_ms: "slow",
      },
    });
    const result = diagnoseRetrievalLayer({ vector_ops: [event], embeddings: [] });
    expect(result.detected).toBe(false);
  });
});
