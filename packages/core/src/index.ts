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
export type {
  EventRow,
  ServiceSummary,
  TelemetryFailureRow,
  RecordTelemetryFailureInput,
  TelemetryFailureFilter,
} from "./storage/sqlite-store.js";

export { detectTelemetryGaps } from "./telemetry/health.js";
export type { TelemetryFailure, TelemetryGap, TelemetryHealthReport } from "./telemetry/health.js";

export {
  extractJoinKeys,
  computeTimeWindow,
  isWithinWindow,
  sameService,
  sameDeployment,
  sameTraceId,
} from "./correlation/join-keys.js";
export type { JoinKeys, TimeWindow } from "./correlation/join-keys.js";

export { correlateTrace, buildSpanTree } from "./correlation/correlate.js";
export type { CorrelatedTrace, SpanNode } from "./correlation/correlate.js";

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

export {
  diagnoseRetrievalLayer,
} from "./evidence/retrieval-diagnosis.js";
export type {
  RetrievalDiagnosis,
  RetrievalSignal,
  RetrievalSignalType,
  RetrievalSignalSeverity,
  RetrievalDiagnosisOptions,
} from "./evidence/retrieval-diagnosis.js";

export {
  diagnoseChainSteps,
} from "./evidence/chain-diagnosis.js";
export type {
  ChainStepDiagnosis,
  ChainStepSignal,
  ChainStepSignalType,
  ChainStepSignalSeverity,
  ChainStepDiagnosisOptions,
  ChainStepKind,
  ChainStepNode,
} from "./evidence/chain-diagnosis.js";

export { buildEvidence } from "./evidence/build-evidence.js";
export type {
  EvidenceObject,
  EvidenceItem,
  TraceSummary,
  BuildEvidenceOptions,
} from "./evidence/build-evidence.js";

export { buildEvidenceGraph } from "./evidence/evidence-graph.js";
export type {
  EvidenceGraph,
  EvidenceGraphNode,
  EvidenceGraphEdge,
  EvidenceEdgeType,
} from "./evidence/evidence-graph.js";

export { detectWhatChanged } from "./change/what-changed.js";
export type { ChangeEvent, ChangeType } from "./change/what-changed.js";
export { correlateGitCommit, enrichChangesWithGitMetadata } from "./correlation/git-correlate.js";
export type {
  GitCommitMetadata,
  GitCorrelationOptions,
  GitEnrichedChangeEvent,
} from "./correlation/git-correlate.js";

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

export { summarizeIncident, findIncidentTraceIds } from "./incident/summarize.js";
export type { IncidentSummary, IncidentSummaryOptions } from "./incident/summarize.js";

export {
  computeFingerprint,
  fingerprintToTokens,
  jaccardSimilarity,
  findSimilarIncidents,
  buildIncidentSummaryLine,
  recordIncidentFingerprint,
  shouldRecordIncident,
} from "./incident/memory.js";
export type { IncidentFingerprint, SimilarIncident } from "./incident/memory.js";

export {
  ObyflowConfigSchema,
  ProjectLanguage,
  LLMProvider,
  DEFAULT_CONFIG_FILENAME,
  DEFAULT_REDACTION_FIELDS,
  createDefaultConfig,
} from "./config/config.schema.js";
export type { ObyflowConfig } from "./config/config.schema.js";

export {
  ConfigValidationError,
  resolveConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  resolveDbPath,
} from "./config/config-store.js";

export { detectProject } from "./config/detect-project.js";
export type { DetectedProject } from "./config/detect-project.js";
