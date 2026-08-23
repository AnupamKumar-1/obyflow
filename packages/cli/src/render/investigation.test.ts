import { describe, it, expect } from "vitest";
import { renderInvestigationReport } from "./investigation.js";
import type { EvidenceObject, ConfidenceAssessment } from "@obyflow/core";

function makeEvidenceObject(overrides: Partial<EvidenceObject> = {}): EvidenceObject {
  return {
    trace_id: "t1",
    generated_at: new Date().toISOString(),
    summary: {
      services: ["search-service"],
      deployment_ids: [],
      window: { start: new Date().toISOString(), end: new Date().toISOString() },
      event_count: 1,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 1,
    },
    anomalies: [],
    evidence: [],
    redaction_applied: true,
    retrieval_diagnosis: { detected: false, layer: "retrieval", signals: [], summary: null },
    chain_step_diagnosis: {
      detected: false,
      layer: "chain_step",
      signals: [],
      step_tree: [],
      summary: null,
    },
    ...overrides,
  };
}

function makeConfidence(overrides: Partial<ConfidenceAssessment> = {}): ConfidenceAssessment {
  return {
    tier: "LOW",
    score: 0,
    factors: {
      evidence_count: 0,
      max_anomaly_z_score: 0,
      anomalous_metric_count: 0,
      correlated_service_count: 1,
      deployment_correlated: false,
      trace_relationship_established: false,
    },
    reasons: ["insufficient corroborating evidence was found"],
    ...overrides,
  };
}

describe("renderInvestigationReport", () => {
  it("omits the retrieval layer section when no signals were detected", () => {
    const report = renderInvestigationReport({
      title: "Investigation",
      traceId: "t1",
      evidenceObject: makeEvidenceObject(),
      confidence: makeConfidence(),
      llmResult: null,
      llmNote: null,
    });
    expect(report).not.toContain("Retrieval Layer");
  });

  it("renders the retrieval layer section when signals were detected", () => {
    const report = renderInvestigationReport({
      title: "Investigation",
      traceId: "t1",
      evidenceObject: makeEvidenceObject({
        retrieval_diagnosis: {
          detected: true,
          layer: "retrieval",
          summary: "Retrieval layer likely contributes to this failure: empty result sets (1).",
          signals: [
            {
              type: "empty_results",
              event_id: "e1",
              service: "search-service",
              severity: "high",
              reason: "vector query returned zero results",
              detail: { result_count: 0 },
            },
          ],
        },
      }),
      confidence: makeConfidence({ tier: "MEDIUM", score: 2 }),
      llmResult: null,
      llmNote: null,
    });
    expect(report).toContain("Retrieval Layer");
    expect(report).toContain("empty_results");
  });

  it("omits the chain steps section when no signals were detected", () => {
    const report = renderInvestigationReport({
      title: "Investigation",
      traceId: "t1",
      evidenceObject: makeEvidenceObject(),
      confidence: makeConfidence(),
      llmResult: null,
      llmNote: null,
    });
    expect(report).not.toContain("Chain Steps");
  });

  it("renders the chain steps section when signals were detected", () => {
    const report = renderInvestigationReport({
      title: "Investigation",
      traceId: "t1",
      evidenceObject: makeEvidenceObject({
        chain_step_diagnosis: {
          detected: true,
          layer: "chain_step",
          summary: "Chain step layer likely contributes to this failure: tool call timeouts (1).",
          signals: [
            {
              type: "tool_call_timeout",
              event_id: "e1",
              run_id: "run-2",
              parent_run_id: "run-1",
              step_kind: "tool_call",
              step_name: "search_orders",
              service: "agent-service",
              severity: "high",
              reason: "Tool call `search_orders` timed out",
              detail: { duration_ms: 32000, timeout_ms: 30000 },
            },
          ],
          step_tree: [],
        },
      }),
      confidence: makeConfidence({ tier: "MEDIUM", score: 2 }),
      llmResult: null,
      llmNote: null,
    });
    expect(report).toContain("Chain Steps");
    expect(report).toContain("tool_call_timeout");
    expect(report).toContain("search_orders");
  });
});
