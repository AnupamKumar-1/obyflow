import { Command } from "commander";
import chalk from "chalk";
import {
  SqliteStore,
  configExists,
  loadConfig,
  resolveConfigPath,
  resolveDbPath,
  DEFAULT_CONFIG_FILENAME,
} from "@obyflow/core";
import type { LLMProvider } from "@obyflow/core";
import { startInteractiveSession } from "../render/interactive.js";

interface StartCommandOptions {
  cwd: string;
  config: string;
  db?: string;
  interactive: boolean;
}

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start Obyflow locally: initialize storage and report readiness")
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name to read", DEFAULT_CONFIG_FILENAME)
    .option("--db <path>", "path to the local Obyflow SQLite database (overrides config)")
    .option("--no-interactive", "print status and exit instead of launching the interactive session")
    .action(async (options: StartCommandOptions) => {
      const configPath = resolveConfigPath(options.cwd, options.config);

      let dbPath = options.db;
      let projectName: string | null = null;
      let llmProvider: LLMProvider = "none";
      let llmModel: string | undefined;

      if (configExists(configPath)) {
        const config = loadConfig(configPath);
        dbPath = dbPath ?? config.storage.dbPath;
        projectName = config.project.name;
        llmProvider = config.llm.provider;
        llmModel = config.llm.model ?? undefined;
      } else {
        dbPath = dbPath ?? "obyflow.db";
        console.log(
          chalk.yellow(
            `No config found at ${configPath}. Run \`obyflow init\` first for full setup. Continuing with defaults.`,
          ),
        );
      }

      const resolvedDbPath = resolveDbPath(options.cwd, dbPath);

      if (!options.interactive) {
        const store = new SqliteStore(resolvedDbPath);
        try {
          const services = store.getServices();
          console.log(chalk.green("Obyflow is running."));
          if (projectName) console.log(`${chalk.dim("project")}    ${projectName}`);
          console.log(`${chalk.dim("database")}   ${resolvedDbPath}`);
          console.log(`${chalk.dim("llm")}        ${llmProvider}`);
          console.log(`${chalk.dim("services")}   ${services.length} observed`);
          console.log(
            chalk.dim(
              "\nLocal storage is ready. Point your Node or Python SDK at this database, " +
                "then use `obyflow traces`, `obyflow investigate`, etc.",
            ),
          );
        } finally {
          store.close();
        }
        return;
      }

      const store = new SqliteStore(resolvedDbPath);
      store.close();

      await startInteractiveSession({
        dbPath: resolvedDbPath,
        llmProvider,
        llmModel,
        projectName,
      });
    });
}
