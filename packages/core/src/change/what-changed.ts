import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace } from "../correlation/correlate.js";
import { AnomalyResult } from "../anomaly/baseline.js";

export type ChangeType = "deployment";

export interface ChangeEvent {
  type: ChangeType;
  service: string;
  from_deployment_id: string | null;
  to_deployment_id: string;
  detected_at: string;
  ms_before_incident_window: number;
  correlated_anomaly_count: number;
  relevance_score: number;
  reason: string;
}

const RECENT_CHANGE_WINDOW_MS = 5 * 60 * 1000;

function lastDeploymentBefore(
  events: Event[],
  service: string,
  beforeMs: number,
): string | null {
  let latest: Event | null = null;
  let latestMs = -Infinity;
  for (const event of events) {
    if (event.service !== service) continue;
    if (!event.deployment_id) continue;
    const t = new Date(event.timestamp).getTime();
    if (t >= beforeMs) continue;
    if (t > latestMs) {
      latest = event;
      latestMs = t;
    }
  }
  return latest?.deployment_id ?? null;
}

function firstDeploymentInWindow(
  events: Event[],
  service: string,
): { deployment_id: string; timestamp: string } | null {
  let earliest: Event | null = null;
  let earliestMs = Infinity;
  for (const event of events) {
    if (event.service !== service) continue;
    if (!event.deployment_id) continue;
    const t = new Date(event.timestamp).getTime();
    if (t < earliestMs) {
      earliest = event;
      earliestMs = t;
    }
  }
  if (!earliest) return null;
  return { deployment_id: earliest.deployment_id as string, timestamp: earliest.timestamp };
}

export function detectWhatChanged(
  trace: CorrelatedTrace,
  historicalEvents: Event[],
  anomalies: AnomalyResult[],
): ChangeEvent[] {
  const windowStartMs = new Date(trace.window.start).getTime();
  const changes: ChangeEvent[] = [];

  for (const service of trace.services) {
    const previous = lastDeploymentBefore(historicalEvents, service, windowStartMs);
    const current = firstDeploymentInWindow(trace.events, service);
    if (!current) continue;
    if (current.deployment_id === previous) continue;

    const detectedAtMs = new Date(current.timestamp).getTime();
    const msBeforeIncidentWindow = Math.max(0, windowStartMs - detectedAtMs);
    const relatedAnomalies = anomalies.filter(
      (anomaly) => anomaly.service === service && anomaly.is_anomalous,
    );

    let score = previous === null ? 1 : 2;
    score += relatedAnomalies.length;
    if (msBeforeIncidentWindow <= RECENT_CHANGE_WINDOW_MS) score += 1;

    const reason = previous
      ? `${service} redeployed (${previous} -> ${current.deployment_id}) shortly before the incident window`
      : `${service} started emitting telemetry under a new deployment (${current.deployment_id}) with no prior deployment on record`;

    changes.push({
      type: "deployment",
      service,
      from_deployment_id: previous,
      to_deployment_id: current.deployment_id,
      detected_at: current.timestamp,
      ms_before_incident_window: msBeforeIncidentWindow,
      correlated_anomaly_count: relatedAnomalies.length,
      relevance_score: score,
      reason,
    });
  }

  changes.sort((a, b) => b.relevance_score - a.relevance_score);
  return changes;
}
