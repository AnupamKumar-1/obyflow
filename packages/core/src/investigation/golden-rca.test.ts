import { describe, it, expect, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import { investigateTrace } from "./investigate.js";
import type { Event } from "../event-model/event.schema.js";

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

describe("golden RCA scenarios", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("scenario 1: a bad deployment causes a latency spike on a single service", () => {
    store = new SqliteStore(":memory:");
    const windowMs = 60 * 1000;
    const baselineBuckets = 4;
    const base = Date.now();

    for (let i = baselineBuckets; i >= 1; i -= 1) {
      store.insert(
        makeEvent({
          id: `baseline-${i}`,
          type: "trace",
          trace_id: null,
          service: "checkout-service",
          deployment_id: "dep-1",
          timestamp: new Date(base - i * windowMs).toISOString(),
          duration_ms: 100 + i,
        }),
      );
    }

    store.insert(
      makeEvent({
        id: "spike",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        deployment_id: "dep-2",
        timestamp: new Date(base).toISOString(),
        duration_ms: 9000,
      }),
    );

    const result = investigateTrace(store, "t1", {
      anomalyOptions: { windowMs, baselineBuckets, minBaselineBuckets: 2 },
    });

    const latencyAnomaly = result.anomalies.find(
      (a) => a.metric === "duration_ms" && a.service === "checkout-service",
    );
    expect(latencyAnomaly?.is_anomalous).toBe(true);

    expect(result.evidence.what_changed.length).toBeGreaterThan(0);
    const change = result.evidence.what_changed[0];
    expect(change?.service).toBe("checkout-service");
    expect(change?.from_deployment_id).toBe("dep-1");
    expect(change?.to_deployment_id).toBe("dep-2");
    expect(change?.correlated_anomaly_count).toBeGreaterThan(0);

    expect(["HIGH", "MEDIUM"]).toContain(result.confidence.tier);
  });

  it("scenario 2: a cascading failure propagates through a parent/child span tree", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "parent-span",
        type: "trace",
        trace_id: "t2",
        span_id: "span-parent",
        service: "api-gateway",
        timestamp: new Date(base).toISOString(),
        duration_ms: 500,
      }),
    );
    store.insert(
      makeEvent({
        id: "child-span-error",
        type: "error",
        trace_id: "t2",
        span_id: "span-child",
        parent_span_id: "span-parent",
        service: "inventory-service",
        severity: "error",
        timestamp: new Date(base + 50).toISOString(),
        duration_ms: 400,
      }),
    );

    const result = investigateTrace(store, "t2");

    expect(result.trace.correlation_strategy).toBe("span_hierarchy");
    expect(result.evidence.summary.correlation_strategy).toBe("span_hierarchy");

    const causedOrCalledEdge = result.evidence.evidence_graph.edges.find(
      (e) => e.from === "parent-span" && e.to === "child-span-error",
    );
    expect(causedOrCalledEdge).toBeDefined();

    const failedEdge = result.evidence.evidence_graph.edges.find(
      (e) => e.type === "FAILED" && e.from === "child-span-error" && e.to === "parent-span",
    );
    expect(failedEdge).toBeDefined();

    expect(result.confidence.factors.trace_relationship_established).toBe(true);
  });

  it("scenario 3: a quiet, healthy trace should not produce a false positive root cause", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "healthy-baseline",
        type: "trace",
        trace_id: null,
        service: "search-service",
        deployment_id: "dep-1",
        timestamp: new Date(base - 10 * 60 * 1000).toISOString(),
        duration_ms: 78,
      }),
    );
    store.insert(
      makeEvent({
        id: "healthy-1",
        type: "trace",
        trace_id: "t3",
        service: "search-service",
        deployment_id: "dep-1",
        timestamp: new Date(base).toISOString(),
        duration_ms: 80,
      }),
    );
    store.insert(
      makeEvent({
        id: "healthy-2",
        type: "trace",
        trace_id: "t3",
        service: "search-service",
        deployment_id: "dep-1",
        timestamp: new Date(base + 20).toISOString(),
        duration_ms: 75,
      }),
    );

    const result = investigateTrace(store, "t3");

    expect(result.anomalies.every((a) => !a.is_anomalous)).toBe(true);
    expect(result.evidence.what_changed).toHaveLength(0);
    expect(result.evidence.summary.error_count).toBe(0);
    expect(result.confidence.tier).toBe("LOW");
  });

  it("scenario 4: telemetry gaps and dropped events are surfaced instead of hidden", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "before-gap",
        type: "trace",
        trace_id: "t4",
        service: "payments-service",
        timestamp: new Date(base).toISOString(),
        duration_ms: 100,
      }),
    );
    store.insert(
      makeEvent({
        id: "after-gap",
        type: "trace",
        trace_id: "t4",
        service: "payments-service",
        timestamp: new Date(base + 5 * 60 * 1000).toISOString(),
        duration_ms: 120,
      }),
    );
    store.recordTelemetryFailure({
      operation: "ingest",
      reason: "queue backpressure, event dropped",
      service: "payments-service",
      timestamp: new Date(base + 60 * 1000).toISOString(),
    });

    const result = investigateTrace(store, "t4");

    expect(result.evidence.telemetry_health.dropped_event_count).toBeGreaterThan(0);
    expect(result.evidence.telemetry_health.gaps.length).toBeGreaterThan(0);
  });
});
