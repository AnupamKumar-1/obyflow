import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { SqliteStore, investigateTrace, findMostSevereTraceInWindow } from "@obyflow/core";
import { AnthropicLLMAdapter } from "@obyflow/llm-anthropic";
import { LLMConfigError } from "@obyflow/llm-core";
import type { LLMInvestigationResult } from "@obyflow/llm-core";
import { parseSince } from "../render/time.js";
import { renderInvestigationReport } from "../render/investigation.js";

interface InvestigateCommandOptions {
  db: string;
  since?: string;
  service?: string;
  llm: boolean;
}

export function registerInvestigateCommand(program: Command): void {
  program
    .command("investigate [traceId]")
    .description(
      "Run root-cause investigation on a trace, or the most severe incident in a time window",
    )
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option(
      "--since <window>",
      "investigate the most severe incident in this time window, e.g. 15m, 2h, 1d",
    )
    .option("--service <n>", "restrict --since incident search to a service")
    .option("--no-llm", "skip LLM synthesis and show evidence and anomalies only")
    .action(async (traceIdArg: string | undefined, options: InvestigateCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        let traceId = traceIdArg;

        if (!traceId) {
          const sinceIso = parseSince(options.since);
          if (!sinceIso) {
            console.log(
              chalk.red(
                "Provide a trace id or --since <window>, e.g. obyflow investigate --since 30m",
              ),
            );
            return;
          }
          const found = findMostSevereTraceInWindow(store, sinceIso, options.service);
          if (!found) {
            console.log(chalk.dim(`No error events found in the last ${options.since}.`));
            return;
          }
          traceId = found;
          console.log(chalk.dim(`Most severe trace in window: ${traceId}\n`));
        }

        const result = investigateTrace(store, traceId);

        let llmResult: LLMInvestigationResult | null = null;
        let llmNote: string | null = null;

        if (options.llm === false) {
          llmNote = "LLM synthesis skipped (--no-llm).";
        } else {
          try {
            const adapter = new AnthropicLLMAdapter();
            const spinner = ora("Investigating with Anthropic...").start();
            try {
              llmResult = await adapter.investigate(result.evidence);
              spinner.succeed("Investigation complete.");
            } catch (err) {
              spinner.fail("LLM investigation failed.");
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

        console.log(
          renderInvestigationReport({
            title: "Investigation",
            traceId,
            evidenceObject: result.evidence,
            confidence: result.confidence,
            llmResult,
            llmNote,
          }),
        );
      } finally {
        store.close();
      }
    });
}
