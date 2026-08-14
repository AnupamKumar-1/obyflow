import { Event } from "../event-model/event.schema.js";

export interface JoinKeys {
  trace_id: string | null;
  request_id: string | null;
  service: string;
  host: string | null;
  container: string | null;
  deployment_id: string | null;
}

export interface TimeWindow {
  start: string;
  end: string;
}

export function extractJoinKeys(event: Event): JoinKeys {
  return {
    trace_id: event.trace_id,
    request_id: event.request_id,
    service: event.service,
    host: event.host,
    container: event.container,
    deployment_id: event.deployment_id,
  };
}

export function computeTimeWindow(events: Event[], paddingMs: number = 0): TimeWindow {
  if (events.length === 0) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  const timestamps = events.map((e) => new Date(e.timestamp).getTime());
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  return {
    start: new Date(minTs - paddingMs).toISOString(),
    end: new Date(maxTs + paddingMs).toISOString(),
  };
}

export function isWithinWindow(timestamp: string, window: TimeWindow): boolean {
  const ts = new Date(timestamp).getTime();
  return ts >= new Date(window.start).getTime() && ts <= new Date(window.end).getTime();
}

export function sameService(a: Event, b: Event): boolean {
  return a.service === b.service;
}

export function sameDeployment(a: Event, b: Event): boolean {
  return a.deployment_id !== null && a.deployment_id === b.deployment_id;
}

export function sameTraceId(a: Event, b: Event): boolean {
  return a.trace_id !== null && a.trace_id === b.trace_id;
}