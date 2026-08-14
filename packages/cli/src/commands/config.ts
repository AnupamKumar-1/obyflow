import { Command } from "commander";
import chalk from "chalk";
import {
  configExists,
  loadConfig,
  saveConfig,
  createDefaultConfig,
  resolveConfigPath,
  detectProject,
  DEFAULT_CONFIG_FILENAME,
  LLMProvider,
} from "@obyflow/core";
import type { ObyflowConfig } from "@obyflow/core";

interface BaseConfigOptions {
  cwd: string;
  config: string;
}

const SETTABLE_KEYS = [
  "project.name",
  "storage.dbPath",
  "llm.provider",
  "llm.model",
  "redaction.enabled",
] as const;

function readOrDefaultConfig(options: BaseConfigOptions): { path: string; config: ObyflowConfig } {
  const path = resolveConfigPath(options.cwd, options.config);
  if (configExists(path)) {
    return { path, config: loadConfig(path) };
  }
  return { path, config: createDefaultConfig(detectProject(options.cwd).name) };
}

function getByPath(config: ObyflowConfig, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      config,
    );
}

function setByPath(config: ObyflowConfig, path: string, rawValue: string): void {
  const segments = path.split(".");
  const lastKey = segments.pop();
  if (!lastKey) {
    throw new Error(`Invalid config key: ${path}`);
  }

  let target: Record<string, unknown> = config as unknown as Record<string, unknown>;
  for (const segment of segments) {
    const next = target[segment];
    if (typeof next !== "object" || next === null) {
      throw new Error(`Invalid config key: ${path}`);
    }
    target = next as Record<string, unknown>;
  }

  if (rawValue === "true") target[lastKey] = true;
  else if (rawValue === "false") target[lastKey] = false;
  else if (rawValue === "null") target[lastKey] = null;
  else target[lastKey] = rawValue;
}

export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command("config")
    .description("View or update the local Obyflow configuration");

  configCommand
    .command("list")
    .description("Print the current configuration")
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name", DEFAULT_CONFIG_FILENAME)
    .action((options: BaseConfigOptions) => {
      const { path, config } = readOrDefaultConfig(options);
      console.log(chalk.dim(`# ${path}`));
      console.log(JSON.stringify(config, null, 2));
    });

  configCommand
    .command("get <key>")
    .description(`Print a single config value (${SETTABLE_KEYS.join(", ")})`)
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name", DEFAULT_CONFIG_FILENAME)
    .action((key: string, options: BaseConfigOptions) => {
      const { config } = readOrDefaultConfig(options);
      const value = getByPath(config, key);
      if (value === undefined) {
        console.log(chalk.red(`Unknown config key: ${key}`));
        return;
      }
      console.log(typeof value === "string" ? value : JSON.stringify(value));
    });

  configCommand
    .command("set <key> <value>")
    .description(`Set a config value and persist it (${SETTABLE_KEYS.join(", ")})`)
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name", DEFAULT_CONFIG_FILENAME)
    .action((key: string, value: string, options: BaseConfigOptions) => {
      const { path, config } = readOrDefaultConfig(options);
      try {
        setByPath(config, key, value);
      } catch (err) {
        console.log(chalk.red(err instanceof Error ? err.message : String(err)));
        return;
      }
      saveConfig(path, config);
      console.log(chalk.green(`Set ${key} = ${value}`));
      console.log(chalk.dim(`Saved to ${path}`));
    });

  configCommand
    .command("llm")
    .description("Configure the LLM provider used by obyflow investigate / obyflow ask")
    .option("--cwd <path>", "project directory", ".")
    .option("--config <filename>", "config file name", DEFAULT_CONFIG_FILENAME)
    .option("--provider <provider>", "anthropic | openai | gemini | ollama | none")
    .option("--model <model>", "model identifier to use for investigations")
    .action((options: BaseConfigOptions & { provider?: string; model?: string }) => {
      const { path, config } = readOrDefaultConfig(options);

      if (!options.provider && !options.model) {
        console.log(`${chalk.dim("provider")}  ${config.llm.provider}`);
        console.log(`${chalk.dim("model")}     ${config.llm.model ?? "(default)"}`);
        console.log(
          chalk.dim(
            "\nUse --provider and/or --model to change this, " +
              "e.g. obyflow config llm --provider anthropic",
          ),
        );
        return;
      }

      if (options.provider) {
        const parsed = LLMProvider.safeParse(options.provider);
        if (!parsed.success) {
          console.log(
            chalk.red(
              `Invalid provider "${options.provider}". Expected one of: ${LLMProvider.options.join(", ")}`,
            ),
          );
          return;
        }
        config.llm.provider = parsed.data;
      }

      if (options.model) {
        config.llm.model = options.model;
      }

      saveConfig(path, config);

      console.log(chalk.green(`LLM provider set to "${config.llm.provider}".`));
      if (config.llm.provider === "anthropic") {
        console.log(
          chalk.dim(
            "Set ANTHROPIC_API_KEY in your environment — obyflow never stores API keys in the config file.",
          ),
        );
      } else if (config.llm.provider !== "none") {
        console.log(
          chalk.dim(
            `${config.llm.provider} support is not wired up yet; obyflow investigate currently uses Anthropic.`,
          ),
        );
      }
    });
}
