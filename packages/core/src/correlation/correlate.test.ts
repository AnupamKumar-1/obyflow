import { describe, it, expect, afterEach } from "vitest";
import { SqliteStore } from "../storage/sqlite-store.js";
import { correlateTrace } from "./correlate.js";
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

describe("correlateTrace", () => {
  let store: SqliteStore;

  afterEach(() => {
    store?.close();
  });

  it("returns an empty bundle when the trace has no events", () => {
    store = new SqliteStore(":memory:");
    const result = correlateTrace(store, "missing-trace");
    expect(result.events).toHaveLength(0);
    expect(result.services).toHaveLength(0);
  });

  it("joins direct trace_id events across types", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    store.insert(
      makeEvent({
        id: "e1",
        type: "trace",
        trace_id: "t1",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        type: "error",
        trace_id: "t1",
        severity: "error",
        timestamp: new Date(base + 100).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e3",
        type: "llm_call",
        trace_id: "t1",
        timestamp: new Date(base + 200).toISOString(),
        attributes: { model: "claude-sonnet-5", provider: "anthropic" },
      }),
    );

    const result = correlateTrace(store, "t1");
    expect(result.events.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.errors.map((e) => e.id)).toEqual(["e2"]);
    expect(result.llm_calls.map((e) => e.id)).toEqual(["e3"]);
  });

  it("pulls in logs/metrics without trace_id via service + timestamp window", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    store.insert(
      makeEvent({
        id: "trace1",
        type: "trace",
        trace_id: "t1",
        service: "checkout-service",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "log1",
        type: "log",
        trace_id: null,
        service: "checkout-service",
        timestamp: new Date(base + 500).toISOString(),
        attributes: { message: "processing payment" },
      }),
    );
    store.insert(
      makeEvent({
        id: "log2",
        type: "log",
        trace_id: null,
        service: "unrelated-service",
        timestamp: new Date(base + 500).toISOString(),
        attributes: { message: "unrelated" },
      }),
    );
    store.insert(
      makeEvent({
        id: "log3",
        type: "log",
        trace_id: null,
        service: "checkout-service",
        timestamp: new Date(base + 10 * 60 * 1000).toISOString(),
        attributes: { message: "too far away" },
      }),
    );

    const result = correlateTrace(store, "t1", 1000);
    const ids = result.events.map((e) => e.id);
    expect(ids).toContain("trace1");
    expect(ids).toContain("log1");
    expect(ids).not.toContain("log2");
    expect(ids).not.toContain("log3");
  });

  it("collects distinct services and deployment ids", () => {
    store = new SqliteStore(":memory:");
    const base = Date.now();
    store.insert(
      makeEvent({
        id: "e1",
        type: "trace",
        trace_id: "t1",
        service: "api-gateway",
        deployment_id: "deploy-42",
        timestamp: new Date(base).toISOString(),
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        type: "trace",
        trace_id: "t1",
        service: "payment-service",
        deployment_id: "deploy-42",
        timestamp: new Date(base + 50).toISOString(),
      }),
    );

    const result = correlateTrace(store, "t1");
    expect(result.services.sort()).toEqual(["api-gateway", "payment-service"]);
    expect(result.deployment_ids).toEqual(["deploy-42"]);
  });
});