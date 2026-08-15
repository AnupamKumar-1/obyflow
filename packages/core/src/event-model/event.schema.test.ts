import { describe, it, expect } from "vitest";
import {
  EventSchema,
  EmbeddingAttributes,
  VectorOpAttributes,
  ChainAttributes,
  ToolCallAttributes,
  LlmCallAttributes,
} from "./event.schema.js";

const baseEvent = {
  id: "evt_1",
  type: "trace" as const,
  trace_id: "trace_1",
  request_id: "req_1",
  service: "checkout-service",
  host: "host1",
  container: "c1",
  deployment_id: "deploy_1",
  timestamp: new Date().toISOString(),
  duration_ms: 100,
  attributes: {},
  severity: "info" as const,
};

describe("EventSchema", () => {
  it("accepts a well-formed event", () => {
    const result = EventSchema.safeParse(baseEvent);
    expect(result.success).toBe(true);
  });

  it("accepts nullable join-key fields", () => {
    const result = EventSchema.safeParse({
      ...baseEvent,
      trace_id: null,
      request_id: null,
      host: null,
      container: null,
      deployment_id: null,
      severity: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-ISO8601 timestamp", () => {
    const result = EventSchema.safeParse({
      ...baseEvent,
      timestamp: "yesterday",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown event type", () => {
    const result = EventSchema.safeParse({
      ...baseEvent,
      type: "not_a_real_type",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (service)", () => {
    const { service: _service, ...withoutService } = baseEvent;
    const result = EventSchema.safeParse(withoutService);
    expect(result.success).toBe(false);
  });

  it("rejects a negative duration_ms", () => {
    const result = EventSchema.safeParse({ ...baseEvent, duration_ms: -5 });
    expect(result.success).toBe(false);
  });
});

describe("EmbeddingAttributes", () => {
  it("accepts a minimal valid payload", () => {
    const result = EmbeddingAttributes.safeParse({
      model: "text-embedding-3-small",
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required provider", () => {
    const result = EmbeddingAttributes.safeParse({ model: "text-embedding-3-small" });
    expect(result.success).toBe(false);
  });
});

describe("VectorOpAttributes", () => {
  it("accepts a valid query op", () => {
    const result = VectorOpAttributes.safeParse({
      operation: "query",
      db_provider: "pinecone",
      top_k: 5,
      result_count: 3,
      similarity_scores: [0.91, 0.88, 0.75],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid operation enum value", () => {
    const result = VectorOpAttributes.safeParse({
      operation: "scan",
      db_provider: "pinecone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid db_provider enum value", () => {
    const result = VectorOpAttributes.safeParse({
      operation: "query",
      db_provider: "some_unsupported_db",
    });
    expect(result.success).toBe(false);
  });
});

describe("ChainAttributes", () => {
  it("accepts a valid langchain run", () => {
    const result = ChainAttributes.safeParse({
      framework: "langchain",
      chain_name: "retrieval_chain",
      run_id: "run_1",
      status: "success",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing run_id", () => {
    const result = ChainAttributes.safeParse({
      framework: "langchain",
      status: "success",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown framework", () => {
    const result = ChainAttributes.safeParse({
      framework: "some_other_framework",
      run_id: "run_1",
      status: "success",
    });
    expect(result.success).toBe(false);
  });
});

describe("ToolCallAttributes", () => {
  it("accepts a valid tool call", () => {
    const result = ToolCallAttributes.safeParse({
      tool_name: "search_orders",
      status: "error",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing tool_name", () => {
    const result = ToolCallAttributes.safeParse({ status: "success" });
    expect(result.success).toBe(false);
  });
});

describe("LlmCallAttributes", () => {
  it("accepts a valid llm call", () => {
    const result = LlmCallAttributes.safeParse({
      model: "claude-sonnet-5",
      provider: "anthropic",
      prompt_tokens: 500,
      completion_tokens: 120,
      latency_ms: 820,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative token count", () => {
    const result = LlmCallAttributes.safeParse({
      model: "claude-sonnet-5",
      provider: "anthropic",
      prompt_tokens: -1,
    });
    expect(result.success).toBe(false);
  });
});