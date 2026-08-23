import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  traceId: string;
  requestId: string;
  spanId?: string | null;
  parentSpanId?: string | null;
}

interface StoredTraceContext {
  traceId: string;
  requestId: string;
  spanId: string | null;
  parentSpanId: string | null;
}

const storage = new AsyncLocalStorage<StoredTraceContext>();

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  const normalized: StoredTraceContext = {
    traceId: context.traceId,
    requestId: context.requestId,
    spanId: context.spanId ?? null,
    parentSpanId: context.parentSpanId ?? null,
  };
  return storage.run(normalized, fn);
}

export function getActiveTraceContext(): StoredTraceContext | null {
  return storage.getStore() ?? null;
}

export function getActiveTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

export function getActiveRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

export function getActiveSpanId(): string | null {
  return storage.getStore()?.spanId ?? null;
}

export function getActiveParentSpanId(): string | null {
  return storage.getStore()?.parentSpanId ?? null;
}
