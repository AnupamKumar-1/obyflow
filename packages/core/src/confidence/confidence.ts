import { EvidenceObject } from "../evidence/build-evidence.js";

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceFactors {
  evidence_count: number;
  max_anomaly_z_score: number;
  anomalous_metric_count: number;
  correlated_service_count: number;
}

export interface ConfidenceAssessment {
  tier: ConfidenceTier;
  score: number;
  factors: ConfidenceFactors;
}

export function assessConfidence(evidence: EvidenceObject): ConfidenceAssessment {
  const evidenceCount = evidence.evidence.length;
  const anomalousMetrics = evidence.anomalies.filter((a) => a.is_anomalous);
  const maxZScore = anomalousMetrics.reduce(
    (max, a) => Math.max(max, Math.abs(a.z_score)),
    0,
  );
  const correlatedServiceCount = evidence.summary.services.length;

  let score = 0;
  if (evidenceCount >= 10) score += 2;
  else if (evidenceCount >= 3) score += 1;

  if (maxZScore >= 3) score += 2;
  else if (maxZScore >= 2) score += 1;

  if (anomalousMetrics.length >= 2) score += 1;
  if (correlatedServiceCount >= 2) score += 1;

  const tier: ConfidenceTier = score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";

  return {
    tier,
    score,
    factors: {
      evidence_count: evidenceCount,
      max_anomaly_z_score: maxZScore,
      anomalous_metric_count: anomalousMetrics.length,
      correlated_service_count: correlatedServiceCount,
    },
  };
}
