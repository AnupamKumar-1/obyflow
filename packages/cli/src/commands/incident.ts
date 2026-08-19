import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  SqliteStore,
  summarizeIncident,
  configExists,
  loadConfig,
  resolveConfigPath,
  DEFAULT_CONFIG_FILENAME,
} from "@obyflow/core";
import { LLMConfigError } from "@obyflow/llm-core";
import type { LLMInvestigationResult } from "@obyflow/llm-core";
import { createLLMAdapter } from "../llm/create-adapter.js";
import { parseSince } from "../render/time.js";
import { renderInvestigationReport } from "../render/investigation.js";

interface IncidentSummarizeCommandOptions {
  db: string;
  since: string;
  service?: string;
  maxTraces: string;
  llm: boolean;
  cwd: string;
  config: string;
}

export function registerIncidentCommand(program: Command): void {
  const incident = program
    .command("incident")
    .description("Incident-level operations across a time window");

  incident
    .command("summarize")
    .description("Summarize the most severe incidents in a recent time window")
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option("--since <window>", "time window to summarize, e.g. 15m, 2h, 1d", "1h")
    .option("--service <n>", "restrict the incident search to a service")
    .option("--max-traces <n>", "maximum number of traces to aggregate", "5")
    .option("--no-llm", "skip LLM synthesis and show evidence and anomalies only")
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name to read", DEFAULT_CONFIG_FILENAME)
    .action(async (options: IncidentSummarizeCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        const sinceIso = parseSince(options.since);
        if (!sinceIso) {
          console.log(chalk.red(`Invalid --since window: ${options.since}`));
          process.exitCode = 1;
          return;
        }

        const maxTraces = Number(options.maxTraces);
        if (!Number.isInteger(maxTraces) || maxTraces <= 0) {
          console.log(
            chalk.red(
              `Invalid --max-traces value: ${options.maxTraces}. Must be a positive integer.`,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const summary = summarizeIncident(
          store,
          sinceIso,
          { maxTraces },
          options.service,
        );

        if (summary.trace_ids.length === 0) {
          console.log(chalk.dim(`No error events found in the last ${options.since}.`));
          return;
        }

        let llmResult: LLMInvestigationResult | null = null;
        let llmNote: string | null = null;

        if (options.llm === false) {
          llmNote = "LLM synthesis skipped (--no-llm).";
        } else {
          const configPath = resolveConfigPath(options.cwd, options.config);
          const resolvedConfig = configExists(configPath) ? loadConfig(configPath) : null;
          const provider = resolvedConfig?.llm.provider ?? "none";
          const model = resolvedConfig?.llm.model ?? undefined;

          if (provider === "none") {
            llmNote =
              'LLM synthesis skipped (llm.provider is "none"). Run `obyflow config llm --provider <provider>` to enable.';
          } else {
            try {
              const adapter = createLLMAdapter(provider, { model });
              const spinner = ora(`Summarizing with ${provider}...`).start();
              try {
                llmResult = await adapter!.investigate(
                  summary.evidence,
                  "Summarize this incident window: what happened, which services were affected, and what should be done next.",
                );
                spinner.succeed("Summary complete.");
              } catch (err) {
                spinner.fail("LLM summarization failed.");
                llmNote = err instanceof Error ? err.message : String(err);
              }
            } catch (err) {
              if (err instanceof LLMConfigError) {
                llmNote = `${err.message} Showing evidence only.`;
              } else {
                throw err;
              }
            }
          }
        }

        console.log(
          renderInvestigationReport({
            title: "Incident Summary",
            traceId: `${summary.trace_ids.length} trace(s) since ${options.since}`,
            evidenceObject: summary.evidence,
            confidence: summary.confidence,
            llmResult,
            llmNote,
          }),
        );
      } finally {
        store.close();
      }
    });
}
