import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace } from "../correlation/correlate.js";
import { TimeWindow } from "../correlation/join-keys.js";
import { AnomalyResult } from "../anomaly/baseline.js";
import {
  RedactionConfig,
  DEFAULT_REDACTION_CONFIG,
  redactEvent,
} from "./redact.js";

export interface TraceSummary {
  services: string[];
  deployment_ids: string[];
  window: TimeWindow;
  event_count: number;
  error_count: number;
  chain_count: number;
  tool_call_count: number;
  llm_call_count: number;
  embedding_count: number;
  vector_op_count: number;
}

export interface EvidenceItem {
  id: string;
  type: Event["type"];
  service: string;
  timestamp: string;
  duration_ms: number | null;
  severity: Event["severity"];
  relevance_score: number;
  reason: string;
  attributes: Record<string, unknown>;
}

export interface EvidenceObject {
  trace_id: string;
  generated_at: string;
  summary: TraceSummary;
  anomalies: AnomalyResult[];
  evidence: EvidenceItem[];
  redaction_applied: boolean;
}

export interface BuildEvidenceOptions {
  maxEvidenceItems?: number;
  redactionConfig?: RedactionConfig;
}

const DEFAULT_MAX_EVIDENCE_ITEMS = 25;

function anomalyMatchesEvent(event: Event, anomaly: AnomalyResult): boolean {
  if (anomaly.service !== event.service) return false;
  if (anomaly.metric === "duration_ms") return event.duration_ms !== null;
  if (anomaly.metric === "error_rate") {
    return event.severity === "error" || event.severity === "critical";
  }
  if (anomaly.metric.startsWith("metric:")) {
    const metricName = anomaly.metric.slice("metric:".length);
    return (
      event.type === "metric" && event.attributes?.["name"] === metricName
    );
  }
  return false;
}

function scoreEvent(
  event: Event,
  anomalies: AnomalyResult[],
): { score: number; reason: string } {
  if (event.severity === "critical") {
    return { score: 100, reason: "critical severity event" };
  }
  if (event.severity === "error") {
    return { score: 90, reason: "error severity event" };
  }

  if (event.type === "tool_call" && event.attributes?.["status"] === "error") {
    return { score: 88, reason: "tool call failed" };
  }
  if (event.type === "chain" && event.attributes?.["status"] === "error") {
    return { score: 88, reason: "chain step failed" };
  }
  if (
    event.type === "vector_op" &&
    typeof event.attributes?.["result_count"] === "number" &&
    event.attributes["result_count"] === 0
  ) {
    return { score: 82, reason: "vector query returned zero results" };
  }

  const anomalousMatch = anomalies
    .filter((a) => a.is_anomalous && anomalyMatchesEvent(event, a))
    .sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score))[0];

  if (anomalousMatch) {
    return {
      score: 70 + Math.min(20, Math.abs(anomalousMatch.z_score)),
      reason: `contributes to anomalous ${anomalousMatch.metric} on ${anomalousMatch.service}`,
    };
  }

  if (event.duration_ms !== null && event.duration_ms > 0) {
    return {
      score: 20 + Math.min(30, event.duration_ms / 100),
      reason: "duration contributes to trace timeline",
    };
  }

  return { score: 5, reason: "included for trace timeline context" };
}

function buildSummary(trace: CorrelatedTrace): TraceSummary {
  return {
    services: trace.services,
    deployment_ids: trace.deployment_ids,
    window: trace.window,
    event_count: trace.events.length,
    error_count: trace.errors.length,
    chain_count: trace.chains.length,
    tool_call_count: trace.tool_calls.length,
    llm_call_count: trace.llm_calls.length,
    embedding_count: trace.embeddings.length,
    vector_op_count: trace.vector_ops.length,
  };
}

export function buildEvidence(
  trace: CorrelatedTrace,
  anomalies: AnomalyResult[],
  options: BuildEvidenceOptions = {},
): EvidenceObject {
  const maxItems = options.maxEvidenceItems ?? DEFAULT_MAX_EVIDENCE_ITEMS;
  const redactionConfig = options.redactionConfig ?? DEFAULT_REDACTION_CONFIG;

  const scored = trace.events.map((event) => {
    const { score, reason } = scoreEvent(event, anomalies);
    return { event, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  const evidence: EvidenceItem[] = scored.slice(0, maxItems).map(
    ({ event, score, reason }) => {
      const processedEvent = redactionConfig.enabled
        ? redactEvent(event, redactionConfig)
        : event;
      return {
        id: processedEvent.id,
        type: processedEvent.type,
        service: processedEvent.service,
        timestamp: processedEvent.timestamp,
        duration_ms: processedEvent.duration_ms,
        severity: processedEvent.severity,
        relevance_score: Math.round(score * 100) / 100,
        reason,
        attributes: processedEvent.attributes,
      };
    },
  );

  return {
    trace_id: trace.trace_id,
    generated_at: new Date().toISOString(),
    summary: buildSummary(trace),
    anomalies,
    evidence,
    redaction_applied: redactionConfig.enabled,
  };
}