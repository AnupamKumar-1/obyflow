import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  SqliteStore,
  investigateTrace,
  findMostSevereTraceInWindow,
  configExists,
  loadConfig,
  resolveConfigPath,
  DEFAULT_CONFIG_FILENAME,
} from "@obyflow/core";
import { LLMConfigError } from "@obyflow/llm-core";
import type { LLMAdapter } from "@obyflow/llm-core";
import { createLLMAdapter } from "../llm/create-adapter.js";
import { parseSince } from "../render/time.js";
import { renderInvestigationReport } from "../render/investigation.js";

interface AskCommandOptions {
  db: string;
  since: string;
  service?: string;
  trace?: string;
  cwd: string;
  config: string;
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
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name to read", DEFAULT_CONFIG_FILENAME)
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

        const configPath = resolveConfigPath(options.cwd, options.config);
        const resolvedConfig = configExists(configPath) ? loadConfig(configPath) : null;
        const provider = resolvedConfig?.llm.provider ?? "none";
        const model = resolvedConfig?.llm.model ?? undefined;

        if (provider === "none") {
          console.log(
            chalk.red(
              'No LLM provider configured. obyflow ask requires one — run `obyflow config llm --provider <provider>`.',
            ),
          );
          return;
        }

        let adapter: LLMAdapter;
        try {
          adapter = createLLMAdapter(provider, { model })!;
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
