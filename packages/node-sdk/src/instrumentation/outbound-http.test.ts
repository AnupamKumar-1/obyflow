import { describe, it, expect, afterEach, beforeEach } from "vitest";
import http from "node:http";
import { SqliteStore } from "@obyflow/core";
import {
  instrumentOutboundHttp,
  _resetOutboundHttpInstrumentationForTests,
} from "./outbound-http.js";
import { runWithTraceContext } from "../context.js";

describe("node-sdk outbound http instrumentation", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("x-received-trace-id", req.headers["x-obyflow-trace-id"] ?? "");
      res.setHeader("x-received-parent-span-id", req.headers["x-obyflow-parent-span-id"] ?? "");
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    _resetOutboundHttpInstrumentationForTests();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("injects trace and parent-span headers into outgoing requests when a trace context is active", async () => {
    const store = new SqliteStore(":memory:");
    instrumentOutboundHttp({ service: "svc", store });

    let receivedTraceId = "";
    let receivedParentSpanId = "";

    await runWithTraceContext(
      { traceId: "trace-outbound", requestId: "req-outbound", spanId: "span-root" },
      () =>
        new Promise<void>((resolve, reject) => {
          const req = http.request(`${baseUrl}/`, (res) => {
            receivedTraceId = String(res.headers["x-received-trace-id"] ?? "");
            receivedParentSpanId = String(res.headers["x-received-parent-span-id"] ?? "");
            res.on("data", () => {});
            res.on("end", () => resolve());
          });
          req.on("error", reject);
          req.end();
        }),
    );

    expect(receivedTraceId).toBe("trace-outbound");
    expect(receivedParentSpanId).not.toBe("");

    const rows = store.getByTraceId("trace-outbound");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].parent_span_id).toBe("span-root");
    const attrs = JSON.parse(rows[0].attributes as unknown as string);
    expect(attrs.direction).toBe("outbound");
  });

  it("does not inject headers or throw when no trace context is active", async () => {
    const store = new SqliteStore(":memory:");
    instrumentOutboundHttp({ service: "svc", store });

    let receivedTraceId = "set";

    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${baseUrl}/`, (res) => {
        receivedTraceId = String(res.headers["x-received-trace-id"] ?? "");
        res.on("data", () => {});
        res.on("end", () => resolve());
      });
      req.on("error", reject);
      req.end();
    });

    expect(receivedTraceId).toBe("");
  });
});
