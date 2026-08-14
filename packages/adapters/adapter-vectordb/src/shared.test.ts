import { describe, it, expect, vi } from "vitest";
import { emitVectorOpEvent, emitEmbeddingEvent, extractNumericField } from "./shared.js";
import type { InstrumentationContext } from "./types.js";

describe("emitVectorOpEvent", () => {
  it("builds a vector_op event with the provided details", () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = {
      service: "search-service",
      deploymentId: "dep-1",
      emit,
      getTraceId: () => "trace-1",
      getRequestId: () => "req-1",
    };

    emitVectorOpEvent(ctx, "pinecone", {
      operation: "query",
      collection: "docs",
      top_k: 5,
      result_count: 3,
      similarity_scores: [0.9, 0.8, 0.7],
      latency_ms: 42,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vector_op",
        trace_id: "trace-1",
        request_id: "req-1",
        service: "search-service",
        deployment_id: "dep-1",
        duration_ms: 42,
        attributes: expect.objectContaining({
          operation: "query",
          db_provider: "pinecone",
          collection: "docs",
          top_k: 5,
          result_count: 3,
          similarity_scores: [0.9, 0.8, 0.7],
        }),
      }),
    );
  });
});

describe("emitEmbeddingEvent", () => {
  it("builds an embedding event with the provided details", () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = {
      service: "search-service",
      emit,
    };

    emitEmbeddingEvent(ctx, "openai", {
      model: "text-embedding-3-small",
      input_tokens: 12,
      dimensions: 1536,
      latency_ms: 88,
      batch_size: 1,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "embedding",
        service: "search-service",
        trace_id: null,
        request_id: null,
        attributes: expect.objectContaining({
          model: "text-embedding-3-small",
          provider: "openai",
          dimensions: 1536,
        }),
      }),
    );
  });
});

describe("extractNumericField", () => {
  it("returns matching numeric values from rows", () => {
    const rows = [{ id: 1, distance: 0.12 }, { id: 2, distance: 0.31 }];
    expect(extractNumericField(rows, ["distance"])).toEqual([0.12, 0.31]);
  });

  it("returns null when no rows match", () => {
    expect(extractNumericField([], ["distance"])).toBeNull();
  });
});
