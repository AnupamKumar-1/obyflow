import { describe, it, expect, vi } from "vitest";
import { instrumentPineconeIndex } from "./pinecone.js";
import type { InstrumentationContext } from "./types.js";

describe("instrumentPineconeIndex", () => {
  it("emits a vector_op event on query", async () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = { service: "svc", emit };

    const index = {
      query: vi.fn().mockResolvedValue({ matches: [{ score: 0.9 }, { score: 0.5 }] }),
    };

    const instrumented = instrumentPineconeIndex(index, ctx, "docs");
    const result = await instrumented.query({ topK: 2, vector: [1, 2, 3] });

    expect(result.matches).toHaveLength(2);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vector_op",
        attributes: expect.objectContaining({
          operation: "query",
          db_provider: "pinecone",
          collection: "docs",
          top_k: 2,
          result_count: 2,
          similarity_scores: [0.9, 0.5],
        }),
      }),
    );
  });

  it("emits a vector_op event on upsert", async () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = { service: "svc", emit };

    const index = {
      upsert: vi.fn().mockResolvedValue({ upsertedCount: 2 }),
    };

    const instrumented = instrumentPineconeIndex(index, ctx);
    await instrumented.upsert([{ id: "a" }, { id: "b" }]);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          operation: "upsert",
          db_provider: "pinecone",
          result_count: 2,
        }),
      }),
    );
  });
});
