import { describe, it, expect, vi } from "vitest";
import { instrumentOpenAIEmbeddingsClient } from "./openai.js";
import type { InstrumentationContext } from "../types.js";

describe("instrumentOpenAIEmbeddingsClient", () => {
  it("emits an embedding event with token and dimension counts", async () => {
    const emit = vi.fn();
    const ctx: InstrumentationContext = { service: "svc", emit };

    const client = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0) }],
          usage: { prompt_tokens: 8, total_tokens: 8 },
        }),
      },
    };

    const instrumented = instrumentOpenAIEmbeddingsClient(client, ctx);
    await instrumented.embeddings.create({ model: "text-embedding-3-small", input: "hello" });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "embedding",
        attributes: expect.objectContaining({
          model: "text-embedding-3-small",
          provider: "openai",
          input_tokens: 8,
          dimensions: 1536,
          batch_size: 1,
        }),
      }),
    );
  });
});
