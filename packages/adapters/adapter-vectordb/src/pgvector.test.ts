import { describe, it, expect, vi } from "vitest";
import { instrumentPgVectorClient } from "./pgvector.js";
import type { InstrumentationContext } from "./types.js";

describe("instrumentPgVectorClient", () => {
  it("emits a vector_op event for a pgvector similarity query", async () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = { service: "svc", emit };

    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 1, distance: 0.1 }, { id: 2, distance: 0.2 }],
      }),
    };

    const instrumented = instrumentPgVectorClient(client, ctx);
    await instrumented.query("SELECT id, embedding <-> $1 AS distance FROM documents ORDER BY distance LIMIT 5", [[1, 2, 3]]);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vector_op",
        attributes: expect.objectContaining({
          operation: "query",
          db_provider: "pgvector",
          collection: "documents",
          result_count: 2,
          similarity_scores: [0.1, 0.2],
        }),
      }),
    );
  });

  it("does not emit for non-vector queries", async () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = { service: "svc", emit };

    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const instrumented = instrumentPgVectorClient(client, ctx);
    await instrumented.query("SELECT * FROM users WHERE id = $1", [1]);

    expect(emit).not.toHaveBeenCalled();
  });
});
