import { describe, it, expect } from "vitest";
import { assessConfidence } from "./confidence.js";
import type { EvidenceObject, EvidenceItem } from "../evidence/build-evidence.js";
import type { AnomalyResult } from "../anomaly/baseline.js";

function makeAnomaly(overrides: Partial<AnomalyResult>): AnomalyResult {
  return {
    metric: overrides.metric ?? "duration_ms",
    service: overrides.service ?? "checkout-service",
    baseline: overrides.baseline ?? { mean: 100, stddev: 10, count: 12 },
    current_value: overrides.current_value ?? 100,
    current_count: overrides.current_count ?? 1,
    z_score: overrides.z_score ?? 0,
    severity: overrides.severity ?? "none",
    is_anomalous: overrides.is_anomalous ?? false,
    insufficient_data: overrides.insufficient_data ?? false,
  };
}

function makeEvidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    service: overrides.service ?? "checkout-service",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    severity: overrides.severity ?? null,
    relevance_score: overrides.relevance_score ?? 5,
    reason: overrides.reason ?? "included for trace timeline context",
    attributes: overrides.attributes ?? {},
  };
}

function makeEvidence(overrides: {
  evidenceCount?: number;
  anomalies?: AnomalyResult[];
  services?: string[];
} = {}): EvidenceObject {
  const evidenceCount = overrides.evidenceCount ?? 0;
  const services = overrides.services ?? ["checkout-service"];
  return {
    trace_id: "t1",
    generated_at: new Date().toISOString(),
    summary: {
      services,
      deployment_ids: [],
      window: { start: new Date().toISOString(), end: new Date().toISOString() },
      event_count: evidenceCount,
      error_count: 0,
      chain_count: 0,
      tool_call_count: 0,
      llm_call_count: 0,
      embedding_count: 0,
      vector_op_count: 0,
    },
    anomalies: overrides.anomalies ?? [],
    evidence: Array.from({ length: evidenceCount }, () => makeEvidenceItem()),
    redaction_applied: true,
    retrieval_diagnosis: { detected: false, layer: "retrieval", signals: [], summary: null },
  };
}

describe("assessConfidence", () => {
  it("returns LOW tier with score 0 for completely empty evidence", () => {
    const evidence = makeEvidence();
    const result = assessConfidence(evidence);
    expect(result.tier).toBe("LOW");
    expect(result.score).toBe(0);
    expect(result.factors).toEqual({
      evidence_count: 0,
      max_anomaly_z_score: 0,
      anomalous_metric_count: 0,
      correlated_service_count: 1,
    });
  });

  it("stays LOW when only a small amount of evidence is present", () => {
    const evidence = makeEvidence({ evidenceCount: 3 });
    const result = assessConfidence(evidence);
    expect(result.score).toBe(1);
    expect(result.tier).toBe("LOW");
  });

  it("reaches MEDIUM at score 2 from evidence count alone crossing 10", () => {
    const evidence = makeEvidence({ evidenceCount: 10 });
    const result = assessConfidence(evidence);
    expect(result.score).toBe(2);
    expect(result.tier).toBe("MEDIUM");
  });

  it("reaches MEDIUM from a moderate z-score contribution", () => {
    const evidence = makeEvidence({
      evidenceCount: 3,
      anomalies: [makeAnomaly({ z_score: 2.5, is_anomalous: true })],
    });
    const result = assessConfidence(evidence);
    expect(result.score).toBe(2);
    expect(result.tier).toBe("MEDIUM");
  });

  it("reaches HIGH once evidence count and a strong z-score combine to score 4", () => {
    const evidence = makeEvidence({
      evidenceCount: 10,
      anomalies: [makeAnomaly({ z_score: 3.5, is_anomalous: true })],
    });
    const result = assessConfidence(evidence);
    expect(result.score).toBe(4);
    expect(result.tier).toBe("HIGH");
  });

  it("ignores anomalies that are not flagged as is_anomalous", () => {
    const evidence = makeEvidence({
      evidenceCount: 10,
      anomalies: [makeAnomaly({ z_score: 9, is_anomalous: false })],
    });
    const result = assessConfidence(evidence);
    expect(result.factors.max_anomaly_z_score).toBe(0);
    expect(result.factors.anomalous_metric_count).toBe(0);
  });

  it("uses the absolute value of z_score when finding the max", () => {
    const evidence = makeEvidence({
      anomalies: [
        makeAnomaly({ z_score: -5, is_anomalous: true }),
        makeAnomaly({ z_score: 1.2, is_anomalous: true, metric: "error_rate" }),
      ],
    });
    const result = assessConfidence(evidence);
    expect(result.factors.max_anomaly_z_score).toBe(5);
  });

  it("adds a point when two or more anomalous metrics are present", () => {
    const single = makeEvidence({
      anomalies: [makeAnomaly({ z_score: 1.5, is_anomalous: true })],
    });
    const double = makeEvidence({
      anomalies: [
        makeAnomaly({ z_score: 1.5, is_anomalous: true, metric: "duration_ms" }),
        makeAnomaly({ z_score: 1.5, is_anomalous: true, metric: "error_rate" }),
      ],
    });
    const singleResult = assessConfidence(single);
    const doubleResult = assessConfidence(double);
    expect(doubleResult.score).toBe(singleResult.score + 1);
    expect(doubleResult.factors.anomalous_metric_count).toBe(2);
  });

  it("adds a point when two or more correlated services are present", () => {
    const oneService = makeEvidence({ services: ["checkout-service"] });
    const twoServices = makeEvidence({
      services: ["checkout-service", "payment-service"],
    });
    const oneResult = assessConfidence(oneService);
    const twoResult = assessConfidence(twoServices);
    expect(twoResult.score).toBe(oneResult.score + 1);
    expect(twoResult.factors.correlated_service_count).toBe(2);
  });

  it("caps out at HIGH when every factor is maximally satisfied", () => {
    const evidence = makeEvidence({
      evidenceCount: 25,
      services: ["checkout-service", "payment-service", "api-gateway"],
      anomalies: [
        makeAnomaly({ z_score: 6, is_anomalous: true, metric: "duration_ms" }),
        makeAnomaly({ z_score: 4, is_anomalous: true, metric: "error_rate" }),
      ],
    });
    const result = assessConfidence(evidence);
    expect(result.score).toBe(6);
    expect(result.tier).toBe("HIGH");
  });

  it("reports factors matching the underlying evidence shape", () => {
    const evidence = makeEvidence({
      evidenceCount: 5,
      services: ["checkout-service", "payment-service"],
      anomalies: [makeAnomaly({ z_score: 2.2, is_anomalous: true })],
    });
    const result = assessConfidence(evidence);
    expect(result.factors.evidence_count).toBe(5);
    expect(result.factors.correlated_service_count).toBe(2);
    expect(result.factors.max_anomaly_z_score).toBe(2.2);
    expect(result.factors.anomalous_metric_count).toBe(1);
  });
});
