import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "./sqlite-store.js";

describe("SqliteStore telemetry failures", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("records and retrieves a telemetry failure", () => {
    store.recordTelemetryFailure({
      operation: "http.trace_event",
      reason: "disk full",
      service: "checkout-service",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const failures = store.getTelemetryFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe("http.trace_event");
    expect(failures[0].reason).toBe("disk full");
    expect(failures[0].service).toBe("checkout-service");
  });

  it("counts failures, optionally scoped by time window and service", () => {
    store.recordTelemetryFailure({
      operation: "vectordb.insert",
      reason: "locked",
      service: "search-service",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    store.recordTelemetryFailure({
      operation: "vectordb.insert",
      reason: "locked",
      service: "search-service",
      timestamp: "2026-01-02T00:00:00.000Z",
    });
    store.recordTelemetryFailure({
      operation: "http.trace_event",
      reason: "locked",
      service: "checkout-service",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(store.getTelemetryFailureCount()).toBe(3);
    expect(store.getTelemetryFailureCount({ service: "search-service" })).toBe(2);
    expect(
      store.getTelemetryFailureCount({ sinceIso: "2026-01-01T12:00:00.000Z" }),
    ).toBe(1);
  });

  it("orders recent failures newest first and respects limit", () => {
    for (let i = 0; i < 5; i++) {
      store.recordTelemetryFailure({
        operation: "http.trace_event",
        reason: `failure ${i}`,
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
      });
    }
    const recent = store.getTelemetryFailures({ limit: 2 });
    expect(recent).toHaveLength(2);
    expect(recent[0].reason).toBe("failure 4");
    expect(recent[1].reason).toBe("failure 3");
  });

  it("never throws even if given odd input", () => {
    expect(() =>
      store.recordTelemetryFailure({ operation: "x", reason: "y", service: undefined }),
    ).not.toThrow();
  });
});
