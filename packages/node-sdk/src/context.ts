import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  traceId: string;
  requestId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getActiveTraceContext(): TraceContext | null {
  return storage.getStore() ?? null;
}

export function getActiveTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

export function getActiveRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
