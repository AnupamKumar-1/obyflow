import { Event } from "../event-model/event.schema.js";
import { CorrelatedTrace } from "../correlation/correlate.js";
import { computeBaselineStats, zScoreOf } from "../anomaly/baseline.js";

export type ChainStepKind = "chain" | "tool_call" | "llm_call";

export type ChainStepSignalType =
  | "step_failed"
  | "tool_call_timeout"
  | "retriever_empty_results"
  | "step_duration_regression";

export type ChainStepSignalSeverity = "medium" | "high";

export interface ChainStepSignal {
  type: ChainStepSignalType;
  event_id: string;
  run_id: string | null;
  parent_run_id: string | null;
  step_kind: ChainStepKind;
  step_name: string;
  service: string;
  severity: ChainStepSignalSeverity;
  reason: string;
  detail: Record<string, number | string | null>;
}

export interface ChainStepNode {
  event_id: string;
  run_id: string | null;
  parent_run_id: string | null;
  step_kind: ChainStepKind;
  step_name: string;
  status: string | null;
  duration_ms: number | null;
  children: ChainStepNode[];
}

export interface ChainStepDiagnosis {
  detected: boolean;
  layer: "chain_step";
  signals: ChainStepSignal[];
  step_tree: ChainStepNode[];
  summary: string | null;
}

export interface ChainStepDiagnosisOptions {
  toolCallTimeoutMs?: number;
  durationRegressionZScoreThreshold?: number;
  minBaselineSamples?: number;
}

type ChainStepDiagnosisTrace = Pick<CorrelatedTrace, "chains" | "tool_calls" | "llm_calls">;

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30000;
const DEFAULT_DURATION_REGRESSION_Z_SCORE_THRESHOLD = 2;
const DEFAULT_MIN_BASELINE_SAMPLES = 3;
const TIMEOUT_PATTERN = /timed?\s*out|timeout/i;
const RETRIEVER_PREFIX = "retriever:";

function attributeString(event: Event, key: string): string | null {
  const value = event.attributes?.[key];
  return typeof value === "string" ? value : null;
}

function stepKindOf(event: Event): ChainStepKind | null {
  if (event.type === "chain" || event.type === "tool_call" || event.type === "llm_call") {
    return event.type;
  }
  return null;
}

function stepNameOf(event: Event, kind: ChainStepKind): string {
  if (kind === "tool_call") return attributeString(event, "tool_name") ?? "unknown";
  if (kind === "llm_call") return attributeString(event, "model") ?? "unknown";
  return attributeString(event, "chain_name") ?? "unknown";
}

function statusOf(event: Event): string | null {
  return attributeString(event, "status");
}

function runIdOf(event: Event): string | null {
  return attributeString(event, "run_id");
}

function parentRunIdOf(event: Event): string | null {
  return attributeString(event, "parent_run_id");
}

function stepIdentity(kind: ChainStepKind, name: string): string {
  return `${kind}:${name}`;
}

function humanizeStepKind(kind: ChainStepKind): string {
  if (kind === "tool_call") return "Tool call";
  if (kind === "llm_call") return "LLM call step";
  return "Chain step";
}

function describeStepName(kind: ChainStepKind, name: string): string {
  if (kind === "tool_call") return `\`${name}\``;
  if (kind === "llm_call") return `(${name})`;
  return `"${name}"`;
}

function parseRetrieverResultCount(outputPreview: string | null): number | null {
  if (!outputPreview) return null;
  try {
    const parsed = JSON.parse(outputPreview) as { result_count?: unknown };
    return typeof parsed.result_count === "number" ? parsed.result_count : null;
  } catch {
    return null;
  }
}

function collectStepEvents(trace: ChainStepDiagnosisTrace): Event[] {
  return [...trace.chains, ...trace.tool_calls, ...trace.llm_calls];
}

function detectFailureSignal(
  event: Event,
  kind: ChainStepKind,
  name: string,
  options: Required<Pick<ChainStepDiagnosisOptions, "toolCallTimeoutMs">>,
): ChainStepSignal | null {
  if (statusOf(event) !== "error") return null;

  const resultPreview = attributeString(event, "result_preview");
  const outputPreview = attributeString(event, "output_preview");
  const message = resultPreview ?? outputPreview ?? "";
  const looksLikeTimeout =
    TIMEOUT_PATTERN.test(message) ||
    (event.duration_ms !== null && event.duration_ms >= options.toolCallTimeoutMs);

  if (kind === "tool_call" && looksLikeTimeout) {
    return {
      type: "tool_call_timeout",
      event_id: event.id,
      run_id: runIdOf(event),
      parent_run_id: parentRunIdOf(event),
      step_kind: kind,
      step_name: name,
      service: event.service,
      severity: "high",
      reason: `Tool call \`${name}\` timed out`,
      detail: { duration_ms: event.duration_ms, timeout_ms: options.toolCallTimeoutMs },
    };
  }

  return {
    type: "step_failed",
    event_id: event.id,
    run_id: runIdOf(event),
    parent_run_id: parentRunIdOf(event),
    step_kind: kind,
    step_name: name,
    service: event.service,
    severity: "high",
    reason: `${humanizeStepKind(kind)} ${describeStepName(kind, name)} failed`,
    detail: { message: message || null },
  };
}

function detectRetrieverEmptyResultsSignal(event: Event, name: string): ChainStepSignal | null {
  if (!name.startsWith(RETRIEVER_PREFIX)) return null;
  if (statusOf(event) !== "success") return null;

  const outputPreview = attributeString(event, "output_preview");
  const resultCount = parseRetrieverResultCount(outputPreview);
  if (resultCount !== 0) return null;

  return {
    type: "retriever_empty_results",
    event_id: event.id,
    run_id: runIdOf(event),
    parent_run_id: parentRunIdOf(event),
    step_kind: "chain",
    step_name: name,
    service: event.service,
    severity: "high",
    reason: `Retriever step returned 0 documents`,
    detail: { result_count: 0 },
  };
}

function detectDurationRegressionSignal(
  event: Event,
  kind: ChainStepKind,
  name: string,
  baselineDurationsByIdentity: Map<string, number[]>,
  options: Required<
    Pick<ChainStepDiagnosisOptions, "durationRegressionZScoreThreshold" | "minBaselineSamples">
  >,
): ChainStepSignal | null {
  if (event.duration_ms === null) return null;

  const identity = stepIdentity(kind, name);
  const historicalDurations = baselineDurationsByIdentity.get(identity) ?? [];
  if (historicalDurations.length < options.minBaselineSamples) return null;

  const baseline = computeBaselineStats(historicalDurations);
  if (event.duration_ms <= baseline.mean) return null;

  const zScore = zScoreOf(event.duration_ms, baseline);
  if (zScore < options.durationRegressionZScoreThreshold) return null;

  return {
    type: "step_duration_regression",
    event_id: event.id,
    run_id: runIdOf(event),
    parent_run_id: parentRunIdOf(event),
    step_kind: kind,
    step_name: name,
    service: event.service,
    severity: zScore >= options.durationRegressionZScoreThreshold + 1 ? "high" : "medium",
    reason: `${humanizeStepKind(kind)} ${describeStepName(kind, name)} took ${event.duration_ms}ms vs ${Math.round(baseline.mean)}ms baseline`,
    detail: {
      duration_ms: event.duration_ms,
      baseline_mean_ms: Math.round(baseline.mean * 100) / 100,
      z_score: Math.round(zScore * 100) / 100,
    },
  };
}

function buildBaselineDurationsByIdentity(historicalEvents: Event[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const event of historicalEvents) {
    const kind = stepKindOf(event);
    if (!kind) continue;
    if (event.duration_ms === null) continue;
    const name = stepNameOf(event, kind);
    const identity = stepIdentity(kind, name);
    const values = map.get(identity) ?? [];
    values.push(event.duration_ms);
    map.set(identity, values);
  }
  return map;
}

function buildStepTree(events: Event[]): ChainStepNode[] {
  const nodesByRunId = new Map<string, ChainStepNode>();
  const roots: ChainStepNode[] = [];

  for (const event of events) {
    const kind = stepKindOf(event);
    if (!kind) continue;
    const runId = runIdOf(event);
    const node: ChainStepNode = {
      event_id: event.id,
      run_id: runId,
      parent_run_id: parentRunIdOf(event),
      step_kind: kind,
      step_name: stepNameOf(event, kind),
      status: statusOf(event),
      duration_ms: event.duration_ms,
      children: [],
    };
    if (runId) {
      nodesByRunId.set(runId, node);
    } else {
      roots.push(node);
    }
  }

  for (const node of nodesByRunId.values()) {
    if (node.parent_run_id && nodesByRunId.has(node.parent_run_id)) {
      nodesByRunId.get(node.parent_run_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function humanizeSignalType(type: ChainStepSignalType): string {
  switch (type) {
    case "step_failed":
      return "failed steps";
    case "tool_call_timeout":
      return "tool call timeouts";
    case "retriever_empty_results":
      return "retriever steps with no results";
    case "step_duration_regression":
      return "step duration regressions";
    default:
      return type;
  }
}

function summarizeSignals(signals: ChainStepSignal[]): string {
  const counts = new Map<ChainStepSignalType, number>();
  for (const signal of signals) {
    counts.set(signal.type, (counts.get(signal.type) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(
    ([type, count]) => `${humanizeSignalType(type)} (${count})`,
  );
  return `Chain step layer likely contributes to this failure: ${parts.join(", ")}.`;
}

export function diagnoseChainSteps(
  trace: ChainStepDiagnosisTrace,
  historicalEvents: Event[] = [],
  options: ChainStepDiagnosisOptions = {},
): ChainStepDiagnosis {
  const toolCallTimeoutMs = options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  const durationRegressionZScoreThreshold =
    options.durationRegressionZScoreThreshold ??
    DEFAULT_DURATION_REGRESSION_Z_SCORE_THRESHOLD;
  const minBaselineSamples = options.minBaselineSamples ?? DEFAULT_MIN_BASELINE_SAMPLES;

  const stepEvents = collectStepEvents(trace);
  const baselineDurationsByIdentity = buildBaselineDurationsByIdentity(historicalEvents);

  const signals: ChainStepSignal[] = [];

  for (const event of stepEvents) {
    const kind = stepKindOf(event);
    if (!kind) continue;
    const name = stepNameOf(event, kind);

    const failureSignal = detectFailureSignal(event, kind, name, { toolCallTimeoutMs });
    if (failureSignal) {
      signals.push(failureSignal);
      continue;
    }

    if (kind === "chain") {
      const retrieverSignal = detectRetrieverEmptyResultsSignal(event, name);
      if (retrieverSignal) {
        signals.push(retrieverSignal);
        continue;
      }
    }

    const regressionSignal = detectDurationRegressionSignal(
      event,
      kind,
      name,
      baselineDurationsByIdentity,
      { durationRegressionZScoreThreshold, minBaselineSamples },
    );
    if (regressionSignal) {
      signals.push(regressionSignal);
    }
  }

  const detected = signals.length > 0;

  return {
    detected,
    layer: "chain_step",
    signals,
    step_tree: buildStepTree(stepEvents),
    summary: detected ? summarizeSignals(signals) : null,
  };
}
