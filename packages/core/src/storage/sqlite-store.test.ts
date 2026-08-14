import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore, rowToEvent } from "./sqlite-store.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: overrides.id ?? "evt_1",
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? "trace_1",
    request_id: overrides.request_id ?? "req_1",
    service: overrides.service ?? "checkout-service",
    host: overrides.host ?? "host1",
    container: overrides.container ?? "c1",
    deployment_id: overrides.deployment_id ?? "deploy_1",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? 100,
    attributes: overrides.attributes ?? { route: "/checkout" },
    severity: overrides.severity ?? "info",
  };
}

describe("SqliteStore", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("inserts and retrieves an event by trace_id", () => {
    store.insert(makeEvent());
    const rows = store.getByTraceId("trace_1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("evt_1");
  });

  it("round-trips attributes as JSON via rowToEvent", () => {
    store.insert(
      makeEvent({ id: "evt_json", attributes: { nested: { a: 1, b: [1, 2, 3] } } }),
    );
    const [row] = store.getByTraceId("trace_1");
    const event = rowToEvent(row);
    expect(event.attributes).toEqual({ nested: { a: 1, b: [1, 2, 3] } });
  });

  it("returns events for a trace ordered by timestamp ascending", () => {
    const t0 = new Date(Date.now() - 2000).toISOString();
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();

    store.insert(makeEvent({ id: "e2", timestamp: t2 }));
    store.insert(makeEvent({ id: "e0", timestamp: t0 }));
    store.insert(makeEvent({ id: "e1", timestamp: t1 }));

    const rows = store.getByTraceId("trace_1");
    expect(rows.map((r) => r.id)).toEqual(["e0", "e1", "e2"]);
  });

  it("isolates events across different trace_ids", () => {
    store.insert(makeEvent({ id: "a1", trace_id: "trace_a" }));
    store.insert(makeEvent({ id: "b1", trace_id: "trace_b" }));

    expect(store.getByTraceId("trace_a")).toHaveLength(1);
    expect(store.getByTraceId("trace_b")).toHaveLength(1);
    expect(store.getByTraceId("trace_c")).toHaveLength(0);
  });

  it("supports batched insertMany inside a single transaction", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ id: `bulk_${i}`, trace_id: "trace_bulk" }),
    );
    store.insertMany(events);
    expect(store.getByTraceId("trace_bulk")).toHaveLength(50);
  });

  it("rolls back the whole batch if one insert in insertMany fails", () => {
    const events = [
      makeEvent({ id: "dup", trace_id: "trace_rollback" }),
      makeEvent({ id: "dup", trace_id: "trace_rollback" }), // duplicate id -> should fail
    ];
    expect(() => store.insertMany(events)).toThrow();
    // because the transaction rolled back, neither row should be present
    expect(store.getByTraceId("trace_rollback")).toHaveLength(0);
  });

  it("queries by service, optionally filtered by a since timestamp", () => {
    const older = new Date(Date.now() - 10_000).toISOString();
    const newer = new Date().toISOString();

    store.insert(
      makeEvent({ id: "svc_old", service: "payment-service", timestamp: older, trace_id: "t_old" }),
    );
    store.insert(
      makeEvent({ id: "svc_new", service: "payment-service", timestamp: newer, trace_id: "t_new" }),
    );

    expect(store.getByService("payment-service")).toHaveLength(2);

    const since = new Date(Date.now() - 5000).toISOString();
    const filtered = store.getByService("payment-service", since);
    expect(filtered.map((r) => r.id)).toEqual(["svc_new"]);
  });

  it("enforces primary key uniqueness on id", () => {
    store.insert(makeEvent({ id: "unique_1" }));
    expect(() => store.insert(makeEvent({ id: "unique_1" }))).toThrow();
  });
});