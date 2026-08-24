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
import type { LLMInvestigationResult } from "@obyflow/llm-core";
import { createLLMAdapter } from "../llm/create-adapter.js";
import { parseSince } from "../render/time.js";
import { renderInvestigationReport } from "../render/investigation.js";

interface InvestigateCommandOptions {
  db: string;
  since?: string;
  service?: string;
  llm: boolean;
  cwd: string;
  config: string;
  gitRepo?: string;
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
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name to read", DEFAULT_CONFIG_FILENAME)
    .option(
      "--git-repo <path>",
      "local git repo path to correlate commit-type changes against",
    )
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

        const result = investigateTrace(store, traceId, {
          gitRepoPath: options.gitRepo,
        });

        if (result.trace.events.length === 0) {
          console.log(chalk.red(`Trace not found: ${traceId}`));
          process.exitCode = 1;
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
              const spinner = ora(`Investigating with ${provider}...`).start();
              try {
                llmResult = await adapter!.investigate(result.evidence);
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
