import { SqliteStore } from "../storage/sqlite-store.js";
import { EvidenceObject } from "../evidence/build-evidence.js";
import { TimeWindow } from "../correlation/join-keys.js";

export interface IncidentFingerprint {
  services: string[];
  anomaly_types: string[];
  change_types: string[];
  error_signatures: string[];
}

export interface SimilarIncident {
  incident_id: string;
  trace_id: string;
  window: TimeWindow;
  similarity: number;
  shared_tokens: string[];
  summary: string | null;
}

const MAX_ERROR_SIGNATURES = 10;
const DEFAULT_SIMILARITY_LIMIT = 3;
const DEFAULT_MIN_SIMILARITY = 0.15;
const DEFAULT_LOOKBACK_INCIDENTS = 200;

export function computeFingerprint(evidence: EvidenceObject): IncidentFingerprint {
  const services = Array.from(new Set(evidence.summary.services)).sort();

  const anomalyTypes = Array.from(
    new Set(
      evidence.anomalies
        .filter((a) => a.is_anomalous)
        .map((a) => `${a.service}:${a.metric}`),
    ),
  ).sort();

  const changeTypes = Array.from(
    new Set(evidence.what_changed.map((c) => `${c.service}:${c.type}`)),
  ).sort();

  const errorSignatures = Array.from(
    new Set(
      evidence.evidence
        .filter((item) => item.severity === "error" || item.severity === "critical")
        .map((item) => `${item.service}:${item.type}:${item.reason}`),
    ),
  )
    .sort()
    .slice(0, MAX_ERROR_SIGNATURES);

  return {
    services,
    anomaly_types: anomalyTypes,
    change_types: changeTypes,
    error_signatures: errorSignatures,
  };
}

export function fingerprintToTokens(fingerprint: IncidentFingerprint): string[] {
  return [
    ...fingerprint.services.map((s) => `svc:${s}`),
    ...fingerprint.anomaly_types.map((a) => `anom:${a}`),
    ...fingerprint.change_types.map((c) => `chg:${c}`),
    ...fingerprint.error_signatures.map((e) => `err:${e}`),
  ];
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionSize += 1;
  }
  const unionSize = new Set([...setA, ...setB]).size;
  if (unionSize === 0) return 0;
  return intersectionSize / unionSize;
}

export function findSimilarIncidents(
  store: SqliteStore,
  fingerprint: IncidentFingerprint,
  excludeTraceId: string,
  limit: number = DEFAULT_SIMILARITY_LIMIT,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY,
): SimilarIncident[] {
  const targetTokens = fingerprintToTokens(fingerprint);
  if (targetTokens.length === 0) return [];

  const rows = store.getRecentIncidents(DEFAULT_LOOKBACK_INCIDENTS);
  const results: SimilarIncident[] = [];

  for (const row of rows) {
    if (row.trace_id === excludeTraceId) continue;
    let candidateFingerprint: IncidentFingerprint;
    try {
      candidateFingerprint = JSON.parse(row.fingerprint) as IncidentFingerprint;
    } catch {
      continue;
    }
    const candidateTokens = fingerprintToTokens(candidateFingerprint);
    const sharedTokens = targetTokens.filter((t) => candidateTokens.includes(t));
    const similarity = jaccardSimilarity(targetTokens, candidateTokens);
    if (similarity < minSimilarity) continue;

    results.push({
      incident_id: row.id,
      trace_id: row.trace_id,
      window: { start: row.window_start, end: row.window_end },
      similarity: Math.round(similarity * 1000) / 1000,
      shared_tokens: sharedTokens,
      summary: row.summary,
    });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

export function buildIncidentSummaryLine(evidence: EvidenceObject): string {
  const services = evidence.summary.services.join(", ") || "unknown service(s)";
  const errorCount = evidence.summary.error_count;
  const anomalyCount = evidence.anomalies.filter((a) => a.is_anomalous).length;
  const changeCount = evidence.what_changed.length;
  return `${services}: ${errorCount} error(s), ${anomalyCount} anomaly signal(s), ${changeCount} change(s)`;
}

export function recordIncidentFingerprint(
  store: SqliteStore,
  traceId: string,
  window: TimeWindow,
  fingerprint: IncidentFingerprint,
  summary: string,
): void {
  store.recordIncident({
    traceId,
    windowStart: window.start,
    windowEnd: window.end,
    services: fingerprint.services,
    fingerprint: JSON.stringify(fingerprint),
    summary,
  });
}

export function shouldRecordIncident(evidence: EvidenceObject): boolean {
  const hasAnomaly = evidence.anomalies.some((a) => a.is_anomalous);
  return evidence.summary.error_count > 0 || hasAnomaly || evidence.what_changed.length > 0;
}
