import chalk from "chalk";
import type {
  EvidenceObject,
  ConfidenceAssessment,
  RetrievalDiagnosis,
  ChainStepDiagnosis,
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

  if (llmResult) {
    lines.push(chalk.bold.cyan("Root Cause"));
    lines.push(llmResult.root_cause);
    lines.push("");
    lines.push(chalk.bold.cyan("Evidence"));
    lines.push(renderEvidenceItems(evidenceObject, llmResult.evidence_refs));
    lines.push(...renderRetrievalDiagnosis(evidenceObject.retrieval_diagnosis));
    lines.push(...renderChainStepDiagnosis(evidenceObject.chain_step_diagnosis));
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

    const anomalous = evidenceObject.anomalies.filter((a) => a.is_anomalous);
    if (anomalous.length > 0) {
      lines.push("");
      lines.push(chalk.bold.cyan("Anomalies"));
      for (const anomaly of anomalous) {
        lines.push(
          `  ${chalk.bold(anomaly.service)} ${anomaly.metric}  z=${anomaly.z_score.toFixed(2)}  ${anomaly.severity}`,
        );
      }
    }

    if (llmNote) {
      lines.push("");
      lines.push(chalk.dim(llmNote));
    }
  }

  return lines.join("\n");
}
