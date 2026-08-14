import { Command } from "commander";
import { registerTracesCommand } from "./commands/traces.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerMetricsCommand } from "./commands/metrics.js";
import { registerErrorsCommand } from "./commands/errors.js";
import { registerServicesCommand } from "./commands/services.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("obyflow")
    .description("AI-native, CLI-first observability and debugging platform")
    .version("0.0.1");

  registerTracesCommand(program);
  registerLogsCommand(program);
  registerMetricsCommand(program);
  registerErrorsCommand(program);
  registerServicesCommand(program);

  return program;
}