import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceObject } from "@obyflow/core";

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  FunctionCallingConfigMode: { ANY: "ANY" },
}));

const { GeminiLLMAdapter } = await import("./gemini-adapter.js");

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
  generateContent.mockReset();
  generateContent.mockResolvedValue({
    functionCalls: [
      {
        name: "submit_investigation_finding",
        args: { root_cause: "test", evidence_refs: [], recommendation: "test" },
      },
    ],
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
});

describe("GeminiLLMAdapter thinkingConfig", () => {
  it("does not send thinkingConfig for Gemini 3.x models", async () => {
    const adapter = new GeminiLLMAdapter({ apiKey: "key", model: "gemini-3.6-flash" });
    await adapter.investigate(makeEvidence());

    const requestConfig = generateContent.mock.calls[0][0].config;
    expect(requestConfig).not.toHaveProperty("thinkingConfig");
  });

  it("sends thinkingConfig: { thinkingBudget: 0 } for Gemini 2.x models", async () => {
    const adapter = new GeminiLLMAdapter({ apiKey: "key", model: "gemini-2.5-flash" });
    await adapter.investigate(makeEvidence());

    const requestConfig = generateContent.mock.calls[0][0].config;
    expect(requestConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});
