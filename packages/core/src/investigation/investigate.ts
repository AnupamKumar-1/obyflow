import { SqliteStore, rowToEvent } from "../storage/sqlite-store.js";
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
  const lookbackMs =
    options.baselineLookbackMs ?? computeLookbackMs(options.anomalyOptions);

  const anomalies: AnomalyResult[] = [];
  for (const service of trace.services) {
    const baselineStartIso = new Date(
      new Date(trace.window.start).getTime() - lookbackMs,
    ).toISOString();
    const rows = store.getByServiceWindow(service, baselineStartIso, trace.window.end);
    const events = rows.map(rowToEvent);
    anomalies.push(...detectAnomalies(events, service, options.anomalyOptions));
  }

  const evidence = buildEvidence(trace, anomalies, options.evidenceOptions);
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
