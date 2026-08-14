import { describe, it, expect, vi } from "vitest";
import { createLangChainCallbackHandler } from "./langchain.js";
import type { InstrumentationContext } from "./types.js";

function makeCtx(emit = vi.fn()): { ctx: InstrumentationContext; emit: ReturnType<typeof vi.fn> } {
  return {
    emit,
    ctx: {
      service: "rag-service",
      deploymentId: "dep-1",
      emit,
      getTraceId: () => "trace-1",
      getRequestId: () => "req-1",
    },
  };
}

describe("createLangChainCallbackHandler — chain lifecycle", () => {
  it("emits a chain event on success with duration and run linkage", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleChainStart({ id: ["langchain", "chains", "RetrievalQAChain"] }, { question: "hi" }, "run-1", undefined);
    await handler.handleChainEnd({ answer: "hello" }, "run-1", undefined);

    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("chain");
    expect(event.trace_id).toBe("trace-1");
    expect(event.attributes).toMatchObject({
      framework: "langchain",
      chain_name: "RetrievalQAChain",
      run_id: "run-1",
      parent_run_id: null,
      status: "success",
    });
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.severity).toBeNull();
  });

  it("emits a chain event with severity=error and the failure reason on handleChainError", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleChainStart({ name: "AgentExecutor" }, {}, "run-2", "run-parent");
    await handler.handleChainError(new Error("tool timed out"), "run-2", "run-parent");

    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("chain");
    expect(event.attributes.status).toBe("error");
    expect(event.attributes.output_preview).toContain("tool timed out");
    expect(event.attributes.parent_run_id).toBe("run-parent");
    expect(event.severity).toBe("error");
  });

  it("still emits a usable event when *End fires for an untracked run_id", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    // No handleChainStart was called for "orphan-run" (e.g. handler attached mid-run).
    await handler.handleChainEnd({ ok: true }, "orphan-run", undefined);

    const event = emit.mock.calls[0][0];
    expect(event.attributes.run_id).toBe("orphan-run");
    expect(event.attributes.chain_name).toBeNull();
    expect(event.duration_ms).toBeNull();
  });
});

describe("createLangChainCallbackHandler — tool calls", () => {
  it("emits a tool_call event with args/result previews on success", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleToolStart({ name: "search_orders" }, '{"orderId":"123"}', "tool-run-1", "chain-run-1");
    await handler.handleToolEnd("order not found", "tool-run-1", "chain-run-1");

    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("tool_call");
    expect(event.attributes).toMatchObject({
      tool_name: "search_orders",
      status: "success",
      parent_run_id: "chain-run-1",
    });
    expect(event.attributes.result_preview).toBe("order not found");
  });

  it("emits a tool_call event with status=error on handleToolError", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleToolStart({ name: "search_orders" }, "{}", "tool-run-2");
    await handler.handleToolError(new Error("timed out after 30s"), "tool-run-2");

    const event = emit.mock.calls[0][0];
    expect(event.attributes.status).toBe("error");
    expect(event.attributes.result_preview).toContain("timed out after 30s");
    expect(event.severity).toBe("error");
  });
});

describe("createLangChainCallbackHandler — retriever runs", () => {
  it("maps a successful retriever run onto a chain event carrying result_count", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleRetrieverStart({ name: "VectorStoreRetriever" }, "why did checkout fail?", "ret-run-1", "chain-run-1");
    await handler.handleRetrieverEnd([{ pageContent: "doc a" }, { pageContent: "doc b" }], "ret-run-1", "chain-run-1");

    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("chain");
    expect(event.attributes.chain_name).toBe("retriever:VectorStoreRetriever");
    expect(event.attributes.output_preview).toContain('"result_count":2');
    expect(event.attributes.status).toBe("success");
  });

  it("maps a failed retriever run onto an error chain event", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleRetrieverStart({ name: "VectorStoreRetriever" }, "q", "ret-run-2");
    await handler.handleRetrieverError(new Error("index unreachable"), "ret-run-2");

    const event = emit.mock.calls[0][0];
    expect(event.attributes.status).toBe("error");
    expect(event.severity).toBe("error");
  });
});

describe("createLangChainCallbackHandler — LLM calls", () => {
  it("emits an llm_call event with model/provider/token usage from handleLLMStart + handleLLMEnd", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleLLMStart(
      { id: ["langchain", "llms", "openai", "OpenAI"] },
      ["Summarize this."],
      "llm-run-1",
      "chain-run-1",
      { invocation_params: { model: "gpt-4o-mini" } },
    );
    await handler.handleLLMEnd(
      {
        generations: [[{ generationInfo: { finish_reason: "stop" } }]],
        llmOutput: { tokenUsage: { promptTokens: 42, completionTokens: 8 } },
      },
      "llm-run-1",
      "chain-run-1",
    );

    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("llm_call");
    expect(event.attributes).toMatchObject({
      model: "gpt-4o-mini",
      provider: "openai",
      prompt_tokens: 42,
      completion_tokens: 8,
      stop_reason: "stop",
      status: "success",
    });
  });

  it("emits an llm_call event via handleChatModelStart for chat-style models", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleChatModelStart(
      { id: ["langchain", "chat_models", "anthropic", "ChatAnthropic"] },
      [[{ content: "hi" }]],
      "chat-run-1",
      undefined,
      { invocation_params: { model: "claude-sonnet-5" } },
    );
    await handler.handleLLMEnd({ generations: [[{}]], llmOutput: {} }, "chat-run-1", undefined);

    const event = emit.mock.calls[0][0];
    expect(event.attributes.model).toBe("claude-sonnet-5");
    expect(event.attributes.provider).toBe("anthropic");
  });

  it("emits an llm_call event with status=error on handleLLMError", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleLLMStart({ id: ["openai", "OpenAI"] }, ["x"], "llm-run-2", undefined, {
      invocation_params: { model: "gpt-4o-mini" },
    });
    await handler.handleLLMError(new Error("rate limited"), "llm-run-2");

    const event = emit.mock.calls[0][0];
    expect(event.attributes.status).toBe("error");
    expect(event.attributes.stop_reason).toContain("rate limited");
    expect(event.severity).toBe("error");
  });
});

describe("createLangChainCallbackHandler — nested step tree", () => {
  it("preserves run_id/parent_run_id linkage across a chain -> retriever -> llm_call nested run", async () => {
    const { ctx, emit } = makeCtx();
    const handler = createLangChainCallbackHandler(ctx);

    await handler.handleChainStart({ name: "RetrievalQAChain" }, {}, "root", undefined);
    await handler.handleRetrieverStart({ name: "VectorStoreRetriever" }, "q", "child-retriever", "root");
    await handler.handleRetrieverEnd([{ pageContent: "a" }], "child-retriever", "root");
    await handler.handleLLMStart({ id: ["openai"] }, ["p"], "child-llm", "root", {
      invocation_params: { model: "gpt-4o-mini" },
    });
    await handler.handleLLMEnd({ generations: [[{}]] }, "child-llm", "root");
    await handler.handleChainEnd({ answer: "done" }, "root", undefined);

    expect(emit).toHaveBeenCalledTimes(3);
    const [retrieverEvent, llmEvent, chainEvent] = emit.mock.calls.map((call) => call[0]);
    expect(retrieverEvent.attributes.parent_run_id).toBe("root");
    expect(llmEvent.attributes.parent_run_id).toBe("root");
    expect(chainEvent.attributes.run_id).toBe("root");
    expect(chainEvent.attributes.parent_run_id).toBeNull();
  });
});
