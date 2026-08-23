import { describe, it, expect } from "vitest";
import { detectWhatChanged } from "./what-changed.js";
import type { Event } from "../event-model/event.schema.js";
import type { CorrelatedTrace } from "../correlation/correlate.js";
import type { AnomalyResult } from "../anomaly/baseline.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? null,
    span_id: overrides.span_id ?? null,
    parent_span_id: overrides.parent_span_id ?? null,
    request_id: overrides.request_id ?? null,
    service: overrides.service ?? "checkout-service",
    host: overrides.host ?? null,
    container: overrides.container ?? null,
    deployment_id: overrides.deployment_id ?? null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration_ms: overrides.duration_ms ?? null,
    attributes: overrides.attributes ?? {},
    resource_attributes: overrides.resource_attributes ?? null,
    severity: overrides.severity ?? null,
  };
}

function makeTrace(events: Event[], windowStart: string, windowEnd: string): CorrelatedTrace {
  return {
    trace_id: "t1",
    services: Array.from(new Set(events.map((e) => e.service))),
    deployment_ids: Array.from(
      new Set(events.map((e) => e.deployment_id).filter((d): d is string => !!d)),
    ),
    window: { start: windowStart, end: windowEnd },
    events,
    logs: [],
    metrics: [],
    errors: [],
    chains: [],
    tool_calls: [],
    llm_calls: [],
    embeddings: [],
    vector_ops: [],
    span_tree: [],
    correlation_strategy: "time_window",
  };
}

const noAnomalies: AnomalyResult[] = [];

describe("detectWhatChanged attribute sources", () => {
  it("detects a config_hash change", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { config_hash: "abc123" },
        timestamp: new Date(base - 60000).toISOString(),
      }),
    ];
    const current = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { config_hash: "def456" },
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const changes = detectWhatChanged(trace, historical, noAnomalies);
    const configChange = changes.find((c) => c.type === "config");
    expect(configChange).toBeDefined();
    expect(configChange?.from_value).toBe("abc123");
    expect(configChange?.to_value).toBe("def456");
  });

  it("detects a feature_flags change regardless of key order", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { feature_flags: { beta: true, dark_mode: false } },
        timestamp: new Date(base - 60000).toISOString(),
      }),
    ];
    const current = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { feature_flags: { dark_mode: true, beta: true } },
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const changes = detectWhatChanged(trace, historical, noAnomalies);
    expect(changes.some((c) => c.type === "feature_flag")).toBe(true);
  });

  it("does not flag a feature_flags value that is unchanged after key reordering", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { feature_flags: { beta: true, dark_mode: false } },
        timestamp: new Date(base - 60000).toISOString(),
      }),
    ];
    const current = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { feature_flags: { dark_mode: false, beta: true } },
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const changes = detectWhatChanged(trace, historical, noAnomalies);
    expect(changes.some((c) => c.type === "feature_flag")).toBe(false);
  });

  it("detects a model_version change and a git_sha (commit) change independently", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "rag-service",
        resource_attributes: { model_version: "gpt-x-1", git_sha: "aaa111" },
        timestamp: new Date(base - 60000).toISOString(),
      }),
    ];
    const current = [
      makeEvent({
        service: "rag-service",
        resource_attributes: { model_version: "gpt-x-2", git_sha: "bbb222" },
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const changes = detectWhatChanged(trace, historical, noAnomalies);
    expect(changes.some((c) => c.type === "model_version")).toBe(true);
    expect(changes.some((c) => c.type === "commit")).toBe(true);
  });

  it("detects a dependency_versions change and scores it higher with correlated anomalies", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const historical = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { dependency_versions: { stripe: "1.0.0" } },
        timestamp: new Date(base - 60000).toISOString(),
      }),
    ];
    const current = [
      makeEvent({
        service: "checkout-service",
        resource_attributes: { dependency_versions: { stripe: "1.1.0" } },
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const anomalies: AnomalyResult[] = [
      {
        service: "checkout-service",
        metric: "error_rate",
        is_anomalous: true,
        z_score: 4,
        value: 1,
        baseline_mean: 0,
        baseline_stddev: 0.1,
      } as unknown as AnomalyResult,
    ];
    const withAnomalies = detectWhatChanged(trace, historical, anomalies);
    const withoutAnomalies = detectWhatChanged(trace, historical, noAnomalies);
    const depWith = withAnomalies.find((c) => c.type === "dependency");
    const depWithout = withoutAnomalies.find((c) => c.type === "dependency");
    expect(depWith).toBeDefined();
    expect(depWithout).toBeDefined();
    expect(depWith!.relevance_score).toBeGreaterThan(depWithout!.relevance_score);
  });

  it("ignores services without resource_attributes entirely", () => {
    const base = Date.now();
    const windowStart = new Date(base).toISOString();
    const windowEnd = new Date(base + 60000).toISOString();
    const current = [
      makeEvent({
        service: "checkout-service",
        timestamp: new Date(base + 1000).toISOString(),
      }),
    ];
    const trace = makeTrace(current, windowStart, windowEnd);
    const changes = detectWhatChanged(trace, [], noAnomalies);
    expect(changes.length).toBe(0);
  });
});
