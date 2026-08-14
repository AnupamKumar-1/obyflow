import { Event } from "../event-model/event.schema.js";
import { SqliteStore, rowToEvent } from "../storage/sqlite-store.js";
import { computeTimeWindow, isWithinWindow, TimeWindow } from "./join-keys.js";

export interface CorrelatedTrace {
  trace_id: string;
  services: string[];
  deployment_ids: string[];
  window: TimeWindow;
  events: Event[];
  logs: Event[];
  metrics: Event[];
  errors: Event[];
  chains: Event[];
  tool_calls: Event[];
  llm_calls: Event[];
  embeddings: Event[];
  vector_ops: Event[];
}

const DEFAULT_WINDOW_PADDING_MS = 5000;

export function correlateTrace(
  store: SqliteStore,
  traceId: string,
  windowPaddingMs: number = DEFAULT_WINDOW_PADDING_MS,
): CorrelatedTrace {
  const directEvents = store.getByTraceId(traceId).map(rowToEvent);

  if (directEvents.length === 0) {
    const now = new Date().toISOString();
    return {
      trace_id: traceId,
      services: [],
      deployment_ids: [],
      window: { start: now, end: now },
      events: [],
      logs: [],
      metrics: [],
      errors: [],
      chains: [],
      tool_calls: [],
      llm_calls: [],
      embeddings: [],
      vector_ops: [],
    };
  }

  const services = Array.from(new Set(directEvents.map((e) => e.service)));
  const deploymentIds = Array.from(
    new Set(
      directEvents
        .map((e) => e.deployment_id)
        .filter((id): id is string => id !== null),
    ),
  );
  const window = computeTimeWindow(directEvents, windowPaddingMs);

  const merged = new Map<string, Event>();
  for (const event of directEvents) {
    merged.set(event.id, event);
  }

  for (const service of services) {
    const rows = store.getByServiceWindow(service, window.start, window.end);
    for (const row of rows) {
      const event = rowToEvent(row);
      if (isWithinWindow(event.timestamp, window)) {
        merged.set(event.id, event);
      }
    }
  }

  const events = Array.from(merged.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const byType = (type: Event["type"]) => events.filter((e) => e.type === type);

  return {
    trace_id: traceId,
    services,
    deployment_ids: deploymentIds,
    window,
    events,
    logs: byType("log"),
    metrics: byType("metric"),
    errors: events.filter((e) => e.severity === "error" || e.severity === "critical"),
    chains: byType("chain"),
    tool_calls: byType("tool_call"),
    llm_calls: byType("llm_call"),
    embeddings: byType("embedding"),
    vector_ops: byType("vector_op"),
  };
}