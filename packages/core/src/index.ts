export {
  EventSchema,
  EventType,
  Severity,
  EmbeddingAttributes,
  VectorOpAttributes,
  ChainAttributes,
  ToolCallAttributes,
  LlmCallAttributes,
} from "./event-model/event.schema.js";
export type {
  Event,
  EventType as EventTypeValue,
  Severity as SeverityValue,
  EmbeddingAttributes as EmbeddingAttributesType,
  VectorOpAttributes as VectorOpAttributesType,
  ChainAttributes as ChainAttributesType,
  ToolCallAttributes as ToolCallAttributesType,
  LlmCallAttributes as LlmCallAttributesType,
} from "./event-model/event.schema.js";

export {
  validateEvent,
  safeValidateEvent,
  EventValidationError,
} from "./event-model/validators.js";

export { SqliteStore, rowToEvent } from "./storage/sqlite-store.js";
export type { EventRow, ServiceSummary } from "./storage/sqlite-store.js";

export {
  extractJoinKeys,
  computeTimeWindow,
  isWithinWindow,
  sameService,
  sameDeployment,
  sameTraceId,
} from "./correlation/join-keys.js";
export type { JoinKeys, TimeWindow } from "./correlation/join-keys.js";

export { correlateTrace } from "./correlation/correlate.js";
export type { CorrelatedTrace } from "./correlation/correlate.js";

export {
  mean,
  stddev,
  computeBaselineStats,
  zScoreOf,
  classifySeverity,
  bucketPoints,
  computeRollingBaseline,
  detectLatencyAnomaly,
  detectErrorRateAnomaly,
  detectMetricValueAnomaly,
  detectAnomalies,
} from "./anomaly/baseline.js";
export type {
  DeviationSeverity,
  BaselineStats,
  TimeSeriesPoint,
  BucketAggregate,
  RollingBaselineOptions,
  RollingBaselineResult,
  AnomalyResult,
} from "./anomaly/baseline.js";

export {
  redactAttributes,
  redactEvent,
  DEFAULT_REDACTION_CONFIG,
} from "./evidence/redact.js";
export type { RedactionConfig } from "./evidence/redact.js";

export { buildEvidence } from "./evidence/build-evidence.js";
export type {
  EvidenceObject,
  EvidenceItem,
  TraceSummary,
  BuildEvidenceOptions,
} from "./evidence/build-evidence.js";

export { assessConfidence } from "./confidence/confidence.js";
export type {
  ConfidenceTier,
  ConfidenceFactors,
  ConfidenceAssessment,
} from "./confidence/confidence.js";

export { investigateTrace, findMostSevereTraceInWindow } from "./investigation/investigate.js";
export type {
  InvestigateOptions,
  InvestigationResult,
} from "./investigation/investigate.js";