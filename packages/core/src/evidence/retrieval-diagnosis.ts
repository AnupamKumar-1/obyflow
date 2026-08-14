import { CorrelatedTrace } from "../correlation/correlate.js";

export type RetrievalSignalType =
  | "empty_results"
  | "low_similarity"
  | "slow_vector_query"
  | "embedding_latency";

export type RetrievalSignalSeverity = "medium" | "high";

export interface RetrievalSignal {
  type: RetrievalSignalType;
  event_id: string;
  service: string;
  severity: RetrievalSignalSeverity;
  reason: string;
  detail: Record<string, number | string | null>;
}

export interface RetrievalDiagnosis {
  detected: boolean;
  layer: "retrieval";
  signals: RetrievalSignal[];
  summary: string | null;
}

export interface RetrievalDiagnosisOptions {
  lowSimilarityThreshold?: number;
  slowVectorQueryMs?: number;
  embeddingLatencyMs?: number;
}

type RetrievalDiagnosisTrace = Pick<CorrelatedTrace, "vector_ops" | "embeddings">;

const DEFAULT_LOW_SIMILARITY_THRESHOLD = 0.5;
const DEFAULT_SLOW_VECTOR_QUERY_MS = 500;
const DEFAULT_EMBEDDING_LATENCY_MS = 1000;

function maxOf(values: number[]): number {
  return values.reduce((max, v) => (v > max ? v : max), -Infinity);
}

function humanizeSignalType(type: RetrievalSignalType): string {
  switch (type) {
    case "empty_results":
      return "empty result sets";
    case "low_similarity":
      return "low similarity scores";
    case "slow_vector_query":
      return "slow vector queries";
    case "embedding_latency":
      return "high embedding latency";
    default:
      return type;
  }
}

function summarizeSignals(signals: RetrievalSignal[]): string {
  const counts = new Map<RetrievalSignalType, number>();
  for (const signal of signals) {
    counts.set(signal.type, (counts.get(signal.type) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(
    ([type, count]) => `${humanizeSignalType(type)} (${count})`,
  );
  return `Retrieval layer likely contributes to this failure: ${parts.join(", ")}.`;
}

export function diagnoseRetrievalLayer(
  trace: RetrievalDiagnosisTrace,
  options: RetrievalDiagnosisOptions = {},
): RetrievalDiagnosis {
  const lowSimilarityThreshold =
    options.lowSimilarityThreshold ?? DEFAULT_LOW_SIMILARITY_THRESHOLD;
  const slowVectorQueryMs = options.slowVectorQueryMs ?? DEFAULT_SLOW_VECTOR_QUERY_MS;
  const embeddingLatencyMs = options.embeddingLatencyMs ?? DEFAULT_EMBEDDING_LATENCY_MS;

  const signals: RetrievalSignal[] = [];

  for (const event of trace.vector_ops) {
    const operation = event.attributes["operation"];
    if (operation !== "query") continue;

    const resultCount = event.attributes["result_count"];
    if (typeof resultCount === "number" && resultCount === 0) {
      signals.push({
        type: "empty_results",
        event_id: event.id,
        service: event.service,
        severity: "high",
        reason: "vector query returned zero results",
        detail: { result_count: resultCount },
      });
    }

    const scores = event.attributes["similarity_scores"];
    if (
      Array.isArray(scores) &&
      scores.length > 0 &&
      scores.every((score) => typeof score === "number")
    ) {
      const top = maxOf(scores as number[]);
      if (top < lowSimilarityThreshold) {
        signals.push({
          type: "low_similarity",
          event_id: event.id,
          service: event.service,
          severity: "medium",
          reason: `vector query top similarity score ${top.toFixed(3)} is below threshold ${lowSimilarityThreshold}`,
          detail: { top_similarity: top, threshold: lowSimilarityThreshold },
        });
      }
    }

    const latencyMs = event.attributes["latency_ms"];
    if (typeof latencyMs === "number" && latencyMs > slowVectorQueryMs) {
      signals.push({
        type: "slow_vector_query",
        event_id: event.id,
        service: event.service,
        severity: "medium",
        reason: `vector query latency ${latencyMs}ms exceeds ${slowVectorQueryMs}ms threshold`,
        detail: { latency_ms: latencyMs, threshold_ms: slowVectorQueryMs },
      });
    }
  }

  for (const event of trace.embeddings) {
    const latencyMs = event.attributes["latency_ms"];
    if (typeof latencyMs === "number" && latencyMs > embeddingLatencyMs) {
      signals.push({
        type: "embedding_latency",
        event_id: event.id,
        service: event.service,
        severity: "medium",
        reason: `embedding call latency ${latencyMs}ms exceeds ${embeddingLatencyMs}ms threshold`,
        detail: { latency_ms: latencyMs, threshold_ms: embeddingLatencyMs },
      });
    }
  }

  const detected = signals.length > 0;

  return {
    detected,
    layer: "retrieval",
    signals,
    summary: detected ? summarizeSignals(signals) : null,
  };
}
