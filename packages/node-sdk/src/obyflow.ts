import { randomUUID } from "node:crypto";
import { SqliteStore, rowToEvent } from "@obyflow/core";
import { validateEvent } from "@obyflow/core";
import type { Event, EventType } from "@obyflow/core";
import { instrumentHttp } from "./instrumentation/http.js";

export interface ObyflowStartOptions {
  service: string;
  dbPath?: string;
  deploymentId?: string | null;
}

export interface ObyflowHandle {
  store: SqliteStore;
  emit: (partial: Omit<Event, "id" | "timestamp"> & { id?: string; timestamp?: string }) => Event;
  getTrace: (traceId: string) => Event[];
  stop: () => void;
}

export function start(options: ObyflowStartOptions): ObyflowHandle {
  const store = new SqliteStore(options.dbPath ?? "obyflow.db");

  instrumentHttp({
    service: options.service,
    store,
    deploymentId: options.deploymentId ?? null,
  });

  function emit(
    partial: Omit<Event, "id" | "timestamp"> & { id?: string; timestamp?: string },
  ): Event {
    const candidate = {
      id: partial.id ?? randomUUID(),
      timestamp: partial.timestamp ?? new Date().toISOString(),
      ...partial,
    };
    const event = validateEvent(candidate);
    store.insert(event);
    return event;
  }

  function getTrace(traceId: string): Event[] {
    return store.getByTraceId(traceId).map(rowToEvent);
  }

  function stop(): void {
    store.close();
  }

  return { store, emit, getTrace, stop };
}

export type { EventType };