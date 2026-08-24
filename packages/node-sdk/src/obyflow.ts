import { randomUUID } from "node:crypto";
import { SqliteStore, rowToEvent } from "@obyflow/core";
import { validateEvent } from "@obyflow/core";
import type { Event, EventType } from "@obyflow/core";
import {
  configExists,
  loadConfig,
  resolveConfigPath,
  DEFAULT_REDACTION_CONFIG,
} from "@obyflow/core";
import type { RedactionConfig } from "@obyflow/core";
import { instrumentHttp } from "./instrumentation/http.js";
import { instrumentOutboundHttp } from "./instrumentation/outbound-http.js";
import {
  instrumentPinecone,
  instrumentQdrant,
  instrumentWeaviate,
  instrumentChroma,
  instrumentPgVector,
  instrumentMilvus,
  instrumentOpenAIEmbeddings,
  instrumentAnthropicEmbeddings,
  instrumentCohereEmbeddings,
} from "./instrumentation/vectordb.js";
import { instrumentLangChain } from "./instrumentation/langchain.js";
import type {
  CreateLangChainCallbackHandlerOptions,
  LangChainCallbackHandlerMethods,
} from "@obyflow/adapter-framework";
import type { ResourceAttributesInput } from "./resource-attributes.js";

export interface ObyflowStartOptions {
  service: string;
  dbPath?: string;
  deploymentId?: string | null;
  redaction?: RedactionConfig;
  resourceAttributes?: ResourceAttributesInput;
}

export interface ObyflowVectorInstrumentation {
  pinecone: <T extends Record<string, any>>(index: T, collection?: string | null) => T;
  qdrant: <T extends Record<string, any>>(client: T) => T;
  weaviate: <T extends Record<string, any>>(client: T) => T;
  chroma: <T extends Record<string, any>>(collection: T, collectionName?: string | null) => T;
  pgvector: <T extends { query: (...args: any[]) => any }>(client: T) => T;
  milvus: <T extends Record<string, any>>(client: T) => T;
  openaiEmbeddings: <T extends { embeddings: { create: (...args: any[]) => any } }>(client: T) => T;
  anthropicEmbeddings: <T extends { embeddings: { create: (...args: any[]) => any } }>(client: T) => T;
  cohereEmbeddings: <T extends { embed: (...args: any[]) => any }>(client: T) => T;
  langchain: (options?: CreateLangChainCallbackHandlerOptions) => LangChainCallbackHandlerMethods;
}

export interface ObyflowHandle {
  store: SqliteStore;
  emit: (partial: Omit<Event, "id" | "timestamp"> & { id?: string; timestamp?: string }) => Event;
  getTrace: (traceId: string) => Event[];
  instrument: ObyflowVectorInstrumentation;
  stop: () => void;
}

function resolveRedactionConfig(explicit?: RedactionConfig): RedactionConfig {
  if (explicit) return explicit;
  try {
    const path = resolveConfigPath(process.cwd());
    if (configExists(path)) {
      const config = loadConfig(path);
      return config.redaction;
    }
  } catch {
    return DEFAULT_REDACTION_CONFIG;
  }
  return DEFAULT_REDACTION_CONFIG;
}

export function start(options: ObyflowStartOptions): ObyflowHandle {
  const redaction = resolveRedactionConfig(options.redaction);
  const store = new SqliteStore(options.dbPath ?? "obyflow.db", redaction);

  instrumentHttp({
    service: options.service,
    store,
    deploymentId: options.deploymentId ?? null,
    resourceAttributes: options.resourceAttributes,
  });

  instrumentOutboundHttp({
    service: options.service,
    store,
    deploymentId: options.deploymentId ?? null,
    resourceAttributes: options.resourceAttributes,
  });

  const vectorOptions = {
    service: options.service,
    store,
    deploymentId: options.deploymentId ?? null,
    resourceAttributes: options.resourceAttributes,
  };

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

  const instrument: ObyflowVectorInstrumentation = {
    pinecone: (index, collection) => instrumentPinecone(index, vectorOptions, collection),
    qdrant: (client) => instrumentQdrant(client, vectorOptions),
    weaviate: (client) => instrumentWeaviate(client, vectorOptions),
    chroma: (collection, collectionName) => instrumentChroma(collection, vectorOptions, collectionName),
    pgvector: (client) => instrumentPgVector(client, vectorOptions),
    milvus: (client) => instrumentMilvus(client, vectorOptions),
    openaiEmbeddings: (client) => instrumentOpenAIEmbeddings(client, vectorOptions),
    anthropicEmbeddings: (client) => instrumentAnthropicEmbeddings(client, vectorOptions),
    cohereEmbeddings: (client) => instrumentCohereEmbeddings(client, vectorOptions),
    langchain: (handlerOptions) => instrumentLangChain(vectorOptions, handlerOptions),
  };

  return { store, emit, getTrace, instrument, stop };
}

export type { EventType };
