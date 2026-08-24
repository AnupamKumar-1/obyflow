import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import {
  computeFingerprint,
  recordIncidentFingerprint,
  recordIncidentResolution,
  findSimilarIncidents,
  computeResolutionInsight,
} from "./memory.js";
import type { EvidenceObject } from "../evidence/build-evidence.js";

function makeEvidence(overrides: Partial<EvidenceObject> = {}): EvidenceObject {
  return {
    trace_id: overrides.trace_id ?? "t1",
    generated_at: new Date().toISOString(),
    summary: overrides.summary ?? {
      services: ["checkout-service"],
      deployment_ids: [],
      window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:05:00.000Z" },
      event_count: 0,
      error_count: 1,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: overrides.anomalies ?? [],
    evidence: overrides.evidence ?? [],
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
    what_changed: overrides.what_changed ?? [],
    similar_historical_incidents: [],
  };
}

describe("recordIncidentResolution / findSimilarIncidents resolution fields", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("returns false when resolving a trace that was never recorded", () => {
    const result = recordIncidentResolution(store, {
      traceId: "unknown-trace",
      status: "resolved",
    });
    expect(result).toBe(false);
  });

  it("records a resolution and surfaces it through findSimilarIncidents", () => {
    const evidenceA = makeEvidence({ trace_id: "trace-a" });
    const fingerprintA = computeFingerprint(evidenceA);
    recordIncidentFingerprint(store, "trace-a", evidenceA.summary.window, fingerprintA, "summary a");

    const updated = recordIncidentResolution(store, {
      traceId: "trace-a",
      status: "resolved",
      notes: "rolled back the bad deploy",
      appliedRecommendation: "rollback to previous deployment",
    });
    expect(updated).toBe(true);

    const evidenceB = makeEvidence({ trace_id: "trace-b" });
    const fingerprintB = computeFingerprint(evidenceB);
    const similar = findSimilarIncidents(store, fingerprintB, "trace-b");

    expect(similar.length).toBeGreaterThan(0);
    const match = similar.find((i) => i.trace_id === "trace-a");
    expect(match?.resolution_status).toBe("resolved");
    expect(match?.applied_recommendation).toBe("rollback to previous deployment");
    expect(match?.resolved_at).not.toBeNull();
  });
});

describe("computeResolutionInsight", () => {
  it("returns null when no similar incidents have a recorded resolution", () => {
    expect(
      computeResolutionInsight([
        {
          incident_id: "i1",
          trace_id: "t1",
          window: { start: "", end: "" },
          similarity: 0.5,
          shared_tokens: [],
          summary: null,
          resolution_status: null,
          resolution_notes: null,
          applied_recommendation: null,
          resolved_at: null,
        },
      ]),
    ).toBeNull();
  });

  it("summarizes the resolution rate and most common applied fix", () => {
    const insight = computeResolutionInsight([
      {
        incident_id: "i1",
        trace_id: "t1",
        window: { start: "", end: "" },
        similarity: 0.9,
        shared_tokens: [],
        summary: null,
        resolution_status: "resolved",
        resolution_notes: null,
        applied_recommendation: "restart the pod",
        resolved_at: "2026-01-01T00:00:00.000Z",
      },
      {
        incident_id: "i2",
        trace_id: "t2",
        window: { start: "", end: "" },
        similarity: 0.8,
        shared_tokens: [],
        summary: null,
        resolution_status: "resolved",
        resolution_notes: null,
        applied_recommendation: "restart the pod",
        resolved_at: "2026-01-01T00:00:00.000Z",
      },
      {
        incident_id: "i3",
        trace_id: "t3",
        window: { start: "", end: "" },
        similarity: 0.7,
        shared_tokens: [],
        summary: null,
        resolution_status: "not_resolved",
        resolution_notes: null,
        applied_recommendation: null,
        resolved_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(insight).toContain("2 of 3");
    expect(insight).toContain("restart the pod");
  });
});
