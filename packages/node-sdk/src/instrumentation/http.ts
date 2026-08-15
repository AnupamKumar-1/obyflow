import http from "node:http";
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
let originalEmit: typeof http.Server.prototype.emit | null = null;

export function instrumentHttp(options: HttpInstrumentationOptions): void {
  if (!options || !options.store || typeof options.store.insert !== "function") {
    throw new TypeError("instrumentHttp() requires an options object with a valid store");
  }

  activeOptions = options;

  if (patched) return;
  patched = true;

  originalEmit = http.Server.prototype.emit;

  http.Server.prototype.emit = function (event: string, ...args: unknown[]) {
    if (event !== "request") {
      return originalEmit.apply(this, [event, ...args] as unknown as Parameters<typeof originalEmit>);
    }

    const req = args[0] as http.IncomingMessage;
    const res = args[1] as http.ServerResponse;

    const traceId = (req.headers["x-obyflow-trace-id"] as string) || randomUUID();
    const requestId = randomUUID();
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
        severity: res.statusCode >= 500 ? "error" : "info",
      };

      try {
        currentOptions.store.insert(traceEvent);
      } catch {
        // Ignore telemetry persistence failures.
      }
    });

    return runWithTraceContext({ traceId, requestId }, () =>
      originalEmit.apply(this, [event, ...args] as unknown as Parameters<typeof originalEmit>),
    );
  };
}

export function _resetHttpInstrumentationForTests(): void {
  if (originalEmit) {
    http.Server.prototype.emit = originalEmit;
  }

  originalEmit = null;
  patched = false;
  activeOptions = null;
}
