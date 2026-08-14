import { Command } from "commander";
import { registerTracesCommand } from "./commands/traces.js";

export function buildCli(): Command {
  const program = new Command();

  program
    .name("obyflow")
    .description("AI-native, CLI-first observability and debugging platform")
    .version("0.0.1");

  registerTracesCommand(program);

  return program;
}