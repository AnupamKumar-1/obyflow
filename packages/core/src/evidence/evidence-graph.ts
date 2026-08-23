import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace, SpanNode } from "../correlation/correlate.js";
import { AnomalyResult } from "../anomaly/baseline.js";

export type EvidenceEdgeType = "CALLED" | "FAILED" | "CAUSED" | "AFFECTED";

export interface EvidenceGraphNode {
  id: string;
  type: Event["type"];
  service: string;
  severity: Event["severity"];
  timestamp: string;
  in_evidence: boolean;
}

export interface EvidenceGraphEdge {
  from: string;
  to: string;
  type: EvidenceEdgeType;
  reason: string;
}

export interface EvidenceGraph {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
}

const AFFECTED_WINDOW_MS = 5000;

function isFailedEvent(event: Event): boolean {
  if (event.severity === "error" || event.severity === "critical") return true;
  if (event.type === "tool_call" && event.attributes?.["status"] === "error") return true;
  if (event.type === "chain" && event.attributes?.["status"] === "error") return true;
  return false;
}

function anomalyMatchesEvent(event: Event, anomaly: AnomalyResult): boolean {
  if (event.service !== anomaly.service) return false;
  if (anomaly.metric === "duration_ms") return event.duration_ms !== null;
  if (anomaly.metric === "error_rate") {
    return event.severity === "error" || event.severity === "critical";
  }
  if (anomaly.metric.startsWith("metric:")) {
    const metricName = anomaly.metric.slice("metric:".length);
    return event.type === "metric" && event.attributes?.["name"] === metricName;
  }
  return false;
}

function timeOf(event: Event): number {
  return new Date(event.timestamp).getTime();
}

function walkSpanTree(
  nodes: SpanNode[],
  parentId: string | null,
  edges: EvidenceGraphEdge[],
  parentOf: Map<string, string>,
): void {
  for (const node of nodes) {
    if (parentId) {
      edges.push({
        from: parentId,
        to: node.event.id,
        type: "CALLED",
        reason: "parent span invoked child span",
      });
      parentOf.set(node.event.id, parentId);
    }
    walkSpanTree(node.children, node.event.id, edges, parentOf);
  }
}

function addChainRunIdEdges(
  events: Event[],
  edges: EvidenceGraphEdge[],
  parentOf: Map<string, string>,
): void {
  const chainEvents = events.filter((e) => e.type === "chain");
  const byRunId = new Map<string, Event>();
  for (const event of chainEvents) {
    const runId = event.attributes?.["run_id"];
    if (typeof runId === "string") byRunId.set(runId, event);
  }
  for (const event of chainEvents) {
    if (parentOf.has(event.id)) continue;
    const parentRunId = event.attributes?.["parent_run_id"];
    if (typeof parentRunId !== "string") continue;
    const parentEvent = byRunId.get(parentRunId);
    if (!parentEvent || parentEvent.id === event.id) continue;
    edges.push({
      from: parentEvent.id,
      to: event.id,
      type: "CALLED",
      reason: "parent chain step invoked child chain step",
    });
    parentOf.set(event.id, parentEvent.id);
  }
}

function addFailurePropagationEdges(
  events: Event[],
  edges: EvidenceGraphEdge[],
  parentOf: Map<string, string>,
): void {
  for (const event of events) {
    if (!isFailedEvent(event)) continue;
    const parentId = parentOf.get(event.id);
    if (!parentId) continue;
    edges.push({
      from: event.id,
      to: parentId,
      type: "FAILED",
      reason: `${event.service} ${event.type} failed, propagating failure to its caller`,
    });
  }
}

function addAnomalyCausationEdges(
  events: Event[],
  anomalies: AnomalyResult[],
  edges: EvidenceGraphEdge[],
): void {
  const anomalous = anomalies.filter((a) => a.is_anomalous);
  for (const anomaly of anomalous) {
    const matching = events
      .filter((e) => anomalyMatchesEvent(e, anomaly))
      .sort((a, b) => timeOf(a) - timeOf(b));
    if (matching.length === 0) continue;
    const trigger = matching[0];
    for (const event of events) {
      if (event.id === trigger.id) continue;
      if (event.service !== anomaly.service) continue;
      if (!isFailedEvent(event)) continue;
      if (timeOf(event) < timeOf(trigger)) continue;
      edges.push({
        from: trigger.id,
        to: event.id,
        type: "CAUSED",
        reason: `anomalous ${anomaly.metric} on ${anomaly.service} precedes this failure`,
      });
    }
  }
}

function addCrossServiceAffectedEdges(
  events: Event[],
  edges: EvidenceGraphEdge[],
  parentOf: Map<string, string>,
): void {
  const failing = events.filter(isFailedEvent);
  for (const errorEvent of failing) {
    for (const other of events) {
      if (other.id === errorEvent.id) continue;
      if (other.service === errorEvent.service) continue;
      if (parentOf.get(other.id) === errorEvent.id) continue;
      if (parentOf.get(errorEvent.id) === other.id) continue;
      if (timeOf(other) < timeOf(errorEvent)) continue;

      const sameDeployment =
        errorEvent.deployment_id !== null && errorEvent.deployment_id === other.deployment_id;
      const withinWindow = timeOf(other) - timeOf(errorEvent) <= AFFECTED_WINDOW_MS;
      if (!sameDeployment && !withinWindow) continue;

      edges.push({
        from: errorEvent.id,
        to: other.id,
        type: "AFFECTED",
        reason: sameDeployment
          ? `same deployment as a failing ${errorEvent.service} event`
          : `occurs within the failure window of ${errorEvent.service}`,
      });
    }
  }
}

export function buildEvidenceGraph(
  trace: CorrelatedTrace,
  anomalies: AnomalyResult[],
  evidenceIds: Set<string>,
): EvidenceGraph {
  const nodes: EvidenceGraphNode[] = trace.events.map((event) => ({
    id: event.id,
    type: event.type,
    service: event.service,
    severity: event.severity,
    timestamp: event.timestamp,
    in_evidence: evidenceIds.has(event.id),
  }));

  const edges: EvidenceGraphEdge[] = [];
  const parentOf = new Map<string, string>();

  walkSpanTree(trace.span_tree, null, edges, parentOf);
  addChainRunIdEdges(trace.events, edges, parentOf);
  addFailurePropagationEdges(trace.events, edges, parentOf);
  addAnomalyCausationEdges(trace.events, anomalies, edges);
  addCrossServiceAffectedEdges(trace.events, edges, parentOf);

  return { nodes, edges };
}
