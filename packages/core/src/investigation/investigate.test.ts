import { describe, it, expect, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import { investigateTrace, findMostSevereTraceInWindow } from "./investigate.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? null,
    request_id: overrides.request_id ?? null,
    service: overrides.service ?? "checkout-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    severity: overrides.severity ?? null,
  };
}

describe("investigateTrace", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("returns an empty-shaped investigation when the trace has no events", () => {
    store = new SqliteStore(":memory:");
    const result = investigateTrace(store, "missing-trace");
    expect(result.trace.events).toHaveLength(0);
    expect(result.evidence.evidence).toHaveLength(0);
    expect(result.confidence.tier).toBe("LOW");
    expect(result.confidence.score).toBe(0);
  });

  it("assembles trace, anomalies, evidence, and confidence for a simple trace", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    store.insert(
      makeEvent({
        id: "e1",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        timestamp: new Date(base).toISOString(),
        duration_ms: 120,
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        type: "error",
        trace_id: "t1",
        service: "checkout-service",
        severity: "error",
        timestamp: new Date(base + 50).toISOString(),
      }),
    );

    const result = investigateTrace(store, "t1");

    expect(result.trace.trace_id).toBe("t1");
    expect(result.trace.events.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    expect(result.evidence.trace_id).toBe("t1");
    expect(result.evidence.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.evidence[0].severity).toBe("error");
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(result.confidence.tier);
  });

  it("runs anomaly detection per correlated service using the baseline lookback window", () => {
    store = new SqliteStore(":memory:");
    const windowMs = 60 * 1000;
    const baselineBuckets = 3;
    const base = Date.now();

    for (let i = baselineBuckets; i >= 1; i -= 1) {
      store.insert(
        makeEvent({
          id: `baseline-${i}`,
          type: "trace",
          trace_id: null,
          service: "checkout-service",
          timestamp: new Date(base - i * windowMs).toISOString(),
          duration_ms: 100,
        }),
      );
    }

    store.insert(
      makeEvent({
        id: "spike",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        timestamp: new Date(base).toISOString(),
        duration_ms: 9000,
      }),
    );

    const result = investigateTrace(store, "t1", {
      anomalyOptions: {
        windowMs,
        baselineBuckets,
        minBaselineBuckets: 2,
      },
    });

    const latencyAnomaly = result.anomalies.find(
      (a) => a.metric === "duration_ms" && a.service === "checkout-service",
    );
    expect(latencyAnomaly).toBeDefined();
    expect(latencyAnomaly?.is_anomalous).toBe(true);
    expect(latencyAnomaly?.insufficient_data).toBe(false);
  });

  it("respects an explicit baselineLookbackMs override", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "too-far",
        type: "trace",
        trace_id: null,
        service: "checkout-service",
        timestamp: new Date(base - 10 * 60 * 60 * 1000).toISOString(),
        duration_ms: 50,
      }),
    );
    store.insert(
      makeEvent({
        id: "t1-event",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        timestamp: new Date(base).toISOString(),
        duration_ms: 50,
      }),
    );

    const result = investigateTrace(store, "t1", { baselineLookbackMs: 1000 });
    const latencyAnomaly = result.anomalies.find(
      (a) => a.metric === "duration_ms" && a.service === "checkout-service",
    );
    expect(latencyAnomaly?.baseline.count).toBe(0);
  });

  it("passes evidenceOptions through to the evidence builder", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      store.insert(
        makeEvent({
          id: `e${i}`,
          type: "trace",
          trace_id: "t1",
          service: "checkout-service",
          timestamp: new Date(base + i).toISOString(),
          duration_ms: i * 10,
        }),
      );
    }

    const result = investigateTrace(store, "t1", {
      evidenceOptions: { maxEvidenceItems: 2 },
    });
    expect(result.evidence.evidence).toHaveLength(2);
  });

  it("widens the correlation window when windowPaddingMs is increased", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    store.insert(
      makeEvent({
        id: "t1-event",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "nearby-log",
        type: "log",
        trace_id: null,
        service: "checkout-service",
        timestamp: new Date(base + 5000).toISOString(),
      }),
    );

    const narrow = investigateTrace(store, "t1", { windowPaddingMs: 100 });
    const wide = investigateTrace(store, "t1", { windowPaddingMs: 10000 });

    expect(narrow.trace.events.map((e) => e.id)).not.toContain("nearby-log");
    expect(wide.trace.events.map((e) => e.id)).toContain("nearby-log");
  });
});

describe("findMostSevereTraceInWindow", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("returns null when there are no errors", () => {
    store = new SqliteStore(":memory:");
    const result = findMostSevereTraceInWindow(store, new Date(0).toISOString());
    expect(result).toBeNull();
  });

  it("returns null when errors exist but none carry a trace_id", () => {
    store = new SqliteStore(":memory:");
    store.insert(
      makeEvent({
        id: "e1",
        type: "error",
        trace_id: null,
        severity: "error",
        timestamp: new Date().toISOString(),
      }),
    );
    const result = findMostSevereTraceInWindow(store, new Date(0).toISOString());
    expect(result).toBeNull();
  });

  it("picks the trace with the most errors in the window", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "e1",
        type: "error",
        trace_id: "t1",
        severity: "error",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        type: "error",
        trace_id: "t1",
        severity: "critical",
        timestamp: new Date(base + 10).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e3",
        type: "error",
        trace_id: "t2",
        severity: "error",
        timestamp: new Date(base + 20).toISOString(),
      }),
    );

    const result = findMostSevereTraceInWindow(store, new Date(base - 1000).toISOString());
    expect(result).toBe("t1");
  });

  it("filters by service when provided", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "e1",
        type: "error",
        trace_id: "t1",
        service: "checkout-service",
        severity: "error",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        type: "error",
        trace_id: "t2",
        service: "payment-service",
        severity: "error",
        timestamp: new Date(base + 10).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e3",
        type: "error",
        trace_id: "t2",
        service: "payment-service",
        severity: "error",
        timestamp: new Date(base + 20).toISOString(),
      }),
    );

    const result = findMostSevereTraceInWindow(
      store,
      new Date(base - 1000).toISOString(),
      "checkout-service",
    );
    expect(result).toBe("t1");
  });

  it("ignores errors before the since timestamp", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "old",
        type: "error",
        trace_id: "old-trace",
        severity: "error",
        timestamp: new Date(base - 10 * 60 * 1000).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "recent",
        type: "error",
        trace_id: "recent-trace",
        severity: "error",
        timestamp: new Date(base).toISOString(),
      }),
    );

    const result = findMostSevereTraceInWindow(store, new Date(base - 1000).toISOString());
    expect(result).toBe("recent-trace");
  });
});
