import { emitChainEvent, emitLlmCallEvent, emitToolCallEvent, RunTracker, toPreview } from "./shared.js";
import { InstrumentationContext } from "./types.js";

/**
 * Structural subset of LangChain.js's `CallbackHandlerMethods` interface
 * (see langchain-ai/langchainjs `@langchain/core/callbacks/base`). Obyflow
 * intentionally does not import "langchain"/"@langchain/core" as a
 * dependency — LangChain.js accepts any plain object satisfying this method
 * shape when passed via `{ callbacks: [handler] }`, so re-declaring the
 * subset we use keeps this package dependency-free while still producing a
 * handler that is a structurally valid LangChain callback handler.
 *
 * Signatures intentionally use loose/untyped parameters (`any`) for the
 * framework-supplied payloads (serialized chain/tool/LLM descriptors, raw
 * LangChain outputs, chat message objects, etc.) because their concrete
 * shape is defined by whichever LangChain.js version the host application
 * has installed, not by Obyflow — this mirrors how adapter-vectordb's
 * `*ClientLike` interfaces stay loosely typed for the same reason.
 */
export interface LangChainCallbackHandlerMethods {
  name: string;
  handleChainStart(
    chain: { id?: string[]; name?: string },
    inputs: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    name?: string,
  ): void | Promise<void>;
  handleChainEnd(outputs: unknown, runId: string, parentRunId?: string): void | Promise<void>;
  handleChainError(err: unknown, runId: string, parentRunId?: string): void | Promise<void>;

  handleToolStart(
    tool: { id?: string[]; name?: string },
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): void | Promise<void>;
  handleToolEnd(output: unknown, runId: string, parentRunId?: string): void | Promise<void>;
  handleToolError(err: unknown, runId: string, parentRunId?: string): void | Promise<void>;

  handleRetrieverStart(
    retriever: { id?: string[]; name?: string },
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): void | Promise<void>;
  handleRetrieverEnd(documents: unknown[], runId: string, parentRunId?: string): void | Promise<void>;
  handleRetrieverError(err: unknown, runId: string, parentRunId?: string): void | Promise<void>;

  handleLLMStart(
    llm: { id?: string[]; name?: string },
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): void | Promise<void>;
  handleChatModelStart(
    llm: { id?: string[]; name?: string },
    messages: unknown[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): void | Promise<void>;
  handleLLMEnd(output: unknown, runId: string, parentRunId?: string): void | Promise<void>;
  handleLLMError(err: unknown, runId: string, parentRunId?: string): void | Promise<void>;
}

function nameOf(descriptor: { id?: string[]; name?: string } | undefined, fallback: string, override?: string): string {
  if (override) return override;
  if (descriptor?.name) return descriptor.name;
  if (descriptor?.id && descriptor.id.length > 0) return descriptor.id[descriptor.id.length - 1];
  return fallback;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return toPreview(err) ?? "unknown error";
}

/** Best-effort extraction of provider/model + token usage from a LangChain LLMResult. */
function extractLlmResult(output: unknown): {
  promptTokens: number | null;
  completionTokens: number | null;
  stopReason: string | null;
} {
  const result = output as {
    llmOutput?: {
      tokenUsage?: { promptTokens?: number; completionTokens?: number };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    generations?: Array<Array<{ generationInfo?: { finish_reason?: string; finishReason?: string } }>>;
  } | null | undefined;

  const tokenUsage = result?.llmOutput?.tokenUsage;
  const usage = result?.llmOutput?.usage;
  const promptTokens = tokenUsage?.promptTokens ?? usage?.input_tokens ?? null;
  const completionTokens = tokenUsage?.completionTokens ?? usage?.output_tokens ?? null;

  const generationInfo = result?.generations?.[0]?.[0]?.generationInfo;
  const stopReason = generationInfo?.finish_reason ?? generationInfo?.finishReason ?? null;

  return {
    promptTokens: promptTokens ?? null,
    completionTokens: completionTokens ?? null,
    stopReason: stopReason ?? null,
  };
}

function extractModelAndProvider(
  llm: { id?: string[]; name?: string } | undefined,
  extraParams: Record<string, unknown> | undefined,
): { model: string; provider: string } {
  const invocationParams = (extraParams?.invocation_params ?? extraParams) as
    | Record<string, unknown>
    | undefined;
  const model =
    (invocationParams?.model as string | undefined) ??
    (invocationParams?.model_name as string | undefined) ??
    nameOf(llm, "unknown");
  const provider = llm?.id && llm.id.length > 1 ? llm.id[llm.id.length - 2] : nameOf(llm, "unknown");
  return { model, provider };
}

export interface CreateLangChainCallbackHandlerOptions {
  /** Overrides the auto-detected LangGraph/LlamaIndex framework tag; defaults to "langchain". */
  framework?: "langchain" | "langgraph";
}

/**
 * Builds a LangChain.js-compatible callback handler that converts chain,
 * tool, retriever, and LLM-call run events into Obyflow's canonical `chain`
 * / `tool_call` / `llm_call` events (FR11). Attach it once per traced
 * operation via `{ callbacks: [handler] }` (or globally via
 * `setGlobalCallbackManager`) — no manual span creation is required inside
 * chain/tool code.
 *
 * Retriever runs are emitted as `chain` events (framework: "langchain",
 * chain_name: "retriever:<name>") because the frozen canonical Event Model
 * (spec section 6) has no distinct "retriever" event type; this keeps the
 * step tree walkable via run_id/parent_run_id like every other chain step,
 * and is what `obyflow investigate` will read to pinpoint a failing
 * retriever step (FR12, follow-on work).
 */
export function createLangChainCallbackHandler(
  ctx: InstrumentationContext,
  options: CreateLangChainCallbackHandlerOptions = {},
): LangChainCallbackHandlerMethods {
  const framework = options.framework ?? "langchain";
  const tracker = new RunTracker();

  return {
    name: "ObyflowCallbackHandler",

    handleChainStart(chain, inputs, runId, parentRunId, _tags, _metadata, _runType, name) {
      tracker.start(runId, {
        kind: "chain",
        startedAtMs: Date.now(),
        parentRunId: parentRunId ?? null,
        name: nameOf(chain, "chain", name),
        meta: { inputPreview: toPreview(inputs) },
      });
    },
    handleChainEnd(outputs, runId, parentRunId) {
      const ended = tracker.end(runId);
      const meta = ended?.run.meta as { inputPreview?: string | null } | undefined;
      emitChainEvent(ctx, {
        framework,
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        chainName: ended?.run.name ?? null,
        inputPreview: meta?.inputPreview ?? null,
        outputPreview: toPreview(outputs),
        status: "success",
        latencyMs: ended?.latencyMs ?? null,
      });
    },
    handleChainError(err, runId, parentRunId) {
      const ended = tracker.end(runId);
      const meta = ended?.run.meta as { inputPreview?: string | null } | undefined;
      emitChainEvent(ctx, {
        framework,
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        chainName: ended?.run.name ?? null,
        inputPreview: meta?.inputPreview ?? null,
        outputPreview: toPreview(errorMessage(err)),
        status: "error",
        latencyMs: ended?.latencyMs ?? null,
      });
    },

    handleToolStart(tool, input, runId, parentRunId, _tags, _metadata, name) {
      tracker.start(runId, {
        kind: "tool_call",
        startedAtMs: Date.now(),
        parentRunId: parentRunId ?? null,
        name: nameOf(tool, "tool", name),
        meta: { argsPreview: toPreview(input) },
      });
    },
    handleToolEnd(output, runId, parentRunId) {
      const ended = tracker.end(runId);
      const meta = ended?.run.meta as { argsPreview?: string | null } | undefined;
      emitToolCallEvent(ctx, {
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        toolName: ended?.run.name ?? "unknown",
        argsPreview: meta?.argsPreview ?? null,
        resultPreview: toPreview(output),
        status: "success",
        latencyMs: ended?.latencyMs ?? null,
      });
    },
    handleToolError(err, runId, parentRunId) {
      const ended = tracker.end(runId);
      const meta = ended?.run.meta as { argsPreview?: string | null } | undefined;
      emitToolCallEvent(ctx, {
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        toolName: ended?.run.name ?? "unknown",
        argsPreview: meta?.argsPreview ?? null,
        resultPreview: toPreview(errorMessage(err)),
        status: "error",
        latencyMs: ended?.latencyMs ?? null,
      });
    },

    handleRetrieverStart(retriever, query, runId, parentRunId, _tags, _metadata, name) {
      tracker.start(runId, {
        kind: "chain",
        startedAtMs: Date.now(),
        parentRunId: parentRunId ?? null,
        name: `retriever:${nameOf(retriever, "retriever", name)}`,
      });
      void query;
    },
    handleRetrieverEnd(documents, runId, parentRunId) {
      const ended = tracker.end(runId);
      const count = Array.isArray(documents) ? documents.length : null;
      emitChainEvent(ctx, {
        framework,
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        chainName: ended?.run.name ?? "retriever",
        outputPreview: toPreview({ result_count: count }),
        status: "success",
        latencyMs: ended?.latencyMs ?? null,
      });
    },
    handleRetrieverError(err, runId, parentRunId) {
      const ended = tracker.end(runId);
      emitChainEvent(ctx, {
        framework,
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        chainName: ended?.run.name ?? "retriever",
        outputPreview: toPreview(errorMessage(err)),
        status: "error",
        latencyMs: ended?.latencyMs ?? null,
      });
    },

    handleLLMStart(llm, prompts, runId, parentRunId, extraParams, _tags, _metadata, name) {
      const { model, provider } = extractModelAndProvider(llm, extraParams);
      tracker.start(runId, {
        kind: "llm_call",
        startedAtMs: Date.now(),
        parentRunId: parentRunId ?? null,
        name: nameOf(llm, "llm", name),
        meta: { model, provider },
      });
      void prompts;
    },
    handleChatModelStart(llm, messages, runId, parentRunId, extraParams, _tags, _metadata, name) {
      const { model, provider } = extractModelAndProvider(llm, extraParams);
      tracker.start(runId, {
        kind: "llm_call",
        startedAtMs: Date.now(),
        parentRunId: parentRunId ?? null,
        name: nameOf(llm, "chat_model", name),
        meta: { model, provider },
      });
      void messages;
    },
    handleLLMEnd(output, runId, parentRunId) {
      const ended = tracker.end(runId);
      const { promptTokens, completionTokens, stopReason } = extractLlmResult(output);
      const meta = ended?.run.meta as { model?: string; provider?: string } | undefined;
      emitLlmCallEvent(ctx, {
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        model: meta?.model ?? ended?.run.name ?? "unknown",
        provider: meta?.provider ?? "unknown",
        promptTokens,
        completionTokens,
        stopReason,
        status: "success",
        latencyMs: ended?.latencyMs ?? null,
      });
    },
    handleLLMError(err, runId, parentRunId) {
      const ended = tracker.end(runId);
      const meta = ended?.run.meta as { model?: string; provider?: string } | undefined;
      emitLlmCallEvent(ctx, {
        runId,
        parentRunId: parentRunId ?? ended?.run.parentRunId ?? null,
        model: meta?.model ?? ended?.run.name ?? "unknown",
        provider: meta?.provider ?? "unknown",
        stopReason: errorMessage(err),
        status: "error",
        latencyMs: ended?.latencyMs ?? null,
      });
    },
  };
}

export { extractModelAndProvider };
