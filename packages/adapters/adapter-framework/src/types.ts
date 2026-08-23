import type { Event } from "@obyflow/core";

export type FrameworkName = "langchain" | "langgraph" | "llamaindex" | "custom";

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
  getSpanId?: () => string | null;
}

export interface ChainRunDetails {
  framework: FrameworkName;
  runId: string;
  parentRunId?: string | null;
  chainName?: string | null;
  graphNode?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  status: "success" | "error";
  latencyMs?: number | null;
}

export interface ToolCallDetails {
  runId: string;
  parentRunId?: string | null;
  toolName: string;
  argsPreview?: string | null;
  resultPreview?: string | null;
  status: "success" | "error";
  latencyMs?: number | null;
}

export interface LlmCallDetails {
  runId: string;
  parentRunId?: string | null;
  model: string;
  provider: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  stopReason?: string | null;
  status: "success" | "error";
  latencyMs?: number | null;
}

/**
 * A run tree node tracked between a *Start and *End/*Error callback so the
 * emitted event carries an accurate duration and the run_id/parent_run_id
 * linkage LangChain provides, even though Obyflow's canonical Event Model
 * only records completed spans (see packages/adapters/adapter-vectordb for
 * the equivalent "time then emit once" pattern used elsewhere in the SDKs).
 */
export interface TrackedRun {
  kind: "chain" | "tool_call" | "llm_call";
  startedAtMs: number;
  parentRunId: string | null;
  name: string | null;
  /** Extra run-kind-specific metadata captured at *Start (e.g. LLM model/provider). */
  meta?: Record<string, unknown>;
}
