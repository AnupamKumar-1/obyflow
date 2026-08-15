import { describe, it, expect, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import { summarizeIncident, findIncidentTraceIds } from "./summarize.js";
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

describe("findIncidentTraceIds", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("returns an empty array when there are no errors", () => {
    store = new SqliteStore(":memory:");
    const result = findIncidentTraceIds(store, new Date(0).toISOString());
    expect(result).toEqual([]);
  });

  it("orders trace ids by error count, most severe first", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({ id: "e1", type: "error", trace_id: "t1", severity: "error", timestamp: new Date(base).toISOString() }),
    );
    store.insert(
      makeEvent({ id: "e2", type: "error", trace_id: "t2", severity: "error", timestamp: new Date(base + 10).toISOString() }),
    );
    store.insert(
      makeEvent({ id: "e3", type: "error", trace_id: "t2", severity: "critical", timestamp: new Date(base + 20).toISOString() }),
    );

    const result = findIncidentTraceIds(store, new Date(base - 1000).toISOString());
    expect(result).toEqual(["t2", "t1"]);
  });
});

describe("summarizeIncident", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("returns an empty-shaped summary with LOW confidence when no error traces are found", () => {
    store = new SqliteStore(":memory:");
    const result = summarizeIncident(store, new Date(0).toISOString());
    expect(result.trace_ids).toEqual([]);
    expect(result.evidence.evidence).toHaveLength(0);
    expect(result.confidence.tier).toBe("LOW");
  });

  it("aggregates evidence and anomalies across multiple traces in the window", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    store.insert(
      makeEvent({
        id: "t1-error",
        type: "error",
        trace_id: "t1",
        service: "checkout-service",
        severity: "error",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "t2-error",
        type: "error",
        trace_id: "t2",
        service: "payment-service",
        severity: "critical",
        timestamp: new Date(base + 10).toISOString(),
      }),
    );

    const result = summarizeIncident(store, new Date(base - 1000).toISOString());

    expect(result.trace_ids.sort()).toEqual(["t1", "t2"]);
    expect(result.evidence.summary.services.sort()).toEqual(["checkout-service", "payment-service"]);
    expect(result.evidence.evidence.length).toBeGreaterThan(0);
  });

  it("respects maxTraces and maxIncidentEvidenceItems", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();

    for (let i = 0; i < 4; i += 1) {
      store.insert(
        makeEvent({
          id: `err-${i}`,
          type: "error",
          trace_id: `t${i}`,
          service: "checkout-service",
          severity: "error",
          timestamp: new Date(base + i).toISOString(),
        }),
      );
    }

    const result = summarizeIncident(store, new Date(base - 1000).toISOString(), {
      maxTraces: 2,
      maxIncidentEvidenceItems: 1,
    });

    expect(result.trace_ids).toHaveLength(2);
    expect(result.evidence.evidence).toHaveLength(1);
  });
});
