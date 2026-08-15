import { describe, it, expect } from "vitest";
import { diagnoseChainSteps } from "./chain-diagnosis.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "chain",
    trace_id: overrides.trace_id ?? "t1",
    request_id: overrides.request_id ?? "r1",
    service: overrides.service ?? "agent-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    severity: overrides.severity ?? null,
  };
}

describe("diagnoseChainSteps", () => {
  it("reports no signals when there are no chain/tool_call/llm_call events", () => {
    const result = diagnoseChainSteps({ chains: [], tool_calls: [], llm_calls: [] });
    expect(result.detected).toBe(false);
    expect(result.signals).toHaveLength(0);
    expect(result.summary).toBeNull();
    expect(result.step_tree).toHaveLength(0);
  });

  it("detects a retriever step that returned zero documents", () => {
    const event = makeEvent({
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "retriever:orders-index",
        run_id: "run-1",
        parent_run_id: null,
        output_preview: JSON.stringify({ result_count: 0 }),
        status: "success",
      },
    });
    const result = diagnoseChainSteps({ chains: [event], tool_calls: [], llm_calls: [] });
    expect(result.detected).toBe(true);
    expect(result.signals[0].type).toBe("retriever_empty_results");
    expect(result.signals[0].reason).toBe("Retriever step returned 0 documents");
  });

  it("does not flag a retriever step that returned documents", () => {
    const event = makeEvent({
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "retriever:orders-index",
        run_id: "run-1",
        parent_run_id: null,
        output_preview: JSON.stringify({ result_count: 4 }),
        status: "success",
      },
    });
    const result = diagnoseChainSteps({ chains: [event], tool_calls: [], llm_calls: [] });
    expect(result.detected).toBe(false);
  });

  it("detects a tool call timeout from an error message", () => {
    const event = makeEvent({
      type: "tool_call",
      duration_ms: 32000,
      attributes: {
        tool_name: "search_orders",
        run_id: "run-2",
        parent_run_id: "run-1",
        result_preview: "Error: request timed out after 30000ms",
        status: "error",
      },
    });
    const result = diagnoseChainSteps({ chains: [], tool_calls: [event], llm_calls: [] });
    expect(result.detected).toBe(true);
    expect(result.signals[0].type).toBe("tool_call_timeout");
    expect(result.signals[0].reason).toBe("Tool call `search_orders` timed out");
  });

  it("detects a tool call timeout purely from exceeding the configured duration threshold", () => {
    const event = makeEvent({
      type: "tool_call",
      duration_ms: 15000,
      attributes: {
        tool_name: "search_orders",
        run_id: "run-2",
        parent_run_id: "run-1",
        result_preview: "connection reset",
        status: "error",
      },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [event], llm_calls: [] },
      [],
      { toolCallTimeoutMs: 10000 },
    );
    expect(result.signals[0].type).toBe("tool_call_timeout");
  });

  it("classifies a non-timeout tool call error as a generic step failure", () => {
    const event = makeEvent({
      type: "tool_call",
      duration_ms: 50,
      attributes: {
        tool_name: "search_orders",
        run_id: "run-2",
        parent_run_id: "run-1",
        result_preview: "invalid arguments",
        status: "error",
      },
    });
    const result = diagnoseChainSteps({ chains: [], tool_calls: [event], llm_calls: [] });
    expect(result.signals[0].type).toBe("step_failed");
    expect(result.signals[0].reason).toBe("Tool call `search_orders` failed");
  });

  it("detects a failed chain step", () => {
    const event = makeEvent({
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "order-lookup-chain",
        run_id: "run-1",
        parent_run_id: null,
        output_preview: "boom",
        status: "error",
      },
    });
    const result = diagnoseChainSteps({ chains: [event], tool_calls: [], llm_calls: [] });
    expect(result.signals[0].type).toBe("step_failed");
    expect(result.signals[0].reason).toBe('Chain step "order-lookup-chain" failed');
  });

  it("detects an LLM call step duration regression against a historical baseline", () => {
    const historicalEvents: Event[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `hist-${i}`,
        type: "llm_call",
        duration_ms: 900 + i * 10,
        attributes: {
          model: "claude-sonnet-5",
          provider: "anthropic",
          run_id: `hist-run-${i}`,
          parent_run_id: null,
          status: "success",
        },
      }),
    );
    const currentEvent = makeEvent({
      type: "llm_call",
      duration_ms: 8200,
      attributes: {
        model: "claude-sonnet-5",
        provider: "anthropic",
        run_id: "run-3",
        parent_run_id: "run-1",
        status: "success",
      },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [], llm_calls: [currentEvent] },
      historicalEvents,
    );
    expect(result.detected).toBe(true);
    expect(result.signals[0].type).toBe("step_duration_regression");
    expect(result.signals[0].reason).toContain("8200ms vs");
    expect(result.signals[0].severity).toBe("high");
  });

  it("does not flag a duration regression without enough historical samples", () => {
    const historicalEvents: Event[] = [
      makeEvent({
        id: "hist-0",
        type: "llm_call",
        duration_ms: 900,
        attributes: { model: "claude-sonnet-5", provider: "anthropic", status: "success" },
      }),
    ];
    const currentEvent = makeEvent({
      type: "llm_call",
      duration_ms: 8200,
      attributes: { model: "claude-sonnet-5", provider: "anthropic", status: "success" },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [], llm_calls: [currentEvent] },
      historicalEvents,
    );
    expect(result.detected).toBe(false);
  });

  it("does not flag a duration regression for a different step identity", () => {
    const historicalEvents: Event[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `hist-${i}`,
        type: "llm_call",
        duration_ms: 900,
        attributes: { model: "gpt-4o", provider: "openai", status: "success" },
      }),
    );
    const currentEvent = makeEvent({
      type: "llm_call",
      duration_ms: 8200,
      attributes: { model: "claude-sonnet-5", provider: "anthropic", status: "success" },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [], llm_calls: [currentEvent] },
      historicalEvents,
    );
    expect(result.detected).toBe(false);
  });

  it("prioritizes a failure signal over a duration regression signal for the same event", () => {
    const historicalEvents: Event[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `hist-${i}`,
        type: "tool_call",
        duration_ms: 100,
        attributes: { tool_name: "search_orders", status: "success" },
      }),
    );
    const currentEvent = makeEvent({
      type: "tool_call",
      duration_ms: 9000,
      attributes: {
        tool_name: "search_orders",
        result_preview: "invalid arguments",
        status: "error",
      },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [currentEvent], llm_calls: [] },
      historicalEvents,
    );
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].type).toBe("step_failed");
  });

  it("builds a nested step tree from run_id/parent_run_id trace context propagation", () => {
    const chainEvent = makeEvent({
      id: "e-chain",
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "order-lookup-chain",
        run_id: "run-1",
        parent_run_id: null,
        status: "success",
      },
    });
    const retrieverEvent = makeEvent({
      id: "e-retriever",
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "retriever:orders-index",
        run_id: "run-2",
        parent_run_id: "run-1",
        output_preview: JSON.stringify({ result_count: 0 }),
        status: "success",
      },
    });
    const toolEvent = makeEvent({
      id: "e-tool",
      type: "tool_call",
      attributes: {
        tool_name: "search_orders",
        run_id: "run-3",
        parent_run_id: "run-1",
        status: "success",
      },
    });
    const result = diagnoseChainSteps({
      chains: [chainEvent, retrieverEvent],
      tool_calls: [toolEvent],
      llm_calls: [],
    });
    expect(result.step_tree).toHaveLength(1);
    expect(result.step_tree[0].event_id).toBe("e-chain");
    expect(result.step_tree[0].children).toHaveLength(2);
    const childIds = result.step_tree[0].children.map((c) => c.event_id).sort();
    expect(childIds).toEqual(["e-retriever", "e-tool"]);
    expect(result.signals.map((s) => s.event_id)).toContain("e-retriever");
  });

  it("treats events across different trace/request context as independent step identities", () => {
    const traceAHistory: Event[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        id: `a-hist-${i}`,
        trace_id: "trace-a",
        request_id: "req-a",
        type: "llm_call",
        duration_ms: 900,
        attributes: { model: "claude-sonnet-5", provider: "anthropic", status: "success" },
      }),
    );
    const traceBCurrent = makeEvent({
      id: "b-current",
      trace_id: "trace-b",
      request_id: "req-b",
      type: "llm_call",
      duration_ms: 8200,
      attributes: { model: "claude-sonnet-5", provider: "anthropic", status: "success" },
    });
    const result = diagnoseChainSteps(
      { chains: [], tool_calls: [], llm_calls: [traceBCurrent] },
      traceAHistory,
    );
    expect(result.detected).toBe(true);
    expect(result.signals[0].event_id).toBe("b-current");
  });

  it("produces a summary describing multiple distinct signal types", () => {
    const failedTool = makeEvent({
      type: "tool_call",
      attributes: { tool_name: "search_orders", status: "error", result_preview: "bad input" },
    });
    const emptyRetriever = makeEvent({
      type: "chain",
      attributes: {
        framework: "langchain",
        chain_name: "retriever:orders-index",
        output_preview: JSON.stringify({ result_count: 0 }),
        status: "success",
      },
    });
    const result = diagnoseChainSteps({
      chains: [emptyRetriever],
      tool_calls: [failedTool],
      llm_calls: [],
    });
    expect(result.summary).toContain("failed steps");
    expect(result.summary).toContain("retriever steps with no results");
  });
});
