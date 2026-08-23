import { describe, it, expect } from "vitest";
import { detectTelemetryGaps } from "./health.js";
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

const WINDOW_START = "2026-01-01T00:00:00.000Z";
const WINDOW_END = "2026-01-01T00:05:00.000Z";

describe("detectTelemetryGaps", () => {
  it("returns no gaps when events are evenly spread and below the threshold", () => {
    const events = [
      makeEvent({ service: "checkout-service", timestamp: "2026-01-01T00:00:10.000Z" }),
      makeEvent({ service: "checkout-service", timestamp: "2026-01-01T00:00:20.000Z" }),
      makeEvent({ service: "checkout-service", timestamp: "2026-01-01T00:00:30.000Z" }),
    ];
    const gaps = detectTelemetryGaps(events, { start: WINDOW_START, end: "2026-01-01T00:00:40.000Z" }, {
      minGapMs: 30000,
    });
    expect(gaps).toEqual([]);
  });

  it("flags a silent period longer than the threshold within the window", () => {
    const events = [
      makeEvent({ service: "checkout-service", timestamp: "2026-01-01T00:00:05.000Z" }),
      makeEvent({ service: "checkout-service", timestamp: "2026-01-01T00:04:00.000Z" }),
    ];
    const gaps = detectTelemetryGaps(events, { start: WINDOW_START, end: WINDOW_END }, { minGapMs: 30000 });
    expect(gaps.length).toBeGreaterThan(0);
    const gap = gaps.find(
      (g) => g.start === "2026-01-01T00:00:05.000Z" && g.end === "2026-01-01T00:04:00.000Z",
    );
    expect(gap).toBeDefined();
    expect(gap!.service).toBe("checkout-service");
    expect(gap!.duration_ms).toBe(235000);
  });

  it("flags a gap between the window start and the first event", () => {
    const events = [makeEvent({ service: "payments-service", timestamp: "2026-01-01T00:04:50.000Z" })];
    const gaps = detectTelemetryGaps(events, { start: WINDOW_START, end: WINDOW_END }, { minGapMs: 30000 });
    const leading = gaps.find((g) => g.start === WINDOW_START);
    expect(leading).toBeDefined();
    expect(leading!.service).toBe("payments-service");
  });

  it("tracks gaps independently per service", () => {
    const start = "2026-01-01T00:00:00.000Z";
    const end = "2026-01-01T00:01:00.000Z";
    const events = [
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:00.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:10.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:20.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:30.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:40.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:00:50.000Z" }),
      makeEvent({ service: "a", timestamp: "2026-01-01T00:01:00.000Z" }),
      makeEvent({ service: "b", timestamp: "2026-01-01T00:00:00.000Z" }),
      makeEvent({ service: "b", timestamp: "2026-01-01T00:00:01.000Z" }),
      makeEvent({ service: "b", timestamp: "2026-01-01T00:01:00.000Z" }),
    ];
    const gaps = detectTelemetryGaps(events, { start, end }, { minGapMs: 30000 });
    expect(gaps.some((g) => g.service === "a")).toBe(false);
    expect(gaps.some((g) => g.service === "b")).toBe(true);
  });

  it("returns no gaps for an empty or degenerate window", () => {
    expect(detectTelemetryGaps([], { start: WINDOW_START, end: WINDOW_START })).toEqual([]);
    expect(detectTelemetryGaps([], { start: WINDOW_END, end: WINDOW_START })).toEqual([]);
  });
});
