import { randomUUID } from "node:crypto";
import {
  ChainRunDetails,
  InstrumentationContext,
  LlmCallDetails,
  ToolCallDetails,
  TrackedRun,
} from "./types.js";

const PREVIEW_MAX_CHARS = 500;

/**
 * Renders an arbitrary value into a short, safe-to-store preview string.
 * Previews are diagnostic breadcrumbs (e.g. "what did this chain step see"),
 * not a substitute for full payload capture — they are intentionally
 * truncated so a single run never blows up event/storage size, and so a
 * chatty tool result doesn't dominate an Evidence Object built later from
 * these events (see packages/core/src/evidence/build-evidence.ts).
 */
export function toPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, PREVIEW_MAX_CHARS)}…`;
}

/**
 * Tracks in-flight LangChain/LangGraph/LlamaIndex runs by run_id so the
 * matching *End/*Error callback can compute duration_ms and recover the
 * parent_run_id. Framework callback managers guarantee a *Start fires before
 * the matching *End/*Error for the same run_id, but do not guarantee runs
 * complete in nesting order (siblings interleave), so this must be keyed by
 * run_id rather than a stack.
 */
export class RunTracker {
  private readonly runs = new Map<string, TrackedRun>();

  start(runId: string, run: TrackedRun): void {
    this.runs.set(runId, run);
  }

  /** Ends a run, returning its tracked data (and elapsed ms) if known. */
  end(runId: string): { run: TrackedRun; latencyMs: number } | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    this.runs.delete(runId);
    return { run, latencyMs: Date.now() - run.startedAtMs };
  }

  /** Number of runs currently tracked as in-flight. Exposed for tests. */
  get size(): number {
    return this.runs.size;
  }
}

export function emitChainEvent(ctx: InstrumentationContext, details: ChainRunDetails): void {
  ctx.emit({
    type: "chain",
    trace_id: ctx.getTraceId ? ctx.getTraceId() : null,
    span_id: randomUUID(),
    parent_span_id: ctx.getSpanId ? ctx.getSpanId() : null,
    request_id: ctx.getRequestId ? ctx.getRequestId() : null,
    service: ctx.service,
    host: null,
    container: null,
    deployment_id: ctx.deploymentId ?? null,
    duration_ms: details.latencyMs ?? null,
    severity: details.status === "error" ? "error" : null,
    attributes: {
      framework: details.framework,
      chain_name: details.chainName ?? null,
      graph_node: details.graphNode ?? null,
      run_id: details.runId,
      parent_run_id: details.parentRunId ?? null,
      input_preview: details.inputPreview ?? null,
      output_preview: details.outputPreview ?? null,
      status: details.status,
    },
  });
}

export function emitToolCallEvent(ctx: InstrumentationContext, details: ToolCallDetails): void {
  ctx.emit({
    type: "tool_call",
    trace_id: ctx.getTraceId ? ctx.getTraceId() : null,
    span_id: randomUUID(),
    parent_span_id: ctx.getSpanId ? ctx.getSpanId() : null,
    request_id: ctx.getRequestId ? ctx.getRequestId() : null,
    service: ctx.service,
    host: null,
    container: null,
    deployment_id: ctx.deploymentId ?? null,
    duration_ms: details.latencyMs ?? null,
    severity: details.status === "error" ? "error" : null,
    attributes: {
      tool_name: details.toolName,
      args_preview: details.argsPreview ?? null,
      result_preview: details.resultPreview ?? null,
      status: details.status,
      run_id: details.runId,
      parent_run_id: details.parentRunId ?? null,
    },
  });
}

export function emitLlmCallEvent(ctx: InstrumentationContext, details: LlmCallDetails): void {
  ctx.emit({
    type: "llm_call",
    trace_id: ctx.getTraceId ? ctx.getTraceId() : null,
    span_id: randomUUID(),
    parent_span_id: ctx.getSpanId ? ctx.getSpanId() : null,
    request_id: ctx.getRequestId ? ctx.getRequestId() : null,
    service: ctx.service,
    host: null,
    container: null,
    deployment_id: ctx.deploymentId ?? null,
    duration_ms: details.latencyMs ?? null,
    severity: details.status === "error" ? "error" : null,
    attributes: {
      model: details.model,
      provider: details.provider,
      prompt_tokens: details.promptTokens ?? null,
      completion_tokens: details.completionTokens ?? null,
      latency_ms: details.latencyMs ?? null,
      stop_reason: details.stopReason ?? null,
      status: details.status,
      run_id: details.runId,
      parent_run_id: details.parentRunId ?? null,
    },
  });
}
