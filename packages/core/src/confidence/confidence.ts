import { EvidenceObject } from "../evidence/build-evidence.js";

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export interface ConfidenceFactors {
  evidence_count: number;
  max_anomaly_z_score: number;
  anomalous_metric_count: number;
  correlated_service_count: number;
  deployment_correlated: boolean;
  trace_relationship_established: boolean;
}

export interface ConfidenceAssessment {
  tier: ConfidenceTier;
  score: number;
  factors: ConfidenceFactors;
  reasons: string[];
}

export function assessConfidence(evidence: EvidenceObject): ConfidenceAssessment {
  const evidenceCount = evidence.evidence.length;
  const anomalousMetrics = evidence.anomalies.filter((a) => a.is_anomalous);
  const maxZScore = anomalousMetrics.reduce(
    (max, a) => Math.max(max, Math.abs(a.z_score)),
    0,
  );
  const correlatedServiceCount = evidence.summary.services.length;
  const deploymentCorrelated = evidence.summary.deployment_ids.length > 0;
  const traceRelationshipEstablished =
    evidence.summary.correlation_strategy === "span_hierarchy";

  const reasons: string[] = [];

  let score = 0;
  if (evidenceCount >= 10) {
    score += 2;
    reasons.push(`${evidenceCount} independent evidence sources support this conclusion`);
  } else if (evidenceCount >= 3) {
    score += 1;
    reasons.push(`${evidenceCount} independent evidence sources support this conclusion`);
  }

  if (maxZScore >= 3) {
    score += 2;
    reasons.push(`strong statistical deviation observed (z-score ${maxZScore.toFixed(2)})`);
  } else if (maxZScore >= 2) {
    score += 1;
    reasons.push(`moderate statistical deviation observed (z-score ${maxZScore.toFixed(2)})`);
  }

  if (anomalousMetrics.length >= 2) {
    score += 1;
    reasons.push(`${anomalousMetrics.length} distinct metrics show anomalous behavior`);
  }

  if (correlatedServiceCount >= 2) {
    score += 1;
    reasons.push(`${correlatedServiceCount} services are correlated in this incident`);
  }

  if (traceRelationshipEstablished) {
    score += 1;
    reasons.push("evidence is linked by real parent/child trace relationships, not just timing");
  }

  if (deploymentCorrelated) {
    score += 1;
    reasons.push(
      `evidence is correlated with ${evidence.summary.deployment_ids.length} known deployment(s)`,
    );
  }

  const tier: ConfidenceTier = score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";

  if (reasons.length === 0) {
    reasons.push("insufficient corroborating evidence was found");
  }

  return {
    tier,
    score,
    factors: {
      evidence_count: evidenceCount,
      max_anomaly_z_score: maxZScore,
      anomalous_metric_count: anomalousMetrics.length,
      correlated_service_count: correlatedServiceCount,
      deployment_correlated: deploymentCorrelated,
      trace_relationship_established: traceRelationshipEstablished,
    },
    reasons,
  };
}
