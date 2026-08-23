import { describe, it, expect } from "vitest";
import { buildEvidence } from "./build-evidence.js";
import { buildSpanTree, type CorrelatedTrace } from "../correlation/correlate.js";
import type { AnomalyResult } from "../anomaly/baseline.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? "t1",
    request_id: overrides.request_id ?? null,
    service: overrides.service ?? "checkout-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    severity: overrides.severity ?? null,
  };
}

function makeTrace(events: Event[]): CorrelatedTrace {
  return {
    trace_id: "t1",
    services: Array.from(new Set(events.map((e) => e.service))),
    deployment_ids: [],
    window: { start: events[0]?.timestamp ?? "", end: events[0]?.timestamp ?? "" },
    events,
    logs: events.filter((e) => e.type === "log"),
    metrics: events.filter((e) => e.type === "metric"),
    errors: events.filter(
      (e) => e.severity === "error" || e.severity === "critical",
    ),
    chains: events.filter((e) => e.type === "chain"),
    tool_calls: events.filter((e) => e.type === "tool_call"),
    llm_calls: events.filter((e) => e.type === "llm_call"),
    embeddings: events.filter((e) => e.type === "embedding"),
    vector_ops: events.filter((e) => e.type === "vector_op"),
    span_tree: buildSpanTree(events),
    correlation_strategy: "time_window",
  };
}

describe("buildEvidence", () => {
  it("summarizes the trace correctly", () => {
    const events = [
      makeEvent({ type: "trace", service: "checkout" }),
      makeEvent({ type: "error", service: "checkout", severity: "error" }),
      makeEvent({ type: "llm_call", service: "checkout" }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    expect(result.trace_id).toBe("t1");
    expect(result.summary.event_count).toBe(3);
    expect(result.summary.error_count).toBe(1);
    expect(result.summary.llm_call_count).toBe(1);
  });

  it("ranks error and critical events above normal events", () => {
    const events = [
      makeEvent({ type: "trace", service: "checkout", duration_ms: 50 }),
      makeEvent({
        type: "error",
        service: "checkout",
        severity: "critical",
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    expect(result.evidence[0].severity).toBe("critical");
  });

  it("caps the evidence list at maxEvidenceItems", () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      makeEvent({ type: "trace", service: "checkout", duration_ms: i }),
    );
    const trace = makeTrace(events);
    const result = buildEvidence(trace, [], { maxEvidenceItems: 10 });
    expect(result.evidence).toHaveLength(10);
  });

  it("boosts events that contribute to an anomalous metric", () => {
    const events = [
      makeEvent({ type: "trace", service: "checkout", duration_ms: 9000 }),
      makeEvent({ type: "trace", service: "other", duration_ms: 20 }),
    ];
    const trace = makeTrace(events);
    const anomalies: AnomalyResult[] = [
      {
        metric: "duration_ms",
        service: "checkout",
        baseline: { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },
        current_value: 9000,
        current_count: 1,
        z_score: 8,
        severity: "high",
        is_anomalous: true,
        insufficient_data: false,
        low_sample_size: false,
      },
    ];
    const result = buildEvidence(trace, anomalies);
    expect(result.evidence[0].service).toBe("checkout");
    expect(result.evidence[0].reason).toContain("anomalous duration_ms");
  });

  it("applies redaction to evidence attributes by default", () => {
    const events = [
      makeEvent({
        type: "log",
        severity: "error",
        attributes: { password: "hunter2", message: "login failed" },
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    expect(result.redaction_applied).toBe(true);
    expect(result.evidence[0].attributes["password"]).toBe("[REDACTED]");
    expect(result.evidence[0].attributes["message"]).toBe("login failed");
  });

  it("skips redaction when explicitly disabled", () => {
    const events = [
      makeEvent({
        type: "log",
        attributes: { password: "hunter2" },
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, [], {
      redactionConfig: {
        enabled: false,
        fields: [],
        applied_at: "evidence",
      },
    });
    expect(result.redaction_applied).toBe(false);
    expect(result.evidence[0].attributes["password"]).toBe("hunter2");
  });

  it("marks a vector_op with zero results as high relevance", () => {
    const events = [
      makeEvent({ type: "trace", service: "search", duration_ms: 50 }),
      makeEvent({
        type: "vector_op",
        service: "search",
        attributes: {
          operation: "query",
          db_provider: "pgvector",
          result_count: 0,
        },
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    const vectorOpEvidence = result.evidence.find((e) => e.type === "vector_op");
    expect(vectorOpEvidence?.reason).toBe("vector query returned zero results");
  });

  it("includes a retrieval diagnosis in the evidence object", () => {
    const events = [
      makeEvent({ type: "trace", service: "search", duration_ms: 20 }),
      makeEvent({
        type: "vector_op",
        service: "search",
        attributes: {
          operation: "query",
          db_provider: "pgvector",
          similarity_scores: [0.1, 0.2],
        },
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    expect(result.retrieval_diagnosis.detected).toBe(true);
    expect(result.retrieval_diagnosis.signals[0].type).toBe("low_similarity");
  });

  it("boosts the relevance score of a vector_op flagged by the retrieval diagnosis", () => {
    const events = [
      makeEvent({ type: "trace", service: "search", duration_ms: 20 }),
      makeEvent({
        type: "vector_op",
        service: "search",
        attributes: {
          operation: "query",
          db_provider: "pgvector",
          latency_ms: 2000,
        },
      }),
    ];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    const vectorOpEvidence = result.evidence.find((e) => e.type === "vector_op");
    expect(vectorOpEvidence?.reason).toContain("vector query latency");
    expect(vectorOpEvidence?.relevance_score).toBeGreaterThan(30);
  });

  it("reports no retrieval diagnosis when there are no vector or embedding events", () => {
    const events = [makeEvent({ type: "trace", service: "checkout", duration_ms: 20 })];
    const trace = makeTrace(events);
    const result = buildEvidence(trace, []);
    expect(result.retrieval_diagnosis.detected).toBe(false);
    expect(result.retrieval_diagnosis.signals).toHaveLength(0);
  });

  it("respects custom retrievalDiagnosisOptions thresholds", () => {
    const events = [
      makeEvent({
        type: "embedding",
        service: "search",
        attributes: {
          model: "text-embedding-3-small",
          provider: "openai",
          latency_ms: 150,
        },
      }),
    ];
    const trace = makeTrace(events);
    const withDefaultThreshold = buildEvidence(trace, []);
    expect(withDefaultThreshold.retrieval_diagnosis.detected).toBe(false);
    const withCustomThreshold = buildEvidence(trace, [], {
      retrievalDiagnosisOptions: { embeddingLatencyMs: 100 },
    });
    expect(withCustomThreshold.retrieval_diagnosis.detected).toBe(true);
  });
});
