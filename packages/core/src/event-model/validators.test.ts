import { describe, it, expect } from "vitest";
import { validateEvent, safeValidateEvent, EventValidationError } from "./validators.js";

const base = {
  id: "evt_1",
  request_id: "req_1",
  service: "search-agent-service",
  host: "host1",
  container: "c1",
  deployment_id: "deploy_1",
  timestamp: new Date().toISOString(),
  duration_ms: 50,
  severity: null,
};

describe("validateEvent — envelope", () => {
  it("returns the parsed event for a valid trace event", () => {
    const event = validateEvent({
      ...base,
      type: "trace",
      trace_id: "trace_1",
      attributes: { route: "/checkout" },
    });
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("trace");
  });

  it("throws EventValidationError on a bad envelope", () => {
    expect(() =>
      validateEvent({ ...base, type: "trace", trace_id: "trace_1", attributes: {}, timestamp: "not-a-date" }),
    ).toThrow(EventValidationError);
  });
});

describe("validateEvent — per-type attribute refinement", () => {
  it("accepts a valid embedding event", () => {
    const event = validateEvent({
      ...base,
      type: "embedding",
      trace_id: "trace_1",
      attributes: { model: "text-embedding-3-small", provider: "openai", latency_ms: 45 },
    });
    expect(event.type).toBe("embedding");
  });

  it("rejects an embedding event missing required attribute fields", () => {
    expect(() =>
      validateEvent({
        ...base,
        type: "embedding",
        trace_id: "trace_1",
        attributes: { latency_ms: 45 },
      }),
    ).toThrow(EventValidationError);
  });

  it("accepts a valid vector_op event", () => {
    const event = validateEvent({
      ...base,
      type: "vector_op",
      trace_id: "trace_1",
      attributes: {
        operation: "query",
        db_provider: "qdrant",
        top_k: 10,
        result_count: 0,
        similarity_scores: [],
      },
    });
    expect(event.type).toBe("vector_op");
  });

  it("rejects a vector_op event with an invalid operation", () => {
    expect(() =>
      validateEvent({
        ...base,
        type: "vector_op",
        trace_id: "trace_1",
        attributes: { operation: "not_valid", db_provider: "qdrant" },
      }),
    ).toThrow(EventValidationError);
  });

  it("passes trace/log/metric/error/custom through without attribute refinement", () => {
    for (const type of ["trace", "log", "metric", "error", "custom"] as const) {
      const event = validateEvent({
        ...base,
        type,
        trace_id: "trace_1",
        attributes: { anything: "goes", nested: { ok: true } },
      });
      expect(event.type).toBe(type);
    }
  });
});

describe("validateEvent — chain trace_id nesting rule", () => {
  it("rejects a chain event with no trace_id", () => {
    expect(() =>
      validateEvent({
        ...base,
        type: "chain",
        trace_id: null,
        attributes: {
          framework: "langchain",
          run_id: "run_1",
          status: "success",
        },
      }),
    ).toThrow(/must carry a trace_id/);
  });

  it("accepts a chain event with a trace_id", () => {
    const event = validateEvent({
      ...base,
      type: "chain",
      trace_id: "trace_1",
      attributes: {
        framework: "langchain",
        run_id: "run_1",
        status: "success",
      },
    });
    expect(event.type).toBe("chain");
  });
});

describe("safeValidateEvent", () => {
  it("returns ok:true with the event on success", () => {
    const result = safeValidateEvent({
      ...base,
      type: "trace",
      trace_id: "trace_1",
      attributes: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.id).toBe("evt_1");
    }
  });

  it("returns ok:false with an EventValidationError on failure, without throwing", () => {
    const result = safeValidateEvent({
      ...base,
      type: "vector_op",
      trace_id: "trace_1",
      attributes: { operation: "bogus", db_provider: "qdrant" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(EventValidationError);
    }
  });
});