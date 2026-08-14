import { Command } from "commander";
import chalk from "chalk";
import {
  detectProject,
  createDefaultConfig,
  saveConfig,
  configExists,
  resolveConfigPath,
  DEFAULT_CONFIG_FILENAME,
} from "@obyflow/core";

interface InitCommandOptions {
  cwd: string;
  config: string;
  db: string;
  force?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Detect the current project and scaffold a local Obyflow config")
    .option("--cwd <path>", "project directory to initialize", ".")
    .option("--config <filename>", "config file name to write", DEFAULT_CONFIG_FILENAME)
    .option("--db <path>", "path to the local Obyflow SQLite database", "obyflow.db")
    .option("--force", "overwrite an existing config file")
    .action((options: InitCommandOptions) => {
      const configPath = resolveConfigPath(options.cwd, options.config);

      if (configExists(configPath) && !options.force) {
        console.log(
          chalk.yellow(
            `Obyflow is already initialized at ${configPath}. Use --force to overwrite.`,
          ),
        );
        return;
      }

      const detected = detectProject(options.cwd);
      const config = createDefaultConfig(detected.name);
      config.project.language = detected.language;
      config.storage.dbPath = options.db;

      saveConfig(configPath, config);

      console.log(chalk.green(`Initialized Obyflow project "${detected.name}".`));
      console.log(`${chalk.dim("language")}   ${detected.language}`);
      console.log(`${chalk.dim("config")}     ${configPath}`);
      console.log(`${chalk.dim("database")}   ${config.storage.dbPath}`);
      if (detected.hasDocker) {
        console.log(chalk.dim("Detected a Dockerfile — containerized deploys are supported."));
      }
      console.log(
        chalk.dim(
          "\nNext: run `obyflow start` to initialize local storage, then " +
            "`obyflow config llm --provider anthropic` to enable investigations.",
        ),
      );
    });
}
