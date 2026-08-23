import { z } from "zod";

export const EventType = z.enum([
  "trace",
  "log",
  "metric",
  "error",
  "embedding",
  "vector_op",
  "chain",
  "tool_call",
  "llm_call",
  "custom",
]);
export type EventType = z.infer<typeof EventType>;

export const Severity = z.enum(["debug", "info", "warn", "error", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const EmbeddingAttributes = z.object({
  model: z.string(),
  input_tokens: z.number().int().nonnegative().nullable().optional(),
  dimensions: z.number().int().positive().nullable().optional(),
  provider: z.string(),
  latency_ms: z.number().nonnegative().nullable().optional(),
  batch_size: z.number().int().positive().nullable().optional(),
});
export type EmbeddingAttributes = z.infer<typeof EmbeddingAttributes>;

export const VectorOpAttributes = z.object({
  operation: z.enum(["query", "upsert", "delete"]),
  db_provider: z.enum([
    "pinecone",
    "qdrant",
    "weaviate",
    "chroma",
    "pgvector",
    "milvus",
    "custom",
  ]),
  collection: z.string().nullable().optional(),
  top_k: z.number().int().positive().nullable().optional(),
  filter: z.record(z.string(), z.any()).nullable().optional(),
  result_count: z.number().int().nonnegative().nullable().optional(),
  similarity_scores: z.array(z.number()).nullable().optional(),
  latency_ms: z.number().nonnegative().nullable().optional(),
});
export type VectorOpAttributes = z.infer<typeof VectorOpAttributes>;

export const ChainAttributes = z.object({
  framework: z.enum(["langchain", "langgraph", "llamaindex", "custom"]),
  chain_name: z.string().nullable().optional(),
  graph_node: z.string().nullable().optional(),
  run_id: z.string(),
  parent_run_id: z.string().nullable().optional(),
  input_preview: z.string().nullable().optional(),
  output_preview: z.string().nullable().optional(),
  status: z.enum(["success", "error"]),
});
export type ChainAttributes = z.infer<typeof ChainAttributes>;

export const ToolCallAttributes = z.object({
  tool_name: z.string(),
  args_preview: z.string().nullable().optional(),
  result_preview: z.string().nullable().optional(),
  status: z.enum(["success", "error"]),
});
export type ToolCallAttributes = z.infer<typeof ToolCallAttributes>;

export const LlmCallAttributes = z.object({
  model: z.string(),
  provider: z.string(),
  prompt_tokens: z.number().int().nonnegative().nullable().optional(),
  completion_tokens: z.number().int().nonnegative().nullable().optional(),
  latency_ms: z.number().nonnegative().nullable().optional(),
  stop_reason: z.string().nullable().optional(),
});
export type LlmCallAttributes = z.infer<typeof LlmCallAttributes>;

export const ResourceAttributes = z.record(z.string(), z.any());
export type ResourceAttributes = z.infer<typeof ResourceAttributes>;

export const EventSchema = z.object({
  id: z.string(),
  type: EventType,
  trace_id: z.string().nullable(),
  span_id: z.string().nullable().optional(),
  parent_span_id: z.string().nullable().optional(),
  request_id: z.string().nullable(),
  service: z.string(),
  host: z.string().nullable(),
  container: z.string().nullable(),
  deployment_id: z.string().nullable(),
  timestamp: z.string().datetime(),
  duration_ms: z.number().nonnegative().nullable(),
  attributes: z.record(z.string(), z.any()),
  resource_attributes: ResourceAttributes.nullable().optional(),
  severity: Severity.nullable(),
});
export type Event = z.infer<typeof EventSchema>;