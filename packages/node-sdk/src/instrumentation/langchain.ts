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
  if (!options || !options.store || typeof options.store.insert !== "function") {
    throw new TypeError("instrumentLangChain() requires an options object with a valid store");
  }

  return {
    service: options.service,
    deploymentId: options.deploymentId ?? null,
    getTraceId: getActiveTraceId,
    getRequestId: getActiveRequestId,
    emit: (partial) => {
      const activeTraceId = getActiveTraceId();

      const candidate = {
        id: partial.id ?? randomUUID(),
        timestamp: partial.timestamp ?? new Date().toISOString(),
        ...partial,
        trace_id: activeTraceId ?? partial.trace_id ?? randomUUID(),
      };
      const event: Event = validateEvent(candidate);
      options.store.insert(event);
      return event;
    },
  };
}

export function instrumentLangChain(
  options: LangChainInstrumentationOptions,
  handlerOptions?: CreateLangChainCallbackHandlerOptions,
): LangChainCallbackHandlerMethods {
  return createLangChainCallbackHandler(buildContext(options), handlerOptions);
}
