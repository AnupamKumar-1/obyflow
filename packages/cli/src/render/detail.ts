import chalk from "chalk";
import type { Event, ServiceSummary } from "@obyflow/core";
import { redactAttributes, DEFAULT_REDACTION_CONFIG } from "@obyflow/core";
import type { RedactionConfig } from "@obyflow/core";

const severityColor: Record<string, (s: string) => string> = {
  debug: chalk.dim,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
  critical: chalk.bgRed.white,
};

function formatSeverity(severity: string | null): string {
  if (!severity) return chalk.dim("—");
  const colorFn = severityColor[severity] ?? chalk.white;
  return colorFn(severity.toUpperCase());
}

function formatDuration(ms: number | null): string {
  if (ms === null) return chalk.dim("—");
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderAttributes(
  attributes: Record<string, unknown>,
  redaction: RedactionConfig,
): string {
  const effective = redaction.enabled ? redactAttributes(attributes, redaction) : attributes;
  const entries = Object.entries(effective);
  if (entries.length === 0) return chalk.dim("  (none)");
  return entries
    .map(([key, value]) => {
      const rendered =
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value);
      return `  ${chalk.dim(key)}: ${rendered}`;
    })
    .join("\n");
}

export function renderDetailCard(
  event: Event,
  redaction: RedactionConfig = DEFAULT_REDACTION_CONFIG,
): string {
  const lines = [
    chalk.bold.white(`${chalk.magenta(event.type)}  ${event.id}`),
    `${chalk.dim("trace_id")}     ${event.trace_id ?? chalk.dim("—")}`,
    `${chalk.dim("service")}      ${event.service}`,
    `${chalk.dim("timestamp")}    ${event.timestamp}`,
    `${chalk.dim("duration")}     ${formatDuration(event.duration_ms)}`,
    `${chalk.dim("severity")}     ${formatSeverity(event.severity)}`,
    chalk.dim("attributes"),
    renderAttributes(event.attributes, redaction),
  ];
  return lines.join("\n");
}

export function renderDetailCards(
  events: Event[],
  redaction: RedactionConfig = DEFAULT_REDACTION_CONFIG,
): string {
  if (events.length === 0) {
    return chalk.dim("No results.");
  }
  const divider = chalk.dim("─".repeat(50));
  return events.map((event) => renderDetailCard(event, redaction)).join(`\n${divider}\n`);
}

export function renderServiceDetailCard(service: ServiceSummary): string {
  const lines = [
    chalk.bold.white(service.service),
    `${chalk.dim("events")}       ${service.event_count}`,
    `${chalk.dim("errors")}       ${service.error_count > 0 ? chalk.red(String(service.error_count)) : chalk.dim(String(service.error_count))}`,
    `${chalk.dim("last_seen")}    ${service.last_seen}`,
  ];
  return lines.join("\n");
}

export function renderServiceDetailCards(services: ServiceSummary[]): string {
  if (services.length === 0) {
    return chalk.dim("No results.");
  }
  const divider = chalk.dim("─".repeat(50));
  return services.map((service) => renderServiceDetailCard(service)).join(`\n${divider}\n`);
}
