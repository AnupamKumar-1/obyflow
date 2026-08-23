import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace } from "../correlation/correlate.js";
import { TimeWindow } from "../correlation/join-keys.js";
import { AnomalyResult } from "../anomaly/baseline.js";
import {
  RedactionConfig,
  DEFAULT_REDACTION_CONFIG,
  redactEvent,
} from "./redact.js";
import {
  diagnoseRetrievalLayer,
  RetrievalDiagnosis,
  RetrievalDiagnosisOptions,
  RetrievalSignal,
} from "./retrieval-diagnosis.js";
import {
  diagnoseChainSteps,
  ChainStepDiagnosis,
  ChainStepDiagnosisOptions,
  ChainStepSignal,
} from "./chain-diagnosis.js";
import { buildEvidenceGraph, EvidenceGraph } from "./evidence-graph.js";
import { detectTelemetryGaps, TelemetryFailure, TelemetryHealthReport } from "../telemetry/health.js";
import { detectWhatChanged, ChangeEvent } from "../change/what-changed.js";

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
  correlation_strategy?: "span_hierarchy" | "time_window";
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
  retrieval_diagnosis: RetrievalDiagnosis;
  chain_step_diagnosis: ChainStepDiagnosis;
  evidence_graph: EvidenceGraph;
  telemetry_health: TelemetryHealthReport;
  what_changed: ChangeEvent[];
}

export interface BuildEvidenceOptions {
  maxEvidenceItems?: number;
  redactionConfig?: RedactionConfig;
  retrievalDiagnosisOptions?: RetrievalDiagnosisOptions;
  chainStepDiagnosisOptions?: ChainStepDiagnosisOptions;
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

function groupRetrievalSignalsByEvent(
  signals: RetrievalSignal[],
): Map<string, RetrievalSignal[]> {
  const map = new Map<string, RetrievalSignal[]>();
  for (const signal of signals) {
    const existing = map.get(signal.event_id) ?? [];
    existing.push(signal);
    map.set(signal.event_id, existing);
  }
  return map;
}

function bestRetrievalSignal(signals: RetrievalSignal[]): RetrievalSignal {
  return signals.reduce((best, current) =>
    current.severity === "high" && best.severity !== "high" ? current : best,
  );
}

function retrievalSignalScore(signal: RetrievalSignal): number {
  return signal.severity === "high" ? 85 : 78;
}

function groupChainStepSignalsByEvent(
  signals: ChainStepSignal[],
): Map<string, ChainStepSignal[]> {
  const map = new Map<string, ChainStepSignal[]>();
  for (const signal of signals) {
    const existing = map.get(signal.event_id) ?? [];
    existing.push(signal);
    map.set(signal.event_id, existing);
  }
  return map;
}

function bestChainStepSignal(signals: ChainStepSignal[]): ChainStepSignal {
  return signals.reduce((best, current) =>
    current.severity === "high" && best.severity !== "high" ? current : best,
  );
}

function chainStepSignalScore(signal: ChainStepSignal): number {
  return signal.severity === "high" ? 92 : 80;
}

function scoreEvent(
  event: Event,
  anomalies: AnomalyResult[],
  retrievalSignalsByEvent: Map<string, RetrievalSignal[]>,
  chainStepSignalsByEvent: Map<string, ChainStepSignal[]>,
): { score: number; reason: string } {
  const chainStepSignals = chainStepSignalsByEvent.get(event.id);
  if (chainStepSignals && chainStepSignals.length > 0) {
    const signal = bestChainStepSignal(chainStepSignals);
    return { score: chainStepSignalScore(signal), reason: signal.reason };
  }

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

  const retrievalSignals = retrievalSignalsByEvent.get(event.id);
  if (retrievalSignals && retrievalSignals.length > 0) {
    const signal = bestRetrievalSignal(retrievalSignals);
    return { score: retrievalSignalScore(signal), reason: signal.reason };
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
    correlation_strategy: trace.correlation_strategy,
  };
}

export function buildEvidence(
  trace: CorrelatedTrace,
  anomalies: AnomalyResult[],
  options: BuildEvidenceOptions = {},
  historicalEvents: Event[] = [],
  telemetryFailures: TelemetryFailure[] = [],
): EvidenceObject {
  const maxItems = options.maxEvidenceItems ?? DEFAULT_MAX_EVIDENCE_ITEMS;
  const redactionConfig = options.redactionConfig ?? DEFAULT_REDACTION_CONFIG;
  const retrievalDiagnosis = diagnoseRetrievalLayer(
    trace,
    options.retrievalDiagnosisOptions,
  );
  const retrievalSignalsByEvent = groupRetrievalSignalsByEvent(
    retrievalDiagnosis.signals,
  );
  const chainStepDiagnosis = diagnoseChainSteps(
    trace,
    historicalEvents,
    options.chainStepDiagnosisOptions,
  );
  const chainStepSignalsByEvent = groupChainStepSignalsByEvent(
    chainStepDiagnosis.signals,
  );

  const scored = trace.events.map((event) => {
    const { score, reason } = scoreEvent(
      event,
      anomalies,
      retrievalSignalsByEvent,
      chainStepSignalsByEvent,
    );
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

  const evidenceGraph = buildEvidenceGraph(
    trace,
    anomalies,
    new Set(evidence.map((item) => item.id)),
  );

  const telemetryHealth: TelemetryHealthReport = {
    dropped_event_count: telemetryFailures.length,
    recent_failures: telemetryFailures,
    gaps: detectTelemetryGaps(trace.events, trace.window),
  };

  const whatChanged = detectWhatChanged(trace, historicalEvents, anomalies);

  return {
    trace_id: trace.trace_id,
    generated_at: new Date().toISOString(),
    summary: buildSummary(trace),
    anomalies,
    evidence,
    redaction_applied: redactionConfig.enabled,
    retrieval_diagnosis: retrievalDiagnosis,
    chain_step_diagnosis: chainStepDiagnosis,
    evidence_graph: evidenceGraph,
    telemetry_health: telemetryHealth,
    what_changed: whatChanged,
  };
}
