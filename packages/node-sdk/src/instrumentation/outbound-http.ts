import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import type { SqliteStore } from "@obyflow/core";
import type { Event } from "@obyflow/core";
import { getActiveTraceContext } from "../context.js";
import { resolveResourceAttributes, ResourceAttributesInput } from "../resource-attributes.js";

export interface OutboundHttpInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
  resourceAttributes?: ResourceAttributesInput;
}

let patched = false;
let activeOptions: OutboundHttpInstrumentationOptions | null = null;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
let originalFetch: typeof fetch | null = null;

function emitOutboundEvent(
  method: string,
  url: string,
  statusCode: number | null,
  durationMs: number,
  error: Error | null,
  traceId: string | null,
  requestId: string | null,
  spanId: string,
  parentSpanId: string | null,
): void {
  const options = activeOptions;
  if (!options) return;

  const severity =
    error !== null
      ? "error"
      : statusCode !== null && statusCode >= 500
        ? "error"
        : statusCode !== null && statusCode >= 400
          ? "warn"
          : "info";

  const event: Event = {
    id: randomUUID(),
    type: "trace",
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parentSpanId,
    request_id: requestId,
    service: options.service,
    host: null,
    container: null,
    deployment_id: options.deploymentId ?? null,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    attributes: {
      method,
      url,
      status_code: statusCode,
      direction: "outbound",
      error: error ? error.message : null,
    },
    resource_attributes: resolveResourceAttributes(options.resourceAttributes),
    severity,
  };

  try {
    options.store.insert(event);
  } catch (err) {
    options.store.recordTelemetryFailure({
      operation: "outbound_http.trace_event",
      service: options.service,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function wrapRequestFn(
  original: typeof http.request,
): typeof http.request {
  return function patchedRequest(this: unknown, ...args: unknown[]): http.ClientRequest {
    const req = (original as (...a: unknown[]) => http.ClientRequest).apply(this, args);
    const context = getActiveTraceContext();
    if (!context) {
      return req;
    }

    const spanId = randomUUID();
    const parentSpanId = context.spanId ?? null;
    const traceId = context.traceId;
    const requestId = context.requestId;

    req.setHeader("x-obyflow-trace-id", context.traceId);
    req.setHeader("x-obyflow-parent-span-id", spanId);

    const startedAt = Date.now();
    let method = "GET";
    let url = "";
    try {
      method = (req.method as string) ?? "GET";
      const protocol = req.protocol ?? "http:";
      const host = req.getHeader("host") ?? req.host ?? "";
      url = `${protocol}//${host}${req.path ?? ""}`;
    } catch {
      url = "";
    }

    req.on("response", (res: http.IncomingMessage) => {
      const durationMs = Date.now() - startedAt;
      emitOutboundEvent(
        method,
        url,
        res.statusCode ?? null,
        durationMs,
        null,
        traceId,
        requestId,
        spanId,
        parentSpanId,
      );
    });

    req.on("error", (err: Error) => {
      const durationMs = Date.now() - startedAt;
      emitOutboundEvent(
        method,
        url,
        null,
        durationMs,
        err,
        traceId,
        requestId,
        spanId,
        parentSpanId,
      );
    });

    return req;
  } as typeof http.request;
}

function wrapFetch(original: typeof fetch): typeof fetch {
  return async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const context = getActiveTraceContext();
    if (!context) {
      return original(input, init);
    }

    const spanId = randomUUID();
    const parentSpanId = context.spanId ?? null;
    const traceId = context.traceId;
    const requestId = context.requestId;

    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const startedAt = Date.now();

    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    headers.set("x-obyflow-trace-id", context.traceId);
    headers.set("x-obyflow-parent-span-id", spanId);

    try {
      const response = await original(input, { ...init, headers });
      const durationMs = Date.now() - startedAt;
      emitOutboundEvent(
        method,
        url,
        response.status,
        durationMs,
        null,
        traceId,
        requestId,
        spanId,
        parentSpanId,
      );
      return response;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      emitOutboundEvent(
        method,
        url,
        null,
        durationMs,
        err instanceof Error ? err : new Error(String(err)),
        traceId,
        requestId,
        spanId,
        parentSpanId,
      );
      throw err;
    }
  };
}

export function instrumentOutboundHttp(options: OutboundHttpInstrumentationOptions): void {
  if (!options || !options.store || typeof options.store.insert !== "function") {
    throw new TypeError("instrumentOutboundHttp() requires an options object with a valid store");
  }

  activeOptions = options;

  if (patched) return;
  patched = true;

  http.request = wrapRequestFn(originalHttpRequest);
  https.request = wrapRequestFn(originalHttpsRequest);

  if (typeof globalThis.fetch === "function") {
    originalFetch = globalThis.fetch;
    globalThis.fetch = wrapFetch(originalFetch);
  }
}

export function _resetOutboundHttpInstrumentationForTests(): void {
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  patched = false;
  activeOptions = null;
}
