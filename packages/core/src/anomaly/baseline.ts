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

