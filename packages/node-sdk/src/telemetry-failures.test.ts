import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { SqliteStore } from "@obyflow/core";
import { instrumentHttp, _resetHttpInstrumentationForTests } from "./instrumentation/http.js";
import { runWithTraceContext } from "./context.js";

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("node-sdk telemetry failure recording", () => {
  afterEach(() => {
    _resetHttpInstrumentationForTests();
  });

  it("records and lists telemetry failures on the store", () => {
    const store = new SqliteStore(":memory:");

    expect(store.getTelemetryFailureCount()).toBe(0);

    store.recordTelemetryFailure({ operation: "test.op", reason: "boom", service: "checkout" });
    store.recordTelemetryFailure({ operation: "test.op", reason: "boom again", service: "billing" });

    expect(store.getTelemetryFailureCount()).toBe(2);
    expect(store.getTelemetryFailureCount({ service: "checkout" })).toBe(1);

    const failures = store.getTelemetryFailures({ service: "checkout" });
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe("test.op");
    expect(failures[0].reason).toBe("boom");
  });

  it("filters telemetry failures by a since/until time window", () => {
    const store = new SqliteStore(":memory:");

    store.recordTelemetryFailure({
      operation: "old.op",
      reason: "old",
      service: "checkout",
      timestamp: "2020-01-01T00:00:00.000Z",
    });
    store.recordTelemetryFailure({
      operation: "new.op",
      reason: "new",
      service: "checkout",
      timestamp: "2030-01-01T00:00:00.000Z",
    });

    const recent = store.getTelemetryFailures({
      service: "checkout",
      sinceIso: "2025-01-01T00:00:00.000Z",
    });
    expect(recent).toHaveLength(1);
    expect(recent[0].operation).toBe("new.op");
  });

  it("respects the limit option when listing telemetry failures", () => {
    const store = new SqliteStore(":memory:");

    for (let i = 0; i < 5; i += 1) {
      store.recordTelemetryFailure({ operation: `op-${i}`, reason: "boom" });
    }

    expect(store.getTelemetryFailures({ limit: 2 })).toHaveLength(2);
  });

  it("never throws even when the underlying insert fails", () => {
    const store = new SqliteStore(":memory:");
    store.close();

    expect(() =>
      store.recordTelemetryFailure({ operation: "test.op", reason: "boom" }),
    ).not.toThrow();
  });

  it("records a telemetry failure instead of throwing when inbound http event insertion fails", async () => {
    const store = new SqliteStore(":memory:");
    const originalInsert = store.insert.bind(store);
    store.insert = () => {
      throw new Error("disk full");
    };

    instrumentHttp({ service: "checkout", store });

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    await request(port, "/health");
    await new Promise((resolve) => setTimeout(resolve, 20));

    store.insert = originalInsert;
    const failures = store.getTelemetryFailures({ service: "checkout" });
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe("http.trace_event");
    expect(failures[0].reason).toContain("disk full");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("scopes trace context correctly even when telemetry recording fails", async () => {
    const store = new SqliteStore(":memory:");
    store.insert = () => {
      throw new Error("disk full");
    };

    let observedTraceId: string | null = null;
    instrumentHttp({ service: "checkout", store });

    const server = http.createServer((_req, res) => {
      observedTraceId = runWithTraceContext(
        { traceId: "unused", requestId: "unused" },
        () => "trace-context-still-usable",
      );
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    await request(port, "/health");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(observedTraceId).toBe("trace-context-still-usable");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
