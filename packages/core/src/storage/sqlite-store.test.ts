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

  describe("getRecent", () => {
    it("returns events across all traces/services ordered newest first", () => {
      const t0 = new Date(Date.now() - 3000).toISOString();
      const t1 = new Date(Date.now() - 2000).toISOString();
      const t2 = new Date(Date.now() - 1000).toISOString();

      store.insert(makeEvent({ id: "r0", timestamp: t0, trace_id: "trace_x" }));
      store.insert(makeEvent({ id: "r1", timestamp: t1, trace_id: "trace_y" }));
      store.insert(makeEvent({ id: "r2", timestamp: t2, trace_id: "trace_z" }));

      const rows = store.getRecent();
      expect(rows.map((r) => r.id)).toEqual(["r2", "r1", "r0"]);
    });

    it("filters by type", () => {
      store.insert(makeEvent({ id: "trace_ev", type: "trace" }));
      store.insert(makeEvent({ id: "log_ev", type: "log" }));

      const rows = store.getRecent({ type: "log" });
      expect(rows.map((r) => r.id)).toEqual(["log_ev"]);
    });

    it("filters by service", () => {
      store.insert(makeEvent({ id: "svc_a", service: "service-a" }));
      store.insert(makeEvent({ id: "svc_b", service: "service-b" }));

      const rows = store.getRecent({ service: "service-b" });
      expect(rows.map((r) => r.id)).toEqual(["svc_b"]);
    });

    it("filters by sinceIso", () => {
      const old = new Date(Date.now() - 100_000).toISOString();
      const recent = new Date().toISOString();

      store.insert(makeEvent({ id: "old_one", timestamp: old }));
      store.insert(makeEvent({ id: "recent_one", timestamp: recent }));

      const since = new Date(Date.now() - 5000).toISOString();
      const rows = store.getRecent({ sinceIso: since });
      expect(rows.map((r) => r.id)).toEqual(["recent_one"]);
    });

    it("respects the limit option and defaults to 50", () => {
      const events = Array.from({ length: 60 }, (_, i) =>
        makeEvent({ id: `bulk_${i}`, trace_id: `trace_${i}` }),
      );
      store.insertMany(events);

      expect(store.getRecent()).toHaveLength(50);
      expect(store.getRecent({ limit: 5 })).toHaveLength(5);
    });

    it("combines multiple filters together", () => {
      store.insert(
        makeEvent({ id: "match", type: "error", service: "payment-service" }),
      );
      store.insert(
        makeEvent({ id: "wrong_type", type: "log", service: "payment-service" }),
      );
      store.insert(
        makeEvent({ id: "wrong_service", type: "error", service: "other-service" }),
      );

      const rows = store.getRecent({ type: "error", service: "payment-service" });
      expect(rows.map((r) => r.id)).toEqual(["match"]);
    });
  });
});