import { randomUUID } from "node:crypto";
import { validateEvent } from "@obyflow/core";
import type { SqliteStore, Event } from "@obyflow/core";
import type {
  CreateLangChainCallbackHandlerOptions,
  InstrumentationContext,
  LangChainCallbackHandlerMethods,
} from "@obyflow/adapter-framework";
import { createLangChainCallbackHandler } from "@obyflow/adapter-framework";
import { getActiveTraceId, getActiveRequestId } from "../context.js";

export interface LangChainInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
}

function buildContext(options: LangChainInstrumentationOptions): InstrumentationContext {
  return {
    service: options.service,
    deploymentId: options.deploymentId ?? null,
    getTraceId: getActiveTraceId,
    getRequestId: getActiveRequestId,
    emit: (partial) => {
      const traceId = getActiveTraceId();

      // Instrumentation outside an Obyflow trace is intentionally ignored.
      // The canonical event model requires trace_id for nested events.
      if (!traceId) return;

      const candidate = {
        id: partial.id ?? randomUUID(),
        timestamp: partial.timestamp ?? new Date().toISOString(),
        ...partial,
        trace_id: traceId,
      };
      const event: Event = validateEvent(candidate);
      options.store.insert(event);
      return event;
    },
  };
}

/**
 * Returns a LangChain.js-compatible callback handler (FR11). Pass it via
 * `{ callbacks: [handler] }` on a chain/agent `.invoke()`/`.stream()` call,
 * or register it as a global handler, so chain/tool/retriever/LLM-call steps
 * are captured with zero manual span creation and joined to the request's
 * active `trace_id`/`request_id` (set by `instrumentHttp` via
 * `runWithTraceContext`) the same way vector DB and embedding calls are.
 */
export function instrumentLangChain(
  options: LangChainInstrumentationOptions,
  handlerOptions?: CreateLangChainCallbackHandlerOptions,
): LangChainCallbackHandlerMethods {
  return createLangChainCallbackHandler(buildContext(options), handlerOptions);
}
