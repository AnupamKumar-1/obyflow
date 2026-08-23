import { describe, it, expect, vi } from "vitest";
import { SqliteStore } from "@obyflow/core";
import { instrumentPinecone, instrumentOpenAIEmbeddings } from "./vectordb.js";
import { runWithTraceContext } from "../context.js";

describe("node-sdk vectordb instrumentation", () => {
  it("joins a pinecone query event to the active trace id", async () => {
    const store = new SqliteStore(":memory:");
    const index = {
      query: vi.fn().mockResolvedValue({ matches: [{ score: 0.5 }] }),
    };

    const instrumented = instrumentPinecone(index, { service: "svc", store }, "docs");

    await runWithTraceContext({ traceId: "trace-xyz", requestId: "req-xyz" }, async () => {
      await instrumented.query({ topK: 1, vector: [1, 2] });
    });

    const rows = store.getByTraceId("trace-xyz");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("vector_op");
  });

  it("joins an openai embedding event to the active trace id", async () => {
    const store = new SqliteStore(":memory:");
    const client = {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 4 },
        }),
      },
    };

    const instrumented = instrumentOpenAIEmbeddings(client, { service: "svc", store });

    await runWithTraceContext({ traceId: "trace-abc", requestId: "req-abc" }, async () => {
      await instrumented.embeddings.create({ model: "text-embedding-3-small", input: "hi" });
    });

    const rows = store.getByTraceId("trace-abc");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("embedding");
  });

  it("records a telemetry failure and does not throw when persistence fails", async () => {
    const store = new SqliteStore(":memory:");
    vi.spyOn(store, "insert").mockImplementation(() => {
      throw new Error("disk full");
    });
    const index = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    };

    const instrumented = instrumentPinecone(index, { service: "svc", store }, "docs");

    await runWithTraceContext({ traceId: "trace-fail", requestId: "req-fail" }, async () => {
      await expect(instrumented.query({ topK: 1, vector: [1, 2] })).resolves.toBeDefined();
    });

    const failures = store.getTelemetryFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe("vectordb.insert");
    expect(failures[0].reason).toBe("disk full");
  });
});
