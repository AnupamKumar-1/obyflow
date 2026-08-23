import { describe, it, expect, vi } from "vitest";
import { SqliteStore, rowToEvent } from "@obyflow/core";
import { instrumentLangChain } from "./langchain.js";
import { runWithTraceContext } from "../context.js";

describe("node-sdk langchain instrumentation", () => {
  it("joins a chain event to the active trace id", async () => {
    const store = new SqliteStore(":memory:");
    const handler = instrumentLangChain({ service: "rag-svc", store });

    await runWithTraceContext({ traceId: "trace-lc-1", requestId: "req-lc-1" }, async () => {
      await handler.handleChainStart({ name: "RetrievalQAChain" }, { question: "hi" }, "run-1");
      await handler.handleChainEnd({ answer: "hello" }, "run-1");
    });

    const rows = store.getByTraceId("trace-lc-1").map(rowToEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("chain");
    expect(rows[0].attributes.chain_name).toBe("RetrievalQAChain");
    expect(rows[0].request_id).toBe("req-lc-1");
  });

  it("joins a tool_call event to the active trace id and records failure status", async () => {
    const store = new SqliteStore(":memory:");
    const handler = instrumentLangChain({ service: "rag-svc", store });

    await runWithTraceContext({ traceId: "trace-lc-2", requestId: "req-lc-2" }, async () => {
      await handler.handleToolStart({ name: "search_orders" }, "{}", "tool-run-1");
      await handler.handleToolError(new Error("timeout"), "tool-run-1");
    });

    const rows = store.getByTraceId("trace-lc-2").map(rowToEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("tool_call");
    expect(rows[0].attributes.status).toBe("error");
    expect(rows[0].severity).toBe("error");
  });

  it("joins an llm_call event to the active trace id", async () => {
    const store = new SqliteStore(":memory:");
    const handler = instrumentLangChain({ service: "rag-svc", store });

    await runWithTraceContext({ traceId: "trace-lc-3", requestId: "req-lc-3" }, async () => {
      await handler.handleLLMStart({ id: ["openai", "OpenAI"] }, ["hi"], "llm-run-1", undefined, {
        invocation_params: { model: "gpt-4o-mini" },
      });
      await handler.handleLLMEnd({ generations: [[{}]] }, "llm-run-1");
    });

    const rows = store.getByTraceId("trace-lc-3").map(rowToEvent);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("llm_call");
    expect(rows[0].attributes.model).toBe("gpt-4o-mini");
  });

  it("does not join events emitted outside any active trace context", async () => {
    const store = new SqliteStore(":memory:");
    const handler = instrumentLangChain({ service: "rag-svc", store });

    await handler.handleChainStart({ name: "StandaloneChain" }, {}, "run-untraced");
    await handler.handleChainEnd({}, "run-untraced");

    const rows = store.getByTraceId("trace-lc-does-not-exist");
    expect(rows).toHaveLength(0);
  });

  it("records a telemetry failure and does not throw when persistence fails", async () => {
    const store = new SqliteStore(":memory:");
    vi.spyOn(store, "insert").mockImplementation(() => {
      throw new Error("db locked");
    });
    const handler = instrumentLangChain({ service: "rag-svc", store });

    await runWithTraceContext({ traceId: "trace-lc-fail", requestId: "req-lc-fail" }, async () => {
      await handler.handleChainStart({ name: "RetrievalQAChain" }, { question: "hi" }, "run-fail");
      await handler.handleChainEnd({ answer: "hello" }, "run-fail");
    });

    const failures = store.getTelemetryFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe("langchain.insert");
    expect(failures[0].reason).toBe("db locked");
  });
});
