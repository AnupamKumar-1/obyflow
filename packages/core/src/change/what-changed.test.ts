import { describe, it, expect } from "vitest";
import { detectWhatChanged } from "./what-changed.js";
import type { Event } from "../event-model/event.schema.js";
import type { CorrelatedTrace } from "../correlation/correlate.js";
import type { AnomalyResult } from "../anomaly/baseline.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? null,
    span_id: overrides.span_id ?? null,
    parent_span_id: overrides.parent_span_id ?? null,
    request_id: overrides.request_id ?? null,
    service: overrides.service ?? "checkout-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    resource_attributes: overrides.resource_attributes ?? null,
    severity: overrides.severity ?? null,
  };
}

function makeTrace(events: Event[], windowStart: string, windowEnd: string): CorrelatedTrace {
  return {
    trace_id: "t1",
    services: Array.from(new Set(events.map((e) => e.service))),
    deployment_ids: Array.from(
      new Set(events.map((e) => e.deployment_id).filter((d): d is string => !!d)),
    ),
    window: { start: windowStart, end: windowEnd },
    events,
    logs: [],
    metrics: [],
    errors: [],
    chains: [],
    tool_calls: [],
    llm_calls: [],
    embeddings: [],
    vector_ops: [],
    span_tree: [],
    correlation_strategy: "time_window",
  };
}

describe("detectWhatChanged", () => {
  it("returns no changes when deployment_id is unchanged", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "checkout-service",
        deployment_id: "dep-1",
        timestamp: new Date(base - 600000).toISOString(),
      }),
    ];
    const trace = makeTrace(
      [
        makeEvent({
          service: "checkout-service",
          deployment_id: "dep-1",
          timestamp: new Date(base + 1000).toISOString(),
        }),
      ],
      windowStart,
      windowEnd,
    );

    const changes = detectWhatChanged(trace, historical, []);
    expect(changes).toHaveLength(0);
  });

  it("detects a deployment change shortly before the incident window and ranks it above unrelated changes", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();

    const historical = [
      makeEvent({
        service: "checkout-service",
        deployment_id: "dep-1",
        timestamp: new Date(base - 120000).toISOString(),
      }),
      makeEvent({
        service: "notifications-service",
        deployment_id: "dep-a",
        timestamp: new Date(base - 6 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];

    const trace = makeTrace(
      [
        makeEvent({
          service: "checkout-service",
          deployment_id: "dep-2",
          timestamp: new Date(base + 500).toISOString(),
        }),
        makeEvent({
          service: "notifications-service",
          deployment_id: "dep-b",
          timestamp: new Date(base + 500).toISOString(),
        }),
      ],
      windowStart,
      windowEnd,
    );

    const anomalies: AnomalyResult[] = [
      {
        service: "checkout-service",
        metric: "duration_ms",
        baseline: { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },
        current_value: 900,
        current_count: 5,
        z_score: 5,
        is_anomalous: true,
        severity: "high",
        insufficient_data: false,
        low_sample_size: false,
      },
    ];

    const changes = detectWhatChanged(trace, historical, anomalies);
    expect(changes).toHaveLength(2);
    expect(changes[0]?.service).toBe("checkout-service");
    expect(changes[0]?.from_deployment_id).toBe("dep-1");
    expect(changes[0]?.to_deployment_id).toBe("dep-2");
    expect(changes[0]?.correlated_anomaly_count).toBe(1);
    expect(changes[0]?.relevance_score).toBeGreaterThan(changes[1]?.relevance_score ?? 0);
  });

  it("flags a service with no prior deployment on record", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const trace = makeTrace(
      [
        makeEvent({
          service: "new-service",
          deployment_id: "dep-1",
          timestamp: new Date(base + 500).toISOString(),
        }),
      ],
      windowStart,
      windowEnd,
    );

    const changes = detectWhatChanged(trace, [], []);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.from_deployment_id).toBeNull();
    expect(changes[0]?.reason).toContain("no prior deployment on record");
  });
});
