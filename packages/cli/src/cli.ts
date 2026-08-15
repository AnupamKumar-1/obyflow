import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerTracesCommand } from "./commands/traces.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerMetricsCommand } from "./commands/metrics.js";
import { registerErrorsCommand } from "./commands/errors.js";
import { registerServicesCommand } from "./commands/services.js";
import { registerInvestigateCommand } from "./commands/investigate.js";
import { registerAskCommand } from "./commands/ask.js";
import { registerIncidentCommand } from "./commands/incident.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("obyflow")
    .description("AI-native, CLI-first observability and debugging platform")
    .version("0.0.1");

  registerInitCommand(program);
  registerStartCommand(program);
  registerConfigCommand(program);
  registerTracesCommand(program);
  registerLogsCommand(program);
  registerMetricsCommand(program);
  registerErrorsCommand(program);
  registerServicesCommand(program);
  registerInvestigateCommand(program);
  registerAskCommand(program);
  registerIncidentCommand(program);

  return program;
}
