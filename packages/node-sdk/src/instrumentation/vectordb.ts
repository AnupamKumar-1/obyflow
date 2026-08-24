import { randomUUID } from "node:crypto";
import { validateEvent } from "@obyflow/core";
import type { SqliteStore, Event } from "@obyflow/core";
import type { InstrumentationContext } from "@obyflow/adapter-vectordb";
import {
  instrumentPineconeIndex,
  instrumentQdrantClient,
  instrumentWeaviateClient,
  instrumentChromaCollection,
  instrumentPgVectorClient,
  instrumentMilvusClient,
  instrumentOpenAIEmbeddingsClient,
  instrumentAnthropicEmbeddingsClient,
  instrumentCohereEmbeddingsClient,
} from "@obyflow/adapter-vectordb";
import { getActiveTraceId, getActiveRequestId, getActiveSpanId } from "../context.js";
import { resolveResourceAttributes, ResourceAttributesInput } from "../resource-attributes.js";

export interface VectorDbInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
  resourceAttributes?: ResourceAttributesInput;
}

function assertValidOptions(
  options: VectorDbInstrumentationOptions,
  fnName: string,
): void {
  if (!options || typeof options !== "object") {
    throw new TypeError(
      `${fnName}() requires an options object of shape { service, store, deploymentId? } as its second argument`,
    );
  }
  if (!options.store || typeof options.store.insert !== "function") {
    throw new TypeError(
      `${fnName}() requires options.store to be a valid SqliteStore instance (got ${typeof options.store}). ` +
        `Pass the same options object used with start(), e.g. instrumentChroma(collection, { service, store })`,
    );
  }
  if (!options.service || typeof options.service !== "string") {
    throw new TypeError(`${fnName}() requires options.service to be a non-empty string`);
  }
}

function buildContext(options: VectorDbInstrumentationOptions): InstrumentationContext {
  return {
    service: options.service,
    deploymentId: options.deploymentId ?? null,
    getTraceId: getActiveTraceId,
    getRequestId: getActiveRequestId,
    getSpanId: getActiveSpanId,
    emit: (partial) => {
      const candidate = {
        id: partial.id ?? randomUUID(),
        timestamp: partial.timestamp ?? new Date().toISOString(),
        resource_attributes: resolveResourceAttributes(options.resourceAttributes),
        ...partial,
      };
      const event: Event = validateEvent(candidate);
      try {
        options.store.insert(event);
      } catch (err) {
        options.store.recordTelemetryFailure({
          operation: "vectordb.insert",
          service: options.service,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      return event;
    },
  };
}

export function instrumentPinecone<T extends Record<string, any>>(
  index: T,
  options: VectorDbInstrumentationOptions,
  collection: string | null = null,
): T {
  assertValidOptions(options, "instrumentPinecone");
  return instrumentPineconeIndex(index, buildContext(options), collection);
}

export function instrumentQdrant<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  assertValidOptions(options, "instrumentQdrant");
  return instrumentQdrantClient(client, buildContext(options));
}

export function instrumentWeaviate<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  assertValidOptions(options, "instrumentWeaviate");
  return instrumentWeaviateClient(client, buildContext(options));
}

export function instrumentChroma<T extends Record<string, any>>(
  collection: T,
  options: VectorDbInstrumentationOptions,
  collectionName: string | null = null,
): T {
  assertValidOptions(options, "instrumentChroma");
  return instrumentChromaCollection(collection, buildContext(options), collectionName);
}

export function instrumentPgVector<T extends { query: (...args: any[]) => any }>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  assertValidOptions(options, "instrumentPgVector");
  return instrumentPgVectorClient(client, buildContext(options));
}

export function instrumentMilvus<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  assertValidOptions(options, "instrumentMilvus");
  return instrumentMilvusClient(client, buildContext(options));
}

export function instrumentOpenAIEmbeddings<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, options: VectorDbInstrumentationOptions): T {
  assertValidOptions(options, "instrumentOpenAIEmbeddings");
  return instrumentOpenAIEmbeddingsClient(client, buildContext(options));
}

export function instrumentAnthropicEmbeddings<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, options: VectorDbInstrumentationOptions): T {
  assertValidOptions(options, "instrumentAnthropicEmbeddings");
  return instrumentAnthropicEmbeddingsClient(client, buildContext(options));
}

export function instrumentCohereEmbeddings<T extends { embed: (...args: any[]) => any }>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  assertValidOptions(options, "instrumentCohereEmbeddings");
  return instrumentCohereEmbeddingsClient(client, buildContext(options));
}
