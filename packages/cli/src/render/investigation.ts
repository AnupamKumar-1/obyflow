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
  SimilarIncident,
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
    lines.push(chalk.dim("  no changes detected near this incident window"));
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

const MAX_SIMILAR_INCIDENTS_SHOWN = 5;

function renderSimilarHistoricalIncidents(incidents: SimilarIncident[]): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("Similar Historical Incidents"));
  if (incidents.length === 0) {
    lines.push(chalk.dim("  no similar prior incidents found in the fingerprint index"));
    return lines;
  }
  for (const incident of incidents.slice(0, MAX_SIMILAR_INCIDENTS_SHOWN)) {
    const pct = Math.round(incident.similarity * 100);
    lines.push(
      `  ${chalk.bold(shortId(incident.trace_id))}  ${chalk.dim(incident.window.start)} → ${chalk.dim(incident.window.end)}  ${chalk.cyan(`${pct}% similar`)}`,
    );
    if (incident.summary) {
      lines.push(`    ${chalk.dim(incident.summary)}`);
    }
    if (incident.shared_tokens.length > 0) {
      const shown = incident.shared_tokens.slice(0, 6).join(", ");
      const suffix = incident.shared_tokens.length > 6 ? ", …" : "";
      lines.push(`    ${chalk.dim("shared:")} ${shown}${suffix}`);
    }
  }
  const remaining = incidents.length - MAX_SIMILAR_INCIDENTS_SHOWN;
  if (remaining > 0) {
    lines.push(chalk.dim(`  … ${remaining} more incident(s)`));
  }
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
  lines.push(...renderSimilarHistoricalIncidents(evidenceObject.similar_historical_incidents));
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

