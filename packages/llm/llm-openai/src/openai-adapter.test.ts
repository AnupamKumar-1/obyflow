import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceObject } from "@obyflow/core";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { OpenAILLMAdapter } = await import("./openai-adapter.js");

function makeEvidence(): EvidenceObject {
  return {
    trace_id: "trace-1",
    generated_at: new Date().toISOString(),
    summary: {
      services: ["svc-a"],
      deployment_ids: [],
      window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
      event_count: 0,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: [],
    evidence: [],
    redaction_applied: false,
    retrieval_diagnosis: { detected: false, layer: "retrieval", signals: [], summary: null },
    chain_step_diagnosis: {
      detected: false,
      layer: "chain_step",
      signals: [],
      step_tree: [],
      summary: null,
    },
    evidence_graph: { nodes: [], edges: [] },
    telemetry_health: { dropped_event_count: 0, recent_failures: [], gaps: [] },
    what_changed: [],
    similar_historical_incidents: [],
  } as unknown as EvidenceObject;
}

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: "submit_investigation_finding",
                arguments: JSON.stringify({
                  root_cause: "test",
                  evidence_refs: [],
                  recommendation: "test",
                }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
});

describe("OpenAILLMAdapter temperature handling", () => {
  it("omits temperature for o1", async () => {
    const adapter = new OpenAILLMAdapter({ apiKey: "key", model: "o1" });
    await adapter.investigate(makeEvidence());
    const requestBody = create.mock.calls[0][0];
    expect(requestBody).not.toHaveProperty("temperature");
  });

  it("omits temperature for o3-mini", async () => {
    const adapter = new OpenAILLMAdapter({ apiKey: "key", model: "o3-mini" });
    await adapter.investigate(makeEvidence());
    const requestBody = create.mock.calls[0][0];
    expect(requestBody).not.toHaveProperty("temperature");
  });

  it("omits temperature for gpt-5", async () => {
    const adapter = new OpenAILLMAdapter({ apiKey: "key", model: "gpt-5" });
    await adapter.investigate(makeEvidence());
    const requestBody = create.mock.calls[0][0];
    expect(requestBody).not.toHaveProperty("temperature");
  });

  it("sends the configured temperature for gpt-4o", async () => {
    const adapter = new OpenAILLMAdapter({ apiKey: "key", model: "gpt-4o", temperature: 0.4 });
    await adapter.investigate(makeEvidence());
    const requestBody = create.mock.calls[0][0];
    expect(requestBody.temperature).toBe(0.4);
  });

  it("sends the default temperature 0 for gpt-4.1", async () => {
    const adapter = new OpenAILLMAdapter({ apiKey: "key", model: "gpt-4.1" });
    await adapter.investigate(makeEvidence());
    const requestBody = create.mock.calls[0][0];
    expect(requestBody.temperature).toBe(0);
  });
});
