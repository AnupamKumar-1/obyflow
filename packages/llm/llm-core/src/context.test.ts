import { describe, it, expect } from "vitest";
import type { EvidenceObject } from "@obyflow/core";
import { trimEvidenceForContext } from "./context.js";

function makeLargeEvidence(itemCount: number): EvidenceObject {
  return {
    trace_id: "trace-1",
    generated_at: new Date().toISOString(),
    summary: {
      services: ["svc-a"],
      deployment_ids: [],
      window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
      event_count: itemCount,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: [],
    evidence: Array.from({ length: itemCount }, (_, i) => ({
      id: `ev-${i}`,
      type: "log",
      service: "svc-a",
      timestamp: "2026-01-01T00:01:00.000Z",
      duration_ms: null,
      severity: "info",
      relevance_score: itemCount - i,
      reason: "x".repeat(200),
      attributes: { payload: "y".repeat(200) },
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
    what_changed: Array.from({ length: 10 }, (_, i) => ({
      type: "commit",
      service: "svc-a",
      from_deployment_id: null,
      to_deployment_id: `deploy-${i}`,
      from_value: null,
      to_value: `sha-${i}`,
      detected_at: "2026-01-01T00:00:30.000Z",
      ms_before_incident_window: 1000,
      correlated_anomaly_count: 1,
      relevance_score: 10 - i,
      reason: "z".repeat(100),
    })),
    similar_historical_incidents: Array.from({ length: 10 }, (_, i) => ({
      incident_id: `inc-${i}`,
      trace_id: `trace-${i}`,
      window: { start: "2025-12-01T00:00:00.000Z", end: "2025-12-01T00:05:00.000Z" },
      similarity: 1 - i * 0.05,
      shared_tokens: ["svc:svc-a"],
      summary: "w".repeat(100),
      resolution_status: null,
      resolution_notes: null,
      applied_recommendation: null,
      resolved_at: null,
    })),
  } as unknown as EvidenceObject;
}

describe("trimEvidenceForContext", () => {
  it("leaves evidence untouched when it already fits the budget", () => {
    const evidence = makeLargeEvidence(3);
    const result = trimEvidenceForContext(evidence, 200000);
    expect(result.trim.trimmed_evidence_items).toBe(0);
    expect(result.trim.trimmed_what_changed).toBe(0);
    expect(result.trim.trimmed_similar_incidents).toBe(0);
    expect(result.evidence.evidence.length).toBe(3);
  });

  it("prunes lowest-relevance items first to fit a small context limit", () => {
    const evidence = makeLargeEvidence(50);
    const result = trimEvidenceForContext(evidence, 3000);
    expect(result.trim.trimmed_similar_incidents + result.trim.trimmed_what_changed + result.trim.trimmed_evidence_items).toBeGreaterThan(0);
    expect(result.evidence.evidence.length).toBeLessThanOrEqual(evidence.evidence.length);
    const keptIds = result.evidence.evidence.map((e) => e.id);
    if (result.trim.trimmed_evidence_items > 0) {
      expect(keptIds).toContain("ev-0");
    }
  });

  it("never drops evidence below the minimum floor", () => {
    const evidence = makeLargeEvidence(50);
    const result = trimEvidenceForContext(evidence, 1);
    expect(result.evidence.evidence.length).toBeGreaterThanOrEqual(5);
  });
});
