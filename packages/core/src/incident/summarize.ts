import { SqliteStore } from "../storage/sqlite-store.js";
import { investigateTrace, InvestigateOptions } from "../investigation/investigate.js";
import { EvidenceObject, EvidenceItem } from "../evidence/build-evidence.js";
import { AnomalyResult } from "../anomaly/baseline.js";
import { RetrievalSignal } from "../evidence/retrieval-diagnosis.js";
import { ChainStepSignal, ChainStepNode } from "../evidence/chain-diagnosis.js";
import { EvidenceGraphNode, EvidenceGraphEdge } from "../evidence/evidence-graph.js";
import { TelemetryFailure, TelemetryGap } from "../telemetry/health.js";
import { ChangeEvent } from "../change/what-changed.js";
import { ConfidenceAssessment, assessConfidence } from "../confidence/confidence.js";
import { TimeWindow } from "../correlation/join-keys.js";

export interface IncidentSummaryOptions extends InvestigateOptions {
  maxTraces?: number;
  maxIncidentEvidenceItems?: number;
}

export interface IncidentSummary {
  window: TimeWindow;
  trace_ids: string[];
  evidence: EvidenceObject;
  confidence: ConfidenceAssessment;
}

const DEFAULT_MAX_TRACES = 5;
const DEFAULT_MAX_INCIDENT_EVIDENCE_ITEMS = 25;

export function findIncidentTraceIds(
  store: SqliteStore,
  sinceIso: string,
  service?: string,
  limit?: number,
): string[] {
  const errorRows = store.getErrors({ service, sinceIso, limit: limit ?? 500 });
  const counts = new Map<string, number>();
  for (const row of errorRows) {
    if (!row.trace_id) continue;
    counts.set(row.trace_id, (counts.get(row.trace_id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([traceId]) => traceId);
}

function emptyEvidence(sinceIso: string): EvidenceObject {
  return {
    trace_id: `incident:${sinceIso}`,
    generated_at: new Date().toISOString(),
    summary: {
      services: [],
      deployment_ids: [],
      window: { start: sinceIso, end: new Date().toISOString() },
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
  };
}

export function summarizeIncident(
  store: SqliteStore,
  sinceIso: string,
  options: IncidentSummaryOptions = {},
  service?: string,
): IncidentSummary {
  const maxTraces = options.maxTraces ?? DEFAULT_MAX_TRACES;
  const maxEvidenceItems =
    options.maxIncidentEvidenceItems ?? DEFAULT_MAX_INCIDENT_EVIDENCE_ITEMS;
  const traceIds = findIncidentTraceIds(store, sinceIso, service).slice(0, maxTraces);

  if (traceIds.length === 0) {
    const evidence = emptyEvidence(sinceIso);
    return {
      window: evidence.summary.window,
      trace_ids: [],
      evidence,
      confidence: assessConfidence(evidence),
    };
  }

  const services = new Set<string>();
  const deploymentIds = new Set<string>();
  const evidenceItems: EvidenceItem[] = [];
  const anomalies: AnomalyResult[] = [];
  const retrievalSignals: RetrievalSignal[] = [];
  const chainStepSignals: ChainStepSignal[] = [];
  const chainStepTree: ChainStepNode[] = [];
  const graphNodes: EvidenceGraphNode[] = [];
  const graphEdges: EvidenceGraphEdge[] = [];
  const telemetryFailures: TelemetryFailure[] = [];
  const telemetryGaps: TelemetryGap[] = [];
  const whatChanged: ChangeEvent[] = [];
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  let eventCount = 0;
  let errorCount = 0;
  let chainCount = 0;
  let toolCallCount = 0;
  let llmCallCount = 0;
  let embeddingCount = 0;
  let vectorOpCount = 0;
  let redactionApplied = false;

  for (const traceId of traceIds) {
    const result = investigateTrace(store, traceId, options);
    for (const s of result.trace.services) services.add(s);
    for (const d of result.trace.deployment_ids) deploymentIds.add(d);
    if (windowStart === null || result.trace.window.start < windowStart) {
      windowStart = result.trace.window.start;
    }
    if (windowEnd === null || result.trace.window.end > windowEnd) {
      windowEnd = result.trace.window.end;
    }
    eventCount += result.evidence.summary.event_count;
    errorCount += result.evidence.summary.error_count;
    chainCount += result.evidence.summary.chain_count;
    toolCallCount += result.evidence.summary.tool_call_count;
    llmCallCount += result.evidence.summary.llm_call_count;
    embeddingCount += result.evidence.summary.embedding_count;
    vectorOpCount += result.evidence.summary.vector_op_count;
    evidenceItems.push(...result.evidence.evidence);
    anomalies.push(...result.anomalies);
    retrievalSignals.push(...result.evidence.retrieval_diagnosis.signals);
    chainStepSignals.push(...result.evidence.chain_step_diagnosis.signals);
    chainStepTree.push(...result.evidence.chain_step_diagnosis.step_tree);
    graphNodes.push(...result.evidence.evidence_graph.nodes);
    graphEdges.push(...result.evidence.evidence_graph.edges);
    telemetryFailures.push(...result.evidence.telemetry_health.recent_failures);
    telemetryGaps.push(...result.evidence.telemetry_health.gaps);
    whatChanged.push(...result.evidence.what_changed);
    redactionApplied = result.evidence.redaction_applied;
  }

  evidenceItems.sort((a, b) => b.relevance_score - a.relevance_score);

  const evidence: EvidenceObject = {
    trace_id: `incident:${sinceIso}`,
    generated_at: new Date().toISOString(),
    summary: {
      services: Array.from(services),
      deployment_ids: Array.from(deploymentIds),
      window: {
        start: windowStart ?? sinceIso,
        end: windowEnd ?? new Date().toISOString(),
      },
      event_count: eventCount,
      error_count: errorCount,
      chain_count: chainCount,
      tool_call_count: toolCallCount,
      llm_call_count: llmCallCount,
      embedding_count: embeddingCount,
      vector_op_count: vectorOpCount,
    },
    anomalies,
    evidence: evidenceItems.slice(0, maxEvidenceItems),
    redaction_applied: redactionApplied,
    retrieval_diagnosis: {
      detected: retrievalSignals.length > 0,
      layer: "retrieval",
      signals: retrievalSignals,
      summary:
        retrievalSignals.length > 0
          ? `${retrievalSignals.length} retrieval signal(s) across ${traceIds.length} trace(s)`
          : null,
    },
    chain_step_diagnosis: {
      detected: chainStepSignals.length > 0,
      layer: "chain_step",
      signals: chainStepSignals,
      step_tree: chainStepTree,
      summary:
        chainStepSignals.length > 0
          ? `${chainStepSignals.length} chain step signal(s) across ${traceIds.length} trace(s)`
          : null,
    },
    evidence_graph: {
      nodes: Array.from(new Map(graphNodes.map((n) => [n.id, n])).values()),
      edges: Array.from(
        new Map(graphEdges.map((e) => [`${e.from}|${e.to}|${e.type}`, e])).values(),
      ),
    },
    telemetry_health: {
      dropped_event_count: telemetryFailures.length,
      recent_failures: Array.from(
        new Map(telemetryFailures.map((f) => [f.id, f])).values(),
      ),
      gaps: Array.from(
        new Map(telemetryGaps.map((g) => [`${g.service}|${g.start}|${g.end}`, g])).values(),
      ),
    },
    what_changed: Array.from(
      new Map(
        whatChanged.map((c) => [`${c.service}|${c.to_deployment_id}|${c.detected_at}`, c]),
      ).values(),
    ).sort((a, b) => b.relevance_score - a.relevance_score),
  };

  return {
    window: evidence.summary.window,
    trace_ids: traceIds,
    evidence,
    confidence: assessConfidence(evidence),
  };
}
