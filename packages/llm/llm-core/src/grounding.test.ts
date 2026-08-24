import { describe, it, expect } from "vitest";
import type { EvidenceObject } from "@obyflow/core";
import { validateEvidenceGrounding } from "./grounding.js";

function makeEvidence(itemIds: string[]): EvidenceObject {
  return {
    trace_id: "trace-1",
    generated_at: new Date().toISOString(),
    summary: {
      services: ["svc-a"],
      deployment_ids: [],
      window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
      event_count: itemIds.length,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: [],
    evidence: itemIds.map((id) => ({
      id,
      type: "log",
      service: "svc-a",
      timestamp: "2026-01-01T00:01:00.000Z",
      duration_ms: null,
      severity: "info",
      relevance_score: 1,
      reason: "test",
      attributes: {},
    })),
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

describe("validateEvidenceGrounding", () => {
  it("treats all refs as grounded when every id exists in the evidence array", () => {
    const evidence = makeEvidence(["ev-1", "ev-2"]);
    const result = validateEvidenceGrounding(evidence, ["ev-1", "ev-2"]);
    expect(result.grounded_evidence_refs).toEqual(["ev-1", "ev-2"]);
    expect(result.ungrounded_evidence_refs).toEqual([]);
    expect(result.groundedness_ratio).toBe(1);
    expect(result.groundedness_warning).toBeNull();
  });

  it("flags refs that do not match any evidence id", () => {
    const evidence = makeEvidence(["ev-1"]);
    const result = validateEvidenceGrounding(evidence, ["ev-1", "made-up-id"]);
    expect(result.grounded_evidence_refs).toEqual(["ev-1"]);
    expect(result.ungrounded_evidence_refs).toEqual(["made-up-id"]);
    expect(result.groundedness_ratio).toBe(0.5);
    expect(result.groundedness_warning).toContain("1 of 2");
  });

  it("warns when no evidence_refs were returned at all", () => {
    const evidence = makeEvidence(["ev-1"]);
    const result = validateEvidenceGrounding(evidence, []);
    expect(result.groundedness_ratio).toBe(0);
    expect(result.groundedness_warning).toContain("no evidence_refs");
  });
});
