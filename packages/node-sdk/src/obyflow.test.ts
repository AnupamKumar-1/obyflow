import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { start } from "./obyflow.js";
import { _resetHttpInstrumentationForTests } from "./instrumentation/http.js";

function request(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
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

describe("obyflow.start() + http auto-instrumentation", () => {
  afterEach(() => {
    _resetHttpInstrumentationForTests();
  });

  it("captures a real trace event for a real http request", async () => {
    const handle = start({ service: "test-service", dbPath: ":memory:" });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await request(port, "/checkout?id=123");
    expect(response.status).toBe(200);
    expect(response.body).toBe("ok");

    await new Promise((resolve) => setTimeout(resolve, 20));

    const rows = handle.store.getByService("test-service");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("trace");

    const attrs = JSON.parse(rows[0].attributes);
    expect(attrs.method).toBe("GET");
    expect(attrs.url).toBe("/checkout?id=123");
    expect(attrs.status_code).toBe(200);
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    handle.stop();
  });

  it("marks 5xx responses as severity error", async () => {
    const handle = start({ service: "error-service", dbPath: ":memory:" });

    const server = http.createServer((req, res) => {
      res.writeHead(500);
      res.end("boom");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    await request(port, "/fail");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const rows = handle.store.getByService("error-service");
    expect(rows[0].severity).toBe("error");

    await new Promise<void>((resolve) => server.close(() => resolve()));
    handle.stop();
  });

  it("propagates an incoming x-obyflow-trace-id header instead of generating a new one", async () => {
    const handle = start({ service: "propagate-service", dbPath: ":memory:" });

    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const incomingTraceId = "trace_fixed_123";
    await request(port, "/whatever", { "x-obyflow-trace-id": incomingTraceId });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const events = handle.getTrace(incomingTraceId);
    expect(events).toHaveLength(1);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    handle.stop();
  });

  it("emit() lets callers record custom events validated against the schema", () => {
    const handle = start({ service: "manual-service", dbPath: ":memory:" });

    const event = handle.emit({
      type: "llm_call",
      trace_id: "trace_manual",
      request_id: null,
      service: "manual-service",
      host: null,
      container: null,
      deployment_id: null,
      duration_ms: 900,
      attributes: {
        model: "claude-sonnet-5",
        provider: "anthropic",
        prompt_tokens: 200,
        completion_tokens: 50,
      },
      severity: "info",
    });

    expect(event.type).toBe("llm_call");
    const fetched = handle.getTrace("trace_manual");
    expect(fetched).toHaveLength(1);

    handle.stop();
  });

  it("emit() rejects an invalid event instead of silently storing it", () => {
    const handle = start({ service: "reject-service", dbPath: ":memory:" });

    expect(() =>
      handle.emit({
        type: "vector_op",
        trace_id: "trace_bad",
        request_id: null,
        service: "reject-service",
        host: null,
        container: null,
        deployment_id: null,
        duration_ms: 10,
        attributes: { operation: "not_real", db_provider: "pinecone" },
        severity: null,
      }),
    ).toThrow();

    handle.stop();
  });
});