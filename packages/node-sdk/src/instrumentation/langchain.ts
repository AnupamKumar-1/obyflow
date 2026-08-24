import { randomUUID } from "node:crypto";
import { validateEvent } from "@obyflow/core";
import type { SqliteStore, Event } from "@obyflow/core";
import type {
  CreateLangChainCallbackHandlerOptions,
  InstrumentationContext,
  LangChainCallbackHandlerMethods,
} from "@obyflow/adapter-framework";
import { createLangChainCallbackHandler } from "@obyflow/adapter-framework";
import { getActiveTraceId, getActiveRequestId, getActiveSpanId } from "../context.js";
import { resolveResourceAttributes, ResourceAttributesInput } from "../resource-attributes.js";

export interface LangChainInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
  resourceAttributes?: ResourceAttributesInput;
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
    getSpanId: getActiveSpanId,
    emit: (partial) => {
      const activeTraceId = getActiveTraceId();

      const candidate = {
        id: partial.id ?? randomUUID(),
        timestamp: partial.timestamp ?? new Date().toISOString(),
        resource_attributes: resolveResourceAttributes(options.resourceAttributes),
        ...partial,
        trace_id: activeTraceId ?? partial.trace_id ?? randomUUID(),
      };
      const event: Event = validateEvent(candidate);
      try {
        options.store.insert(event);
      } catch (err) {
        options.store.recordTelemetryFailure({
          operation: "langchain.insert",
          service: options.service,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
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
