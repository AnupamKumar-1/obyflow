import { Event } from "../event-model/event.schema.js";

export type DeviationSeverity = "none" | "low" | "medium" | "high";

export interface BaselineStats {
  mean: number;
  stddev: number;
  count: number;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface BucketAggregate {
  bucket_start: string;
  bucket_end: string;
  value: number;
  count: number;
}

export interface RollingBaselineOptions {
  windowMs?: number;
  baselineBuckets?: number;
  minBaselineBuckets?: number;
  zScoreThreshold?: number;
}

export interface RollingBaselineResult {
  baseline: BaselineStats;
  current_value: number;
  current_count: number;
  z_score: number;
  severity: DeviationSeverity;
  is_anomalous: boolean;
  insufficient_data: boolean;
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
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_BASELINE_BUCKETS = 12;
const DEFAULT_MIN_BASELINE_BUCKETS = 3;
const DEFAULT_Z_SCORE_THRESHOLD = 2;
const ZERO_STDDEV_Z_SCORE = 10;

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

export function computeBaselineStats(values: number[]): BaselineStats {
  const m = mean(values);
  return { mean: m, stddev: stddev(values, m), count: values.length };
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

export function bucketPoints(
  points: TimeSeriesPoint[],
  windowMs: number,
): BucketAggregate[] {
  if (points.length === 0) return [];
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    const ts = new Date(point.timestamp).getTime();
    const bucketStart = Math.floor(ts / windowMs) * windowMs;
    const values = buckets.get(bucketStart) ?? [];
    values.push(point.value);
    buckets.set(bucketStart, values);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, values]) => ({
      bucket_start: new Date(bucketStart).toISOString(),
      bucket_end: new Date(bucketStart + windowMs).toISOString(),
      value: mean(values),
      count: values.length,
    }));
}

function emptyRollingResult(): RollingBaselineResult {
  return {
    baseline: { mean: 0, stddev: 0, count: 0 },
    current_value: 0,
    current_count: 0,
    z_score: 0,
    severity: "none",
    is_anomalous: false,
    insufficient_data: true,
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

  const buckets = bucketPoints(points, windowMs);

  if (buckets.length === 0) {
    return emptyRollingResult();
  }

  const current = buckets[buckets.length - 1];
  const priorBuckets = buckets.slice(
    Math.max(0, buckets.length - 1 - baselineBuckets),
    buckets.length - 1,
  );

  if (priorBuckets.length < minBaselineBuckets) {
    return {
      baseline: computeBaselineStats(priorBuckets.map((b) => b.value)),
      current_value: current.value,
      current_count: current.count,
      z_score: 0,
      severity: "none",
      is_anomalous: false,
      insufficient_data: true,
      buckets,
    };
  }

  const baseline = computeBaselineStats(priorBuckets.map((b) => b.value));
  const zScore = zScoreOf(current.value, baseline);
  const severity = classifySeverity(zScore);

  return {
    baseline,
    current_value: current.value,
    current_count: current.count,
    z_score: zScore,
    severity,
    is_anomalous: Math.abs(zScore) >= zScoreThreshold,
    insufficient_data: false,
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
  };
}

export function detectLatencyAnomaly(
  events: Event[],
  service: string,
  options?: RollingBaselineOptions,
): AnomalyResult {
  const points = events
    .filter((e) => e.service === service && e.duration_ms !== null)
    .map((e) => ({ timestamp: e.timestamp, value: e.duration_ms as number }));
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