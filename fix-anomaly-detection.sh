#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR"
if [ ! -f package.json ] || ! grep -q "obyflow" package.json; then
  echo "run this from the obyflow repo root, or pass its path as the first argument"
  exit 1
fi
command -v corepack >/dev/null 2>&1 && corepack enable || true
pnpm install

cat > packages/core/src/anomaly/baseline.ts << 'BASELINE_TS_EOF'
import { Event } from "../event-model/event.schema.js";

export type DeviationSeverity = "none" | "low" | "medium" | "high";
export type BaselineStatsMethod = "mean_stddev" | "median_mad";

export interface BaselineStats {
  mean: number;
  stddev: number;
  count: number;
  method: BaselineStatsMethod;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  deployment_id?: string | null;
}

export interface BucketAggregate {
  bucket_start: string;
  bucket_end: string;
  value: number;
  count: number;
  dominant_deployment_id: string | null;
}

export interface RollingBaselineOptions {
  windowMs?: number;
  baselineBuckets?: number;
  minBaselineBuckets?: number;
  zScoreThreshold?: number;
  useRobustStats?: boolean;
  deploymentAware?: boolean;
  minSampleSize?: number;
}

export interface RollingBaselineResult {
  baseline: BaselineStats;
  current_value: number;
  current_count: number;
  z_score: number;
  severity: DeviationSeverity;
  is_anomalous: boolean;
  insufficient_data: boolean;
  low_sample_size: boolean;
  buckets: BucketAggregate[];
}

export interface AnomalyResult {
  metric: string;
  service: string;
  baseline: BaselineStats;
  current_value: number;
  current_count: number;
  z_score: number;
  severity: DeviationSeverity;
  is_anomalous: boolean;
  insufficient_data: boolean;
  low_sample_size: boolean;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_BASELINE_BUCKETS = 12;
const DEFAULT_MIN_BASELINE_BUCKETS = 3;
const DEFAULT_Z_SCORE_THRESHOLD = 2;
const DEFAULT_MIN_SAMPLE_SIZE = 1;
const ZERO_STDDEV_Z_SCORE = 10;
const MAD_CONSISTENCY_SCALE = 1.4826;

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function stddev(values: number[], meanValue?: number): number {
  if (values.length === 0) return 0;
  const m = meanValue ?? mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function medianAbsoluteDeviation(
  values: number[],
  medianValue?: number,
): number {
  if (values.length === 0) return 0;
  const m = medianValue ?? median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

export function computeBaselineStats(
  values: number[],
  useRobustStats = false,
): BaselineStats {
  if (useRobustStats) {
    const m = median(values);
    const mad = medianAbsoluteDeviation(values, m);
    return {
      mean: m,
      stddev: mad * MAD_CONSISTENCY_SCALE,
      count: values.length,
      method: "median_mad",
    };
  }
  const m = mean(values);
  return {
    mean: m,
    stddev: stddev(values, m),
    count: values.length,
    method: "mean_stddev",
  };
}

export function zScoreOf(value: number, baseline: BaselineStats): number {
  if (baseline.stddev === 0) {
    if (value === baseline.mean) return 0;
    return value > baseline.mean ? ZERO_STDDEV_Z_SCORE : -ZERO_STDDEV_Z_SCORE;
  }
  return (value - baseline.mean) / baseline.stddev;
}

export function classifySeverity(zScore: number): DeviationSeverity {
  const abs = Math.abs(zScore);
  if (abs < 1) return "none";
  if (abs < 2) return "low";
  if (abs < 3) return "medium";
  return "high";
}

function dominantDeploymentId(
  points: { deployment_id?: string | null }[],
): string | null {
  const counts = new Map<string, number>();
  for (const point of points) {
    if (!point.deployment_id) continue;
    counts.set(point.deployment_id, (counts.get(point.deployment_id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function bucketPoints(
  points: TimeSeriesPoint[],
  windowMs: number,
): BucketAggregate[] {
  if (points.length === 0) return [];
  const buckets = new Map<number, TimeSeriesPoint[]>();
  for (const point of points) {
    const ts = new Date(point.timestamp).getTime();
    const bucketStart = Math.floor(ts / windowMs) * windowMs;
    const bucketPointsList = buckets.get(bucketStart) ?? [];
    bucketPointsList.push(point);
    buckets.set(bucketStart, bucketPointsList);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, bucketPointsList]) => ({
      bucket_start: new Date(bucketStart).toISOString(),
      bucket_end: new Date(bucketStart + windowMs).toISOString(),
      value: mean(bucketPointsList.map((p) => p.value)),
      count: bucketPointsList.length,
      dominant_deployment_id: dominantDeploymentId(bucketPointsList),
    }));
}

function emptyRollingResult(): RollingBaselineResult {
  return {
    baseline: { mean: 0, stddev: 0, count: 0, method: "mean_stddev" },
    current_value: 0,
    current_count: 0,
    z_score: 0,
    severity: "none",
    is_anomalous: false,
    insufficient_data: true,
    low_sample_size: true,
    buckets: [],
  };
}

export function computeRollingBaseline(
  points: TimeSeriesPoint[],
  options: RollingBaselineOptions = {},
): RollingBaselineResult {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const baselineBuckets = options.baselineBuckets ?? DEFAULT_BASELINE_BUCKETS;
  const minBaselineBuckets =
    options.minBaselineBuckets ?? DEFAULT_MIN_BASELINE_BUCKETS;
  const zScoreThreshold =
    options.zScoreThreshold ?? DEFAULT_Z_SCORE_THRESHOLD;
  const useRobustStats = options.useRobustStats ?? false;
  const deploymentAware = options.deploymentAware ?? false;
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;

  const buckets = bucketPoints(points, windowMs);

  if (buckets.length === 0) {
    return emptyRollingResult();
  }

  const current = buckets[buckets.length - 1];
  let priorBuckets = buckets.slice(
    Math.max(0, buckets.length - 1 - baselineBuckets),
    buckets.length - 1,
  );

  if (deploymentAware && current.dominant_deployment_id) {
    const sameDeployment = priorBuckets.filter(
      (b) => b.dominant_deployment_id === current.dominant_deployment_id,
    );
    if (sameDeployment.length >= minBaselineBuckets) {
      priorBuckets = sameDeployment;
    }
  }

  const lowSampleSize = current.count < minSampleSize;

  if (priorBuckets.length < minBaselineBuckets) {
    return {
      baseline: computeBaselineStats(
        priorBuckets.map((b) => b.value),
        useRobustStats,
      ),
      current_value: current.value,
      current_count: current.count,
      z_score: 0,
      severity: "none",
      is_anomalous: false,
      insufficient_data: true,
      low_sample_size: lowSampleSize,
      buckets,
    };
  }

  const baseline = computeBaselineStats(
    priorBuckets.map((b) => b.value),
    useRobustStats,
  );
  const zScore = zScoreOf(current.value, baseline);
  const severity = classifySeverity(zScore);

  return {
    baseline,
    current_value: current.value,
    current_count: current.count,
    z_score: zScore,
    severity,
    is_anomalous: !lowSampleSize && Math.abs(zScore) >= zScoreThreshold,
    insufficient_data: false,
    low_sample_size: lowSampleSize,
    buckets,
  };
}

function toAnomalyResult(
  metric: string,
  service: string,
  result: RollingBaselineResult,
): AnomalyResult {
  return {
    metric,
    service,
    baseline: result.baseline,
    current_value: result.current_value,
    current_count: result.current_count,
    z_score: result.z_score,
    severity: result.severity,
    is_anomalous: result.is_anomalous,
    insufficient_data: result.insufficient_data,
    low_sample_size: result.low_sample_size,
  };
}

export function detectLatencyAnomaly(
  events: Event[],
  service: string,
  options?: RollingBaselineOptions,
): AnomalyResult {
  const points = events
    .filter((e) => e.service === service && e.duration_ms !== null)
    .map((e) => ({
      timestamp: e.timestamp,
      value: e.duration_ms as number,
      deployment_id: e.deployment_id,
    }));
  const result = computeRollingBaseline(points, options);
  return toAnomalyResult("duration_ms", service, result);
}

export function detectErrorRateAnomaly(
  events: Event[],
  service: string,
  options?: RollingBaselineOptions,
): AnomalyResult {
  const points = events
    .filter((e) => e.service === service)
    .map((e) => ({
      timestamp: e.timestamp,
      value: e.severity === "error" || e.severity === "critical" ? 1 : 0,
      deployment_id: e.deployment_id,
    }));
  const result = computeRollingBaseline(points, options);
  return toAnomalyResult("error_rate", service, result);
}

export function detectMetricValueAnomaly(
  events: Event[],
  service: string,
  metricName: string,
  options?: RollingBaselineOptions,
): AnomalyResult {
  const points = events
    .filter(
      (e) =>
        e.service === service &&
        e.type === "metric" &&
        e.attributes?.["name"] === metricName &&
        typeof e.attributes?.["value"] === "number",
    )
    .map((e) => ({
      timestamp: e.timestamp,
      value: e.attributes["value"] as number,
      deployment_id: e.deployment_id,
    }));
  const result = computeRollingBaseline(points, options);
  return toAnomalyResult(`metric:${metricName}`, service, result);
}

export function detectAnomalies(
  events: Event[],
  service: string,
  options?: RollingBaselineOptions,
): AnomalyResult[] {
  const results: AnomalyResult[] = [];
  results.push(detectLatencyAnomaly(events, service, options));
  results.push(detectErrorRateAnomaly(events, service, options));

  const metricNames = new Set<string>();
  for (const event of events) {
    if (event.service === service && event.type === "metric") {
      const name = event.attributes?.["name"];
      if (typeof name === "string") metricNames.add(name);
    }
  }
  for (const name of metricNames) {
    results.push(detectMetricValueAnomaly(events, service, name, options));
  }

  return results;
}

BASELINE_TS_EOF

cat > packages/core/src/anomaly/baseline.test.ts << 'BASELINE_TEST_TS_EOF'
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
BASELINE_TEST_TS_EOF

cat > packages/core/src/investigation/investigate.ts << 'INVESTIGATE_TS_EOF'
import { SqliteStore, rowToEvent } from "../storage/sqlite-store.js";
import { Event } from "../event-model/event.schema.js";
import { correlateTrace, CorrelatedTrace } from "../correlation/correlate.js";
import {
  detectAnomalies,
  AnomalyResult,
  RollingBaselineOptions,
} from "../anomaly/baseline.js";
import {
  buildEvidence,
  BuildEvidenceOptions,
  EvidenceObject,
} from "../evidence/build-evidence.js";
import { assessConfidence, ConfidenceAssessment } from "../confidence/confidence.js";

export interface InvestigateOptions {
  windowPaddingMs?: number;
  baselineLookbackMs?: number;
  anomalyOptions?: RollingBaselineOptions;
  evidenceOptions?: BuildEvidenceOptions;
}

export interface InvestigationResult {
  trace: CorrelatedTrace;
  anomalies: AnomalyResult[];
  evidence: EvidenceObject;
  confidence: ConfidenceAssessment;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_BASELINE_BUCKETS = 12;
const DEFAULT_ANOMALY_OPTIONS: RollingBaselineOptions = {
  useRobustStats: true,
  deploymentAware: true,
};

function computeLookbackMs(options?: RollingBaselineOptions): number {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const baselineBuckets = options?.baselineBuckets ?? DEFAULT_BASELINE_BUCKETS;
  return (baselineBuckets + 1) * windowMs;
}

export function investigateTrace(
  store: SqliteStore,
  traceId: string,
  options: InvestigateOptions = {},
): InvestigationResult {
  const trace = correlateTrace(store, traceId, options.windowPaddingMs);
  const anomalyOptions: RollingBaselineOptions = {
    ...DEFAULT_ANOMALY_OPTIONS,
    ...options.anomalyOptions,
  };
  const lookbackMs =
    options.baselineLookbackMs ?? computeLookbackMs(anomalyOptions);

  const anomalies: AnomalyResult[] = [];
  const historicalEvents: Event[] = [];
  for (const service of trace.services) {
    const baselineStartIso = new Date(
      new Date(trace.window.start).getTime() - lookbackMs,
    ).toISOString();
    const rows = store.getByServiceWindow(service, baselineStartIso, trace.window.end);
    const events = rows.map(rowToEvent);
    anomalies.push(...detectAnomalies(events, service, anomalyOptions));
    for (const event of events) {
      if (event.timestamp < trace.window.start) {
        historicalEvents.push(event);
      }
    }
  }

  const telemetryFailureRows = store.getTelemetryFailures({
    sinceIso: trace.window.start,
    untilIso: trace.window.end,
    limit: 50,
  });
  const telemetryFailures = telemetryFailureRows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    service: row.service,
    operation: row.operation,
    reason: row.reason,
  }));

  const evidence = buildEvidence(
    trace,
    anomalies,
    options.evidenceOptions,
    historicalEvents,
    telemetryFailures,
  );
  const confidence = assessConfidence(evidence);

  return { trace, anomalies, evidence, confidence };
}

export function findMostSevereTraceInWindow(
  store: SqliteStore,
  sinceIso: string,
  service?: string,
): string | null {
  const errorRows = store.getErrors({ service, sinceIso, limit: 500 });
  const counts = new Map<string, number>();

  for (const row of errorRows) {
    if (!row.trace_id) continue;
    counts.set(row.trace_id, (counts.get(row.trace_id) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = -1;
  for (const [traceId, count] of counts) {
    if (count > bestCount) {
      best = traceId;
      bestCount = count;
    }
  }

  return best;
}


INVESTIGATE_TS_EOF

cat > packages/cli/src/render/investigation.ts << 'INVESTIGATION_RENDER_TS_EOF'
import chalk from "chalk";
import type {
  EvidenceObject,
  ConfidenceAssessment,
  RetrievalDiagnosis,
  ChainStepDiagnosis,
  EvidenceGraph,
  EvidenceEdgeType,
  TelemetryHealthReport,
  ChangeEvent,
} from "@obyflow/core";
import type { LLMInvestigationResult } from "@obyflow/llm-core";

const confidenceColor: Record<string, (s: string) => string> = {
  HIGH: chalk.green,
  MEDIUM: chalk.yellow,
  LOW: chalk.red,
};

function formatConfidence(confidence: ConfidenceAssessment): string {
  const colorFn = confidenceColor[confidence.tier] ?? chalk.white;
  return chalk.bold(colorFn(confidence.tier));
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTokenCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US");
}

function formatCostUsd(value: number | null): string | null {
  if (value === null) return null;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function usageColor(percentage: number): (s: string) => string {
  if (percentage >= 90) return chalk.red;
  if (percentage >= 80) return chalk.yellow;
  return chalk.green;
}

function renderTokenUsageLines(llmResult: LLMInvestigationResult): string[] {
  const { usage, context_limit: contextLimit, token_warning: warning, estimated_cost_usd: costUsd } = llmResult;
  const lines: string[] = [];

  const used = usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
  const percentage = contextLimit > 0 ? Math.round((used / contextLimit) * 1000) / 10 : 0;
  const colorFn = usageColor(percentage);

  const parts = [
    `${chalk.dim("in")} ${formatTokenCount(usage.input_tokens)}`,
    `${chalk.dim("out")} ${formatTokenCount(usage.output_tokens)}`,
    `${chalk.dim("total")} ${colorFn(`${formatTokenCount(usage.total_tokens)} / ${formatTokenCount(contextLimit)}`)} ${chalk.dim(`(${percentage}%)`)}`,
  ];
  const cost = formatCostUsd(costUsd);
  if (cost) parts.push(`${chalk.dim("est. cost")} ${cost}`);

  lines.push(`${chalk.dim("tokens")}      ${parts.join(chalk.dim("  ·  "))}`);

  if (warning) {
    lines.push("");
    lines.push(chalk.yellow.bold(`⚠ ${warning.message}`));
    lines.push(
      chalk.yellow(
        `  Used: ${formatTokenCount(warning.used_tokens)} / ${formatTokenCount(warning.limit_tokens)} tokens (${warning.usage_percentage}%)`,
      ),
    );
    lines.push("");
    lines.push(chalk.dim("  Suggestions:"));
    for (const suggestion of warning.suggestions) {
      lines.push(chalk.dim(`   • ${suggestion}`));
    }
  }

  return lines;
}

function renderEvidenceItems(evidence: EvidenceObject, refs: string[]): string {
  const refSet = new Set(refs);
  if (evidence.evidence.length === 0) {
    return chalk.dim("  (no evidence collected)");
  }
  return evidence.evidence
    .map((item) => {
      const marker = refSet.has(item.id) ? chalk.cyan("→") : " ";
      const sev = item.severity ? ` [${item.severity}]` : "";
      return `${marker} ${chalk.dim(item.id.slice(0, 8))}  ${chalk.bold(item.service)}  ${item.type}${sev}  ${formatDuration(item.duration_ms)}  ${chalk.dim(item.reason)}`;
    })
    .join("\n");
}

function renderRetrievalDiagnosis(diagnosis: RetrievalDiagnosis): string[] {
  if (!diagnosis.detected) return [];
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.magenta("Retrieval Layer"));
  if (diagnosis.summary) {
    lines.push(diagnosis.summary);
  }
  for (const signal of diagnosis.signals) {
    lines.push(
      `  ${chalk.bold(signal.service)}  ${signal.type}  [${signal.severity}]  ${chalk.dim(signal.reason)}`,
    );
  }
  return lines;
}

function renderChainStepDiagnosis(diagnosis: ChainStepDiagnosis): string[] {
  if (!diagnosis.detected) return [];
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.magenta("Chain Steps"));
  if (diagnosis.summary) {
    lines.push(diagnosis.summary);
  }
  for (const signal of diagnosis.signals) {
    lines.push(
      `  ${chalk.bold(signal.service)}  ${signal.step_kind}:${signal.step_name}  ${signal.type}  [${signal.severity}]  ${chalk.dim(signal.reason)}`,
    );
  }
  return lines;
}

const edgeTypeColor: Record<EvidenceEdgeType, (s: string) => string> = {
  CALLED: chalk.blue,
  FAILED: chalk.red,
  CAUSED: chalk.magenta,
  AFFECTED: chalk.yellow,
};

const edgeTypeOrder: EvidenceEdgeType[] = ["CALLED", "FAILED", "CAUSED", "AFFECTED"];

const MAX_EVIDENCE_GRAPH_EDGES_SHOWN = 20;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function renderEvidenceGraph(graph: EvidenceGraph): string[] {
  if (graph.edges.length === 0) return [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.magenta("Evidence Graph"));

  const counts = edgeTypeOrder
    .map((type) => `${type} ${graph.edges.filter((e) => e.type === type).length}`)
    .join(chalk.dim("  ·  "));
  lines.push(chalk.dim(counts));

  const sorted = graph.edges
    .slice()
    .sort((a, b) => edgeTypeOrder.indexOf(a.type) - edgeTypeOrder.indexOf(b.type));

  for (const edge of sorted.slice(0, MAX_EVIDENCE_GRAPH_EDGES_SHOWN)) {
    const colorFn = edgeTypeColor[edge.type] ?? chalk.white;
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const fromLabel = fromNode ? `${fromNode.service}[${shortId(fromNode.id)}]` : shortId(edge.from);
    const toLabel = toNode ? `${toNode.service}[${shortId(toNode.id)}]` : shortId(edge.to);
    lines.push(
      `  ${fromLabel} ${colorFn(`--${edge.type}-->`)} ${toLabel}  ${chalk.dim(edge.reason)}`,
    );
  }

  const remaining = sorted.length - MAX_EVIDENCE_GRAPH_EDGES_SHOWN;
  if (remaining > 0) {
    lines.push(chalk.dim(`  … ${remaining} more edge(s)`));
  }

  return lines;
}

const MAX_TELEMETRY_FAILURES_SHOWN = 5;
const MAX_TELEMETRY_GAPS_SHOWN = 5;

function renderTelemetryHealth(health: TelemetryHealthReport): string[] {
  if (health.dropped_event_count === 0 && health.gaps.length === 0) return [];

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.magenta("Telemetry Health"));

  if (health.dropped_event_count > 0) {
    lines.push(
      chalk.yellow(
        `⚠ ${health.dropped_event_count} telemetry write failure(s) during this trace's window`,
      ),
    );
    for (const failure of health.recent_failures.slice(0, MAX_TELEMETRY_FAILURES_SHOWN)) {
      const service = failure.service ? ` [${failure.service}]` : "";
      lines.push(
        `  ${chalk.dim(failure.timestamp)}  ${chalk.bold(failure.operation)}${service}  ${chalk.dim(failure.reason)}`,
      );
    }
    const remainingFailures = health.recent_failures.length - MAX_TELEMETRY_FAILURES_SHOWN;
    if (remainingFailures > 0) {
      lines.push(chalk.dim(`  … ${remainingFailures} more failure(s)`));
    }
  }

  if (health.gaps.length > 0) {
    lines.push(
      chalk.yellow(
        `⚠ ${health.gaps.length} possible telemetry gap(s) detected (silence longer than expected)`,
      ),
    );
    for (const gap of health.gaps.slice(0, MAX_TELEMETRY_GAPS_SHOWN)) {
      lines.push(
        `  ${chalk.bold(gap.service)}  ${gap.start} → ${gap.end}  ${chalk.dim(formatDuration(gap.duration_ms))}`,
      );
    }
    const remainingGaps = health.gaps.length - MAX_TELEMETRY_GAPS_SHOWN;
    if (remainingGaps > 0) {
      lines.push(chalk.dim(`  … ${remainingGaps} more gap(s)`));
    }
  }

  return lines;
}

const MAX_WHAT_CHANGED_SHOWN = 8;

function renderWhatChanged(changes: ChangeEvent[]): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("What Changed"));
  if (changes.length === 0) {
    lines.push(chalk.dim("  no deployment changes detected near this incident window"));
    return lines;
  }
  for (const change of changes.slice(0, MAX_WHAT_CHANGED_SHOWN)) {
    lines.push(
      `  ${chalk.bold(change.service)}  ${chalk.dim(change.detected_at)}  ${chalk.dim(change.reason)}`,
    );
    lines.push(
      `    ${chalk.dim("anomalies correlated:")} ${change.correlated_anomaly_count}  ${chalk.dim("relevance:")} ${change.relevance_score}`,
    );
  }
  const remaining = changes.length - MAX_WHAT_CHANGED_SHOWN;
  if (remaining > 0) {
    lines.push(chalk.dim(`  … ${remaining} more change(s)`));
  }
  return lines;
}

function renderWhatBroke(evidenceObject: EvidenceObject): string[] {
  const anomalous = evidenceObject.anomalies.filter((a) => a.is_anomalous);
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("What Broke"));
  if (anomalous.length === 0 && evidenceObject.summary.error_count === 0) {
    lines.push(chalk.dim("  no anomalies or errors detected in this trace's window"));
    return lines;
  }
  if (evidenceObject.summary.error_count > 0) {
    lines.push(chalk.dim(`  ${evidenceObject.summary.error_count} error event(s) in trace window`));
  }
  for (const anomaly of anomalous) {
    const method = anomaly.baseline.method === "median_mad" ? " (robust)" : "";
    lines.push(
      `  ${chalk.bold(anomaly.service)} ${anomaly.metric}  z=${anomaly.z_score.toFixed(2)}  ${anomaly.severity}${method}`,
    );
  }
  return lines;
}

const MAX_CAUSAL_CHAIN_EDGES_SHOWN = 15;

function renderCausalChain(graph: EvidenceGraph): string[] {
  const causal = graph.edges.filter((e) => e.type === "CAUSED" || e.type === "AFFECTED");
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("Causal Chain"));
  if (causal.length === 0) {
    lines.push(chalk.dim("  no CAUSED/AFFECTED relationships established for this trace"));
    return lines;
  }
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of causal.slice(0, MAX_CAUSAL_CHAIN_EDGES_SHOWN)) {
    const colorFn = edgeTypeColor[edge.type] ?? chalk.white;
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const fromLabel = fromNode ? `${fromNode.service}[${shortId(fromNode.id)}]` : shortId(edge.from);
    const toLabel = toNode ? `${toNode.service}[${shortId(toNode.id)}]` : shortId(edge.to);
    lines.push(
      `  ${fromLabel} ${colorFn(`--${edge.type}-->`)} ${toLabel}  ${chalk.dim(edge.reason)}`,
    );
  }
  const remaining = causal.length - MAX_CAUSAL_CHAIN_EDGES_SHOWN;
  if (remaining > 0) {
    lines.push(chalk.dim(`  … ${remaining} more relationship(s)`));
  }
  return lines;
}

function renderSimilarHistoricalIncidents(): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("Similar Historical Incidents"));
  lines.push(
    chalk.dim(
      "  historical incident memory/fingerprinting is not implemented yet (see roadmap item 12)",
    ),
  );
  return lines;
}

export interface InvestigationReportInput {
  title: string;
  traceId: string;
  evidenceObject: EvidenceObject;
  confidence: ConfidenceAssessment;
  llmResult: LLMInvestigationResult | null;
  llmNote: string | null;
}

export function renderInvestigationReport(input: InvestigationReportInput): string {
  const { title, traceId, evidenceObject, confidence, llmResult, llmNote } = input;
  const summary = evidenceObject.summary;

  const lines: string[] = [];
  lines.push(chalk.bold.white(`${title}: ${traceId}`));
  lines.push(`${chalk.dim("services")}    ${summary.services.join(", ") || "—"}`);
  lines.push(`${chalk.dim("window")}      ${summary.window.start} → ${summary.window.end}`);
  lines.push(`${chalk.dim("events")}      ${summary.event_count} total, ${summary.error_count} error(s)`);
  lines.push(`${chalk.dim("confidence")}  ${formatConfidence(confidence)}`);
  if (confidence.reasons.length > 0) {
    lines.push(chalk.dim("reasons"));
    for (const reason of confidence.reasons) {
      lines.push(`  ${chalk.dim("+")} ${reason}`);
    }
  }
  lines.push("");

  lines.push(...renderWhatChanged(evidenceObject.what_changed));
  lines.push(...renderWhatBroke(evidenceObject));
  lines.push(...renderCausalChain(evidenceObject.evidence_graph));
  lines.push(...renderSimilarHistoricalIncidents());
  lines.push("");

  if (llmResult) {
    lines.push(chalk.bold.cyan("Root Cause"));
    lines.push(llmResult.root_cause);
    lines.push("");
    lines.push(chalk.bold.cyan("Evidence"));
    lines.push(renderEvidenceItems(evidenceObject, llmResult.evidence_refs));
    lines.push(...renderRetrievalDiagnosis(evidenceObject.retrieval_diagnosis));
    lines.push(...renderChainStepDiagnosis(evidenceObject.chain_step_diagnosis));
    lines.push(...renderEvidenceGraph(evidenceObject.evidence_graph));
    lines.push(...renderTelemetryHealth(evidenceObject.telemetry_health));
    lines.push("");
    lines.push(chalk.bold.cyan("Recommendation"));
    lines.push(llmResult.recommendation);
    lines.push("");
    lines.push(chalk.dim("─".repeat(48)));
    lines.push(`${chalk.dim("model")}       ${llmResult.provider}/${llmResult.model}`);
    lines.push(`${chalk.dim("latency")}     ${formatDuration(llmResult.latency_ms)}`);
    lines.push(...renderTokenUsageLines(llmResult));
    lines.push(`${chalk.dim("requested")}   ${llmResult.requested_at}`);
  } else {
    lines.push(chalk.bold.cyan("Evidence"));
    lines.push(renderEvidenceItems(evidenceObject, []));
    lines.push(...renderRetrievalDiagnosis(evidenceObject.retrieval_diagnosis));
    lines.push(...renderChainStepDiagnosis(evidenceObject.chain_step_diagnosis));
    lines.push(...renderEvidenceGraph(evidenceObject.evidence_graph));
    lines.push(...renderTelemetryHealth(evidenceObject.telemetry_health));

    if (llmNote) {
      lines.push("");
      lines.push(chalk.dim(llmNote));
    }
  }

  return lines.join("\n");
}

INVESTIGATION_RENDER_TS_EOF

python3 - << 'PYPATCH'
def patch(path, old, new):
    with open(path, "r") as f:
        content = f.read()
    if new in content:
        return
    if old not in content:
        raise SystemExit("expected pattern not found in " + path)
    content = content.replace(old, new, 1)
    with open(path, "w") as f:
        f.write(content)

patch(
    "packages/core/src/change/what-changed.test.ts",
    '        baseline: { mean: 100, stddev: 10, count: 12 },\n        current_value: 900,\n        current_count: 5,\n        z_score: 5,\n        is_anomalous: true,\n        severity: "high",\n        insufficient_data: false,\n      },',
    '        baseline: { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },\n        current_value: 900,\n        current_count: 5,\n        z_score: 5,\n        is_anomalous: true,\n        severity: "high",\n        insufficient_data: false,\n        low_sample_size: false,\n      },',
)

patch(
    "packages/core/src/confidence/confidence.test.ts",
    '    baseline: overrides.baseline ?? { mean: 100, stddev: 10, count: 12 },\n    current_value: overrides.current_value ?? 100,\n    current_count: overrides.current_count ?? 1,\n    z_score: overrides.z_score ?? 0,\n    severity: overrides.severity ?? "none",\n    is_anomalous: overrides.is_anomalous ?? false,\n    insufficient_data: overrides.insufficient_data ?? false,\n  };',
    '    baseline: overrides.baseline ?? { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },\n    current_value: overrides.current_value ?? 100,\n    current_count: overrides.current_count ?? 1,\n    z_score: overrides.z_score ?? 0,\n    severity: overrides.severity ?? "none",\n    is_anomalous: overrides.is_anomalous ?? false,\n    insufficient_data: overrides.insufficient_data ?? false,\n    low_sample_size: overrides.low_sample_size ?? false,\n  };',
)

patch(
    "packages/core/src/evidence/build-evidence.test.ts",
    '        baseline: { mean: 100, stddev: 10, count: 12 },\n        current_value: 9000,\n        current_count: 1,\n        z_score: 8,\n        severity: "high",\n        is_anomalous: true,\n        insufficient_data: false,\n      },',
    '        baseline: { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },\n        current_value: 9000,\n        current_count: 1,\n        z_score: 8,\n        severity: "high",\n        is_anomalous: true,\n        insufficient_data: false,\n        low_sample_size: false,\n      },',
)

patch(
    "packages/core/src/evidence/evidence-graph.test.ts",
    '        baseline: { mean: 100, stddev: 10, count: 12 },\n        current_value: 9000,\n        current_count: 1,\n        z_score: 8,\n        severity: "high",\n        is_anomalous: true,\n        insufficient_data: false,\n      },',
    '        baseline: { mean: 100, stddev: 10, count: 12, method: "mean_stddev" as const },\n        current_value: 9000,\n        current_count: 1,\n        z_score: 8,\n        severity: "high",\n        is_anomalous: true,\n        insufficient_data: false,\n        low_sample_size: false,\n      },',
)

print("fixture patches applied")
PYPATCH

pnpm --filter @obyflow/core exec tsc --noEmit
pnpm build
pnpm test
git add -A
git commit -m "fix(core): robust, deployment-aware, cold-start-safe anomaly detection"
