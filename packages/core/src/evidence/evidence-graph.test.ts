import { describe, it, expect } from "vitest";
import { buildEvidenceGraph } from "./evidence-graph.js";
import { buildSpanTree, type CorrelatedTrace } from "../correlation/correlate.js";
import type { AnomalyResult } from "../anomaly/baseline.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? "t1",
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

function makeTrace(events: Event[]): CorrelatedTrace {
  return {
    trace_id: "t1",
    services: Array.from(new Set(events.map((e) => e.service))),
    deployment_ids: [],
    window: { start: events[0]?.timestamp ?? "", end: events[0]?.timestamp ?? "" },
    events,
    logs: events.filter((e) => e.type === "log"),
    metrics: events.filter((e) => e.type === "metric"),
    errors: events.filter((e) => e.severity === "error" || e.severity === "critical"),
    chains: events.filter((e) => e.type === "chain"),
    tool_calls: events.filter((e) => e.type === "tool_call"),
    llm_calls: events.filter((e) => e.type === "llm_call"),
    embeddings: events.filter((e) => e.type === "embedding"),
    vector_ops: events.filter((e) => e.type === "vector_op"),
    span_tree: buildSpanTree(events),
    correlation_strategy: events.some((e) => e.span_id) ? "span_hierarchy" : "time_window",
  };
}

describe("buildEvidenceGraph", () => {
  it("includes every trace event as a node", () => {
    const events = [
      makeEvent({ id: "a", service: "checkout" }),
      makeEvent({ id: "b", service: "payments" }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set(["a"]));
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.find((n) => n.id === "a")?.in_evidence).toBe(true);
    expect(graph.nodes.find((n) => n.id === "b")?.in_evidence).toBe(false);
  });

  it("adds a CALLED edge for parent/child spans", () => {
    const events = [
      makeEvent({ id: "root", span_id: "s1", timestamp: "2026-01-01T00:00:00.000Z" }),
      makeEvent({
        id: "child",
        span_id: "s2",
        parent_span_id: "s1",
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set());
    const called = graph.edges.filter((e) => e.type === "CALLED");
    expect(called).toEqual([
      expect.objectContaining({ from: "root", to: "child", type: "CALLED" }),
    ]);
  });

  it("adds a FAILED edge from a failing child span back to its caller", () => {
    const events = [
      makeEvent({ id: "root", span_id: "s1", timestamp: "2026-01-01T00:00:00.000Z" }),
      makeEvent({
        id: "child",
        span_id: "s2",
        parent_span_id: "s1",
        severity: "error",
        timestamp: "2026-01-01T00:00:01.000Z",
      }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set());
    const failed = graph.edges.filter((e) => e.type === "FAILED");
    expect(failed).toEqual([
      expect.objectContaining({ from: "child", to: "root", type: "FAILED" }),
    ]);
  });

  it("adds a CALLED edge derived from chain run_id/parent_run_id", () => {
    const events = [
      makeEvent({
        id: "parent-chain",
        type: "chain",
        timestamp: "2026-01-01T00:00:00.000Z",
        attributes: {
          framework: "langchain",
          run_id: "run-1",
          status: "success",
        },
      }),
      makeEvent({
        id: "child-chain",
        type: "chain",
        timestamp: "2026-01-01T00:00:01.000Z",
        attributes: {
          framework: "langchain",
          run_id: "run-2",
          parent_run_id: "run-1",
          status: "success",
        },
      }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set());
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: "parent-chain",
        to: "child-chain",
        type: "CALLED",
      }),
    ]);
  });

  it("adds a CAUSED edge from the first anomalous event to a later failure on the same service", () => {
    const events = [
      makeEvent({
        id: "slow-call",
        service: "checkout",
        duration_ms: 9000,
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      makeEvent({
        id: "later-failure",
        service: "checkout",
        severity: "error",
        timestamp: "2026-01-01T00:00:05.000Z",
      }),
    ];
    const trace = makeTrace(events);
    const anomalies: AnomalyResult[] = [
      {
        metric: "duration_ms",
        service: "checkout",
        baseline: { mean: 100, stddev: 10, count: 12 },
        current_value: 9000,
        current_count: 1,
        z_score: 8,
        severity: "high",
        is_anomalous: true,
        insufficient_data: false,
      },
    ];
    const graph = buildEvidenceGraph(trace, anomalies, new Set());
    const caused = graph.edges.filter((e) => e.type === "CAUSED");
    expect(caused).toEqual([
      expect.objectContaining({ from: "slow-call", to: "later-failure", type: "CAUSED" }),
    ]);
  });

  it("adds an AFFECTED edge to a later event in a different service sharing a deployment_id", () => {
    const events = [
      makeEvent({
        id: "failing",
        service: "checkout",
        severity: "error",
        deployment_id: "d1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      makeEvent({
        id: "downstream",
        service: "payments",
        deployment_id: "d1",
        timestamp: "2026-01-01T00:00:30.000Z",
      }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set());
    const affected = graph.edges.filter((e) => e.type === "AFFECTED");
    expect(affected).toEqual([
      expect.objectContaining({ from: "failing", to: "downstream", type: "AFFECTED" }),
    ]);
  });

  it("does not add an AFFECTED edge for unrelated, out-of-window, different-deployment events", () => {
    const events = [
      makeEvent({
        id: "failing",
        service: "checkout",
        severity: "error",
        deployment_id: "d1",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      makeEvent({
        id: "unrelated",
        service: "payments",
        deployment_id: "d2",
        timestamp: "2026-01-01T01:00:00.000Z",
      }),
    ];
    const trace = makeTrace(events);
    const graph = buildEvidenceGraph(trace, [], new Set());
    expect(graph.edges.filter((e) => e.type === "AFFECTED")).toHaveLength(0);
  });
});
