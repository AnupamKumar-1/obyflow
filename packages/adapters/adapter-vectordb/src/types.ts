import type { Event } from "@obyflow/core";

export type VectorDbProvider =
  | "pinecone"
  | "qdrant"
  | "weaviate"
  | "chroma"
  | "pgvector"
  | "milvus"
  | "custom";

export type EmbeddingProvider = "openai" | "anthropic" | "cohere" | "custom";

export type EmittableEvent = Omit<Event, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export type EmitEvent = (partial: EmittableEvent) => Event | void;

export interface InstrumentationContext {
  service: string;
  deploymentId?: string | null;
  emit: EmitEvent;
  getTraceId?: () => string | null;
  getRequestId?: () => string | null;
}

export interface VectorOpDetails {
  operation: "query" | "upsert" | "delete";
  collection?: string | null;
  top_k?: number | null;
  filter?: Record<string, unknown> | null;
  result_count?: number | null;
  similarity_scores?: number[] | null;
  latency_ms?: number | null;
}

export interface EmbeddingDetails {
  model: string;
  input_tokens?: number | null;
  dimensions?: number | null;
  latency_ms?: number | null;
  batch_size?: number | null;
}

export type AsyncMethod = (...args: any[]) => Promise<any>;

export interface PineconeIndexLike {
  query?: AsyncMethod;
  upsert?: AsyncMethod;
  deleteMany?: AsyncMethod;
}

export interface QdrantClientLike {
  search?: AsyncMethod;
  upsert?: AsyncMethod;
  delete?: AsyncMethod;
}

export interface WeaviateClientLike {
  query?: AsyncMethod;
  upsert?: AsyncMethod;
  delete?: AsyncMethod;
}

export interface ChromaCollectionLike {
  name?: string;
  query?: AsyncMethod;
  add?: AsyncMethod;
  delete?: AsyncMethod;
}

export interface MilvusClientLike {
  search?: AsyncMethod;
  insert?: AsyncMethod;
  delete?: AsyncMethod;
}

export interface PgVectorClientLike {
  query: AsyncMethod;
}

export interface EmbeddingsClientLike {
  embeddings: {
    create: AsyncMethod;
  };
}

export interface CohereEmbeddingsClientLike {
  embed: AsyncMethod;
}
