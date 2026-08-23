import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace } from "../correlation/correlate.js";
import { AnomalyResult } from "../anomaly/baseline.js";

export type ChangeType = "deployment" | "commit" | "config" | "feature_flag" | "model_version" | "dependency";

export interface ChangeEvent {
  type: ChangeType;
  service: string;
  from_deployment_id: string | null;
  to_deployment_id: string;
  from_value: string | null;
  to_value: string;
  detected_at: string;
  ms_before_incident_window: number;
  correlated_anomaly_count: number;
  relevance_score: number;
  reason: string;
}

const RECENT_CHANGE_WINDOW_MS = 5 * 60 * 1000;

interface AttributeChangeSpec {
  type: ChangeType;
  key: string;
  label: string;
}

const ATTRIBUTE_CHANGE_SPECS: AttributeChangeSpec[] = [
  { type: "commit", key: "git_sha", label: "commit" },
  { type: "config", key: "config_hash", label: "config" },
  { type: "feature_flag", key: "feature_flags", label: "feature flag set" },
  { type: "model_version", key: "model_version", label: "model/prompt version" },
  { type: "dependency", key: "dependency_versions", label: "dependency set" },
];

function normalizeAttrValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    if (Array.isArray(value)) {
      return JSON.stringify([...value].sort());
    }
    if (typeof value === "object") {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return JSON.stringify(sorted);
    }
  } catch {
    return null;
  }
  return null;
}

function readAttrValue(event: Event, key: string): string | null {
  const raw = event.resource_attributes ? event.resource_attributes[key] : undefined;
  return normalizeAttrValue(raw);
}

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

function lastAttrValueBefore(
  events: Event[],
  service: string,
  key: string,
  beforeMs: number,
): string | null {
  let latest: Event | null = null;
  let latestMs = -Infinity;
  let latestValue: string | null = null;
  for (const event of events) {
    if (event.service !== service) continue;
    const value = readAttrValue(event, key);
    if (value === null) continue;
    const t = new Date(event.timestamp).getTime();
    if (t >= beforeMs) continue;
    if (t > latestMs) {
      latest = event;
      latestMs = t;
      latestValue = value;
    }
  }
  return latest ? latestValue : null;
}

function firstAttrValueInWindow(
  events: Event[],
  service: string,
  key: string,
): { value: string; timestamp: string } | null {
  let earliest: Event | null = null;
  let earliestMs = Infinity;
  let earliestValue: string | null = null;
  for (const event of events) {
    if (event.service !== service) continue;
    const value = readAttrValue(event, key);
    if (value === null) continue;
    const t = new Date(event.timestamp).getTime();
    if (t < earliestMs) {
      earliest = event;
      earliestMs = t;
      earliestValue = value;
    }
  }
  if (!earliest || earliestValue === null) return null;
  return { value: earliestValue, timestamp: earliest.timestamp };
}

function scoreChange(
  previousExists: boolean,
  service: string,
  detectedAtMs: number,
  windowStartMs: number,
  anomalies: AnomalyResult[],
): { score: number; relatedAnomalies: AnomalyResult[]; msBeforeIncidentWindow: number } {
  const msBeforeIncidentWindow = Math.max(0, windowStartMs - detectedAtMs);
  const relatedAnomalies = anomalies.filter(
    (anomaly) => anomaly.service === service && anomaly.is_anomalous,
  );
  let score = previousExists ? 2 : 1;
  score += relatedAnomalies.length;
  if (msBeforeIncidentWindow <= RECENT_CHANGE_WINDOW_MS) score += 1;
  return { score, relatedAnomalies, msBeforeIncidentWindow };
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
    if (current && current.deployment_id !== previous) {
      const detectedAtMs = new Date(current.timestamp).getTime();
      const { score, relatedAnomalies, msBeforeIncidentWindow } = scoreChange(
        previous !== null,
        service,
        detectedAtMs,
        windowStartMs,
        anomalies,
      );
      const reason = previous
        ? `${service} redeployed (${previous} -> ${current.deployment_id}) shortly before the incident window`
        : `${service} started emitting telemetry under a new deployment (${current.deployment_id}) with no prior deployment on record`;
      changes.push({
        type: "deployment",
        service,
        from_deployment_id: previous,
        to_deployment_id: current.deployment_id,
        from_value: previous,
        to_value: current.deployment_id,
        detected_at: current.timestamp,
        ms_before_incident_window: msBeforeIncidentWindow,
        correlated_anomaly_count: relatedAnomalies.length,
        relevance_score: score,
        reason,
      });
    }

    for (const spec of ATTRIBUTE_CHANGE_SPECS) {
      const combinedHistory = [...historicalEvents, ...trace.events];
      const previousValue = lastAttrValueBefore(combinedHistory, service, spec.key, windowStartMs);
      const currentEntry = firstAttrValueInWindow(trace.events, service, spec.key);
      if (!currentEntry) continue;
      if (currentEntry.value === previousValue) continue;

      const detectedAtMs = new Date(currentEntry.timestamp).getTime();
      const { score, relatedAnomalies, msBeforeIncidentWindow } = scoreChange(
        previousValue !== null,
        service,
        detectedAtMs,
        windowStartMs,
        anomalies,
      );
      const reason = previousValue
        ? `${service} ${spec.label} changed (${previousValue} -> ${currentEntry.value}) shortly before the incident window`
        : `${service} started emitting telemetry with a new ${spec.label} (${currentEntry.value}) with no prior value on record`;

      changes.push({
        type: spec.type,
        service,
        from_deployment_id: null,
        to_deployment_id: currentEntry.value,
        from_value: previousValue,
        to_value: currentEntry.value,
        detected_at: currentEntry.timestamp,
        ms_before_incident_window: msBeforeIncidentWindow,
        correlated_anomaly_count: relatedAnomalies.length,
        relevance_score: score,
        reason,
      });
    }
  }

  changes.sort((a, b) => b.relevance_score - a.relevance_score);
  return changes;
}
