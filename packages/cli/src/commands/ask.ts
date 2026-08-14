import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { SqliteStore, investigateTrace, findMostSevereTraceInWindow } from "@obyflow/core";
import { AnthropicLLMAdapter } from "@obyflow/llm-anthropic";
import { LLMConfigError } from "@obyflow/llm-core";
import { parseSince } from "../render/time.js";
import { renderInvestigationReport } from "../render/investigation.js";

interface AskCommandOptions {
  db: string;
  since: string;
  service?: string;
  trace?: string;
}

export function registerAskCommand(program: Command): void {
  program
    .command("ask <question>")
    .description("Ask a natural-language question over correlated telemetry")
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option(
      "--since <window>",
      "time window to search for relevant context, e.g. 15m, 2h, 1d",
      "15m",
    )
    .option("--service <n>", "restrict the search to a service")
    .option("--trace <id>", "scope the question to a specific trace id instead of searching a window")
    .action(async (question: string, options: AskCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        let traceId = options.trace;

        if (!traceId) {
          const sinceIso = parseSince(options.since);
          if (!sinceIso) {
            console.log(chalk.red(`Invalid --since window: ${options.since}`));
            return;
          }
          const found = findMostSevereTraceInWindow(store, sinceIso, options.service);
          if (!found) {
            console.log(
              chalk.dim(
                `No correlated trace data found in the last ${options.since}. Try --trace <id> or a wider --since window.`,
              ),
            );
            return;
          }
          traceId = found;
        }

        const result = investigateTrace(store, traceId);

        let adapter: AnthropicLLMAdapter;
        try {
          adapter = new AnthropicLLMAdapter();
        } catch (err) {
          if (err instanceof LLMConfigError) {
            console.log(chalk.red(`${err.message} obyflow ask requires an LLM adapter.`));
            return;
          }
          throw err;
        }

        const spinner = ora("Thinking...").start();
        try {
          const llmResult = await adapter.investigate(result.evidence, question);
          spinner.succeed("Answer ready.");
          console.log(
            renderInvestigationReport({
              title: "Answer",
              traceId,
              evidenceObject: result.evidence,
              confidence: result.confidence,
              llmResult,
              llmNote: null,
            }),
          );
        } catch (err) {
          spinner.fail("Failed to get an answer.");
          console.log(chalk.red(err instanceof Error ? err.message : String(err)));
        }
      } finally {
        store.close();
      }
    });
}
