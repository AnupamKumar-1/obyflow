import { describe, it, expect } from "vitest";
import {
  runWithTraceContext,
  getActiveTraceContext,
  getActiveTraceId,
  getActiveRequestId,
  getActiveSpanId,
  getActiveParentSpanId,
} from "./context.js";

describe("node-sdk trace context propagation", () => {
  it("exposes no active context outside of runWithTraceContext", () => {
    expect(getActiveTraceContext()).toBeNull();
    expect(getActiveTraceId()).toBeNull();
    expect(getActiveRequestId()).toBeNull();
    expect(getActiveSpanId()).toBeNull();
    expect(getActiveParentSpanId()).toBeNull();
  });

  it("scopes the active context to the callback and normalizes optional fields", () => {
    const result = runWithTraceContext(
      { traceId: "trace-1", requestId: "req-1", spanId: "span-1" },
      () => {
        expect(getActiveTraceId()).toBe("trace-1");
        expect(getActiveRequestId()).toBe("req-1");
        expect(getActiveSpanId()).toBe("span-1");
        expect(getActiveParentSpanId()).toBeNull();
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(getActiveTraceContext()).toBeNull();
  });

  it("supports nested scopes and restores the outer context after the inner one returns", () => {
    runWithTraceContext({ traceId: "outer", requestId: "req-outer" }, () => {
      expect(getActiveTraceId()).toBe("outer");

      runWithTraceContext(
        { traceId: "inner", requestId: "req-inner", parentSpanId: "span-outer" },
        () => {
          expect(getActiveTraceId()).toBe("inner");
          expect(getActiveParentSpanId()).toBe("span-outer");
        },
      );

      expect(getActiveTraceId()).toBe("outer");
    });

    expect(getActiveTraceContext()).toBeNull();
  });

  it("restores the previous context when the callback throws", () => {
    expect(() =>
      runWithTraceContext({ traceId: "trace-err", requestId: "req-err" }, () => {
        expect(getActiveTraceId()).toBe("trace-err");
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(getActiveTraceContext()).toBeNull();
  });

  it("propagates the active context across async continuations", async () => {
    await runWithTraceContext({ traceId: "trace-async", requestId: "req-async" }, async () => {
      expect(getActiveTraceId()).toBe("trace-async");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getActiveTraceId()).toBe("trace-async");
    });

    expect(getActiveTraceContext()).toBeNull();
  });
});
