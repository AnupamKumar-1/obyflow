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
import { getActiveTraceId, getActiveRequestId } from "../context.js";

export interface VectorDbInstrumentationOptions {
  service: string;
  store: SqliteStore;
  deploymentId?: string | null;
}

function buildContext(options: VectorDbInstrumentationOptions): InstrumentationContext {
  return {
    service: options.service,
    deploymentId: options.deploymentId ?? null,
    getTraceId: getActiveTraceId,
    getRequestId: getActiveRequestId,
    emit: (partial) => {
      const candidate = {
        id: partial.id ?? randomUUID(),
        timestamp: partial.timestamp ?? new Date().toISOString(),
        ...partial,
      };
      const event: Event = validateEvent(candidate);
      options.store.insert(event);
      return event;
    },
  };
}

export function instrumentPinecone<T extends Record<string, any>>(
  index: T,
  options: VectorDbInstrumentationOptions,
  collection: string | null = null,
): T {
  return instrumentPineconeIndex(index, buildContext(options), collection);
}

export function instrumentQdrant<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  return instrumentQdrantClient(client, buildContext(options));
}

export function instrumentWeaviate<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  return instrumentWeaviateClient(client, buildContext(options));
}

export function instrumentChroma<T extends Record<string, any>>(
  collection: T,
  options: VectorDbInstrumentationOptions,
  collectionName: string | null = null,
): T {
  return instrumentChromaCollection(collection, buildContext(options), collectionName);
}

export function instrumentPgVector<T extends { query: (...args: any[]) => any }>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  return instrumentPgVectorClient(client, buildContext(options));
}

export function instrumentMilvus<T extends Record<string, any>>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  return instrumentMilvusClient(client, buildContext(options));
}

export function instrumentOpenAIEmbeddings<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, options: VectorDbInstrumentationOptions): T {
  return instrumentOpenAIEmbeddingsClient(client, buildContext(options));
}

export function instrumentAnthropicEmbeddings<
  T extends { embeddings: { create: (...args: any[]) => any } },
>(client: T, options: VectorDbInstrumentationOptions): T {
  return instrumentAnthropicEmbeddingsClient(client, buildContext(options));
}

export function instrumentCohereEmbeddings<T extends { embed: (...args: any[]) => any }>(
  client: T,
  options: VectorDbInstrumentationOptions,
): T {
  return instrumentCohereEmbeddingsClient(client, buildContext(options));
}
