import { describe, it, expect } from "vitest";
import {
  mean,
  stddev,
  median,
  medianAbsoluteDeviation,
  computeBaselineStats,
  zScoreOf,
  classifySeverity,
  bucketPoints,
  computeRollingBaseline,
  detectLatencyAnomaly,
  detectErrorRateAnomaly,
  detectMetricValueAnomaly,
  detectAnomalies,
} from "./baseline.js";
import type { Event } from "../event-model/event.schema.js";

const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();
const WINDOW_MS = 1000;

function ts(bucketIndex: number, offsetMs: number = 10): string {
  return new Date(BASE + bucketIndex * WINDOW_MS + offsetMs).toISOString();
}

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    type: overrides.type ?? "trace",
    trace_id: overrides.trace_id ?? null,
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

describe("mean / stddev / computeBaselineStats", () => {
  it("computes mean and stddev correctly", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(1.63299, 4);
  });

  it("returns zeros for empty input", () => {
    expect(mean([])).toBe(0);
    expect(stddev([])).toBe(0);
    expect(computeBaselineStats([])).toEqual({
      mean: 0,
      stddev: 0,
      count: 0,
      method: "mean_stddev",
    });
  });
});

describe("zScoreOf", () => {
  it("computes a standard z-score", () => {
    const baseline = { mean: 100, stddev: 10, count: 5, method: "mean_stddev" as const };
    expect(zScoreOf(120, baseline)).toBeCloseTo(2, 5);
  });

  it("handles zero stddev without producing Infinity", () => {
    const baseline = { mean: 100, stddev: 0, count: 5, method: "mean_stddev" as const };
    expect(zScoreOf(100, baseline)).toBe(0);
    expect(zScoreOf(150, baseline)).toBe(10);
    expect(zScoreOf(50, baseline)).toBe(-10);
  });
});

describe("classifySeverity", () => {
  it("buckets z-scores into severity tiers", () => {
    expect(classifySeverity(0.5)).toBe("none");
    expect(classifySeverity(1.5)).toBe("low");
    expect(classifySeverity(2.5)).toBe("medium");
    expect(classifySeverity(4)).toBe("high");
    expect(classifySeverity(-4)).toBe("high");
  });
});

describe("bucketPoints", () => {
  it("groups points into fixed-size time windows", () => {
    const points = [
      { timestamp: ts(0, 0), value: 10 },
      { timestamp: ts(0, 500), value: 20 },
      { timestamp: ts(1, 0), value: 30 },
    ];
    const buckets = bucketPoints(points, WINDOW_MS);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].value).toBe(15);
    expect(buckets[0].count).toBe(2);
    expect(buckets[1].value).toBe(30);
  });
});

describe("computeRollingBaseline", () => {
  it("flags insufficient data when too few baseline buckets exist", () => {
    const points = [
      { timestamp: ts(0), value: 100 },
      { timestamp: ts(1), value: 500 },
    ];
    const result = computeRollingBaseline(points, {
      windowMs: WINDOW_MS,
      minBaselineBuckets: 3,
    });
    expect(result.insufficient_data).toBe(true);
    expect(result.is_anomalous).toBe(false);
  });

  it("detects a latency spike against a stable rolling baseline", () => {
    const points = [
      { timestamp: ts(0), value: 95 },
      { timestamp: ts(1), value: 100 },
      { timestamp: ts(2), value: 105 },
      { timestamp: ts(3), value: 100 },
      { timestamp: ts(4), value: 100 },
      { timestamp: ts(5), value: 900 },
    ];
    const result = computeRollingBaseline(points, {
      windowMs: WINDOW_MS,
      baselineBuckets: 5,
      minBaselineBuckets: 3,
      zScoreThreshold: 2,
    });
    expect(result.insufficient_data).toBe(false);
    expect(result.current_value).toBe(900);
    expect(result.is_anomalous).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("does not flag a current bucket within normal variance", () => {
    const points = [
      { timestamp: ts(0), value: 95 },
      { timestamp: ts(1), value: 100 },
      { timestamp: ts(2), value: 105 },
      { timestamp: ts(3), value: 98 },
      { timestamp: ts(4), value: 102 },
      { timestamp: ts(5), value: 101 },
    ];
    const result = computeRollingBaseline(points, {
      windowMs: WINDOW_MS,
      baselineBuckets: 5,
      minBaselineBuckets: 3,
    });
    expect(result.is_anomalous).toBe(false);
    expect(result.severity).toBe("none");
  });
});

describe("detectLatencyAnomaly", () => {
  it("detects a duration_ms spike for a service", () => {
    const events: Event[] = [
      makeEvent({ service: "checkout", duration_ms: 100, timestamp: ts(0) }),
      makeEvent({ service: "checkout", duration_ms: 105, timestamp: ts(1) }),
      makeEvent({ service: "checkout", duration_ms: 95, timestamp: ts(2) }),
      makeEvent({ service: "checkout", duration_ms: 100, timestamp: ts(3) }),
      makeEvent({ service: "checkout", duration_ms: 100, timestamp: ts(4) }),
      makeEvent({ service: "checkout", duration_ms: 950, timestamp: ts(5) }),
      makeEvent({ service: "other-service", duration_ms: 1, timestamp: ts(5) }),
    ];
    const result = detectLatencyAnomaly(events, "checkout", {
      windowMs: WINDOW_MS,
      baselineBuckets: 5,
      minBaselineBuckets: 3,
    });
    expect(result.metric).toBe("duration_ms");
    expect(result.service).toBe("checkout");
    expect(result.is_anomalous).toBe(true);
    expect(result.current_value).toBe(950);
  });
});

describe("detectErrorRateAnomaly", () => {
  it("detects an error rate spike for a service", () => {
    const events: Event[] = [];
    for (let bucket = 0; bucket < 5; bucket += 1) {
      for (let i = 0; i < 10; i += 1) {
        events.push(
          makeEvent({
            service: "payments",
            severity: i === 0 ? "error" : "info",
            timestamp: ts(bucket, i),
          }),
        );
      }
    }
    for (let i = 0; i < 10; i += 1) {
      events.push(
        makeEvent({
          service: "payments",
          severity: i < 9 ? "error" : "info",
          timestamp: ts(5, i),
        }),
      );
    }

    const result = detectErrorRateAnomaly(events, "payments", {
      windowMs: WINDOW_MS,
      baselineBuckets: 5,
      minBaselineBuckets: 3,
    });
    expect(result.metric).toBe("error_rate");
    expect(result.current_value).toBeCloseTo(0.9, 5);
    expect(result.is_anomalous).toBe(true);
  });
});

describe("detectMetricValueAnomaly", () => {
  it("detects a metric value spike for a named metric", () => {
    const events: Event[] = [];
    const baselineValues = [48, 50, 52, 49, 51];
    baselineValues.forEach((value, i) => {
      events.push(
        makeEvent({
          service: "worker",
          type: "metric",
          attributes: { name: "cpu_usage", value },
          timestamp: ts(i),
        }),
      );
    });
    events.push(
      makeEvent({
        service: "worker",
        type: "metric",
        attributes: { name: "cpu_usage", value: 98 },
        timestamp: ts(5),
      }),
    );

    const result = detectMetricValueAnomaly(events, "worker", "cpu_usage", {
      windowMs: WINDOW_MS,
      baselineBuckets: 5,
      minBaselineBuckets: 3,
    });
    expect(result.metric).toBe("metric:cpu_usage");
    expect(result.current_value).toBe(98);
    expect(result.is_anomalous).toBe(true);
  });
});

describe("detectAnomalies", () => {
  it("runs latency, error rate, and all discovered metric checks for a service", () => {
    const events: Event[] = [
      makeEvent({ service: "api", duration_ms: 100, timestamp: ts(0) }),
      makeEvent({
        service: "api",
        type: "metric",
        attributes: { name: "queue_depth", value: 5 },
        timestamp: ts(0),
      }),
    ];
    const results = detectAnomalies(events, "api", { windowMs: WINDOW_MS });
    const metrics = results.map((r) => r.metric);
    expect(metrics).toContain("duration_ms");
    expect(metrics).toContain("error_rate");
    expect(metrics).toContain("metric:queue_depth");
  });
});

describe("median / medianAbsoluteDeviation", () => {
  it("computes median for odd and even length arrays", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("computes median absolute deviation", () => {
    expect(medianAbsoluteDeviation([1, 1, 1, 1, 100])).toBe(0);
    expect(medianAbsoluteDeviation([10, 12, 12, 13, 14])).toBe(1);
  });
});

describe("robust stats for heavy-tailed latency", () => {
  it("does not get skewed by a single extreme outlier the way mean/stddev does", () => {
    const baselineValues = [100, 105, 98, 102, 101, 99, 103, 100, 104, 5000];
    const meanBased = computeBaselineStats(baselineValues, false);
    const robust = computeBaselineStats(baselineValues, true);
    expect(robust.mean).toBeLessThan(meanBased.mean);
    expect(robust.stddev).toBeLessThan(meanBased.stddev);
  });

  it("flags a genuine latency spike using robust stats without cold-start false positives", () => {
    const events: Event[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(
        makeEvent({
          service: "checkout",
          duration_ms: 100 + (i % 3),
          timestamp: ts(i),
        }),
      );
    }
    for (let i = 0; i < 5; i++) {
      events.push(
        makeEvent({
          service: "checkout",
          duration_ms: 2000 + i,
          timestamp: ts(10, 10 + i),
        }),
      );
    }
    const result = detectLatencyAnomaly(events, "checkout", {
      windowMs: WINDOW_MS,
      baselineBuckets: 10,
      minBaselineBuckets: 3,
      useRobustStats: true,
    });
    expect(result.baseline.method).toBe("median_mad");
    expect(result.is_anomalous).toBe(true);
  });
});

describe("deployment-aware baselining", () => {
  it("compares against same-deployment history instead of a stale cross-deployment average", () => {
    const events: Event[] = [];
    for (let i = 0; i < 6; i++) {
      events.push(
        makeEvent({
          service: "checkout",
          duration_ms: 500,
          deployment_id: "dep-old",
          timestamp: ts(i),
        }),
      );
    }
    for (let i = 6; i < 12; i++) {
      events.push(
        makeEvent({
          service: "checkout",
          duration_ms: 105,
          deployment_id: "dep-new",
          timestamp: ts(i),
        }),
      );
    }
    const deploymentAwareResult = detectLatencyAnomaly(events, "checkout", {
      windowMs: WINDOW_MS,
      baselineBuckets: 11,
      minBaselineBuckets: 3,
      deploymentAware: true,
    });
    const unawareResult = detectLatencyAnomaly(events, "checkout", {
      windowMs: WINDOW_MS,
      baselineBuckets: 11,
      minBaselineBuckets: 3,
      deploymentAware: false,
    });
    expect(deploymentAwareResult.is_anomalous).toBe(false);
    expect(unawareResult.severity).not.toBe("none");
  });
});

describe("cold-start / low sample size handling", () => {
  it("does not flag anomalies on a bucket with too few samples to be statistically meaningful", () => {
    const events: Event[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(
        makeEvent({
          service: "worker",
          duration_ms: 100,
          timestamp: ts(i),
        }),
      );
    }
    events.push(
      makeEvent({ service: "worker", duration_ms: 5000, timestamp: ts(10) }),
    );
    const result = detectLatencyAnomaly(events, "worker", {
      windowMs: WINDOW_MS,
      baselineBuckets: 10,
      minBaselineBuckets: 3,
      minSampleSize: 5,
    });
    expect(result.low_sample_size).toBe(true);
    expect(result.is_anomalous).toBe(false);
  });
});
