import http from "node:http";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { SqliteStore } from "@obyflow/core";
import type { Event } from "@obyflow/core";
import { runWithTraceContext } from "../context.js";

interface HttpInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
}

let patched = false;
let activeOptions: HttpInstrumentationOptions | null = null;
const originalEmit = http.Server.prototype.emit;

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function instrumentHttp(options: HttpInstrumentationOptions): void {
  if (!options || !options.store || typeof options.store.insert !== "function") {
    throw new TypeError("instrumentHttp() requires an options object with a valid store");
  }

  activeOptions = options;

  if (patched) return;
  patched = true;

  http.Server.prototype.emit = function (this: http.Server, event: string, ...args: unknown[]) {
    if (event !== "request") {
      return originalEmit.apply(this, [event, ...args] as unknown as Parameters<typeof originalEmit>);
    }

    const req = args[0] as http.IncomingMessage;
    const res = args[1] as http.ServerResponse;

    const traceId = headerValue(req.headers["x-obyflow-trace-id"]) || randomUUID();
    const requestId = randomUUID();
    const spanId = randomUUID();
    const parentSpanId = headerValue(req.headers["x-obyflow-parent-span-id"]);
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    res.on("finish", () => {
      const currentOptions = activeOptions;
      if (!currentOptions) return;

      const durationMs = Date.now() - startedAt;
      const traceEvent: Event = {
        id: randomUUID(),
        type: "trace",
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: parentSpanId,
        request_id: requestId,
        service: currentOptions.service,
        host: null,
        container: null,
        deployment_id: currentOptions.deploymentId ?? null,
        timestamp,
        duration_ms: durationMs,
        attributes: {
          method: req.method ?? null,
          url: req.url ?? null,
          status_code: res.statusCode,
        },
        resource_attributes: {
          hostname: os.hostname(),
          pid: process.pid,
          node_version: process.version,
        },
        severity: res.statusCode >= 500 ? "error" : "info",
      };

      try {
        currentOptions.store.insert(traceEvent);
      } catch (err) {
        currentOptions.store.recordTelemetryFailure({
          operation: "http.trace_event",
          service: currentOptions.service,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return runWithTraceContext({ traceId, requestId, spanId, parentSpanId }, () =>
      originalEmit.apply(this, [event, ...args] as unknown as Parameters<typeof originalEmit>),
    );
  };
}

export function _resetHttpInstrumentationForTests(): void {
  http.Server.prototype.emit = originalEmit;
  patched = false;
  activeOptions = null;
}
