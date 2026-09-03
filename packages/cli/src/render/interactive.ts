import readline from "node:readline";
import chalk from "chalk";
import figlet from "figlet";
import ora from "ora";
import {
  SqliteStore,
  investigateTrace,
  findMostSevereTraceInWindow,
} from "@obyflow/core";
import { LLMConfigError } from "@obyflow/llm-core";
import type { LLMAdapter } from "@obyflow/llm-core";
import type { LLMProvider } from "@obyflow/core";
import { createLLMAdapter } from "../llm/create-adapter.js";
import { parseSince } from "./time.js";
import { renderInvestigationReport } from "./investigation.js";

const GRADIENT_FROM = [96, 165, 250];
const GRADIENT_TO = [232, 121, 249];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function gradientLine(line: string, lineIndex: number, totalLines: number): string {
  const t = totalLines <= 1 ? 0 : lineIndex / (totalLines - 1);
  const r = lerp(GRADIENT_FROM[0], GRADIENT_TO[0], t);
  const g = lerp(GRADIENT_FROM[1], GRADIENT_TO[1], t);
  const b = lerp(GRADIENT_FROM[2], GRADIENT_TO[2], t);
  return chalk.rgb(r, g, b)(line);
}

export function renderBanner(): string {
  const raw = figlet.textSync("OBYFLOW", { font: "Standard" });
  const lines = raw.replace(/\s+$/, "").split("\n");
  return lines.map((line, i) => gradientLine(line, i, lines.length)).join("\n");
}

export function renderTips(): string {
  return [
    chalk.dim("Tips for getting started:"),
    chalk.dim("1. Ask a question about your traces, logs, or errors."),
    chalk.dim("2. Be specific about a service or time window for the best results."),
    chalk.dim("3. /help for more information."),
  ].join("\n");
}

interface InteractiveOptions {
  dbPath: string;
  llmProvider: LLMProvider;
  llmModel?: string;
  projectName: string | null;
}

function renderHelp(): string {
  return [
    "",
    chalk.bold("Commands"),
    `  ${chalk.cyan("/help")}            show this help`,
    `  ${chalk.cyan("/since <window>")}  set the lookback window, e.g. 15m, 2h, 1d`,
    `  ${chalk.cyan("/service <name>")}  scope questions to a single service`,
    `  ${chalk.cyan("/clear")}           clear the screen`,
    `  ${chalk.cyan("/exit")}            quit`,
    "",
    chalk.dim("Anything else you type is asked as a question over your telemetry."),
    "",
  ].join("\n");
}

function renderStatusLine(options: InteractiveOptions, since: string, service?: string): string {
  const parts = [
    `${chalk.dim("db")} ${options.dbPath}`,
    `${chalk.dim("llm")} ${options.llmProvider}`,
    `${chalk.dim("since")} ${since}`,
  ];
  if (service) parts.push(`${chalk.dim("service")} ${service}`);
  return chalk.dim(parts.join("  |  "));
}

export async function startInteractiveSession(options: InteractiveOptions): Promise<void> {
  console.log(renderBanner());
  console.log("");
  console.log(renderTips());
  console.log("");

  let since = "15m";
  let service: string | undefined;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("> "),
  });

  console.log(renderStatusLine(options, since, service));
  console.log("");
  rl.prompt();

  rl.on("line", async (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      return;
    }

    if (line === "/exit" || line === "exit" || line === "quit") {
      rl.close();
      return;
    }

    if (line === "/help") {
      console.log(renderHelp());
      rl.prompt();
      return;
    }

    if (line === "/clear") {
      console.clear();
      console.log(renderBanner());
      console.log("");
      rl.prompt();
      return;
    }

    if (line.startsWith("/since ")) {
      const candidate = line.slice("/since ".length).trim();
      if (parseSince(candidate)) {
        since = candidate;
        console.log(chalk.dim(`since set to ${since}`));
      } else {
        console.log(chalk.red(`invalid window: ${candidate}`));
      }
      rl.prompt();
      return;
    }

    if (line.startsWith("/service ")) {
      service = line.slice("/service ".length).trim() || undefined;
      console.log(chalk.dim(service ? `service set to ${service}` : "service filter cleared"));
      rl.prompt();
      return;
    }

    rl.pause();
    await handleQuestion(line, options, since, service);
    console.log("");
    console.log(renderStatusLine(options, since, service));
    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\nGoodbye."));
    process.exit(0);
  });
}

async function handleQuestion(
  question: string,
  options: InteractiveOptions,
  since: string,
  service?: string,
): Promise<void> {
  const store = new SqliteStore(options.dbPath);
  try {
    const sinceIso = parseSince(since);
    if (!sinceIso) {
      console.log(chalk.red(`Invalid --since window: ${since}`));
      return;
    }

    const traceId = findMostSevereTraceInWindow(store, sinceIso, service);
    if (!traceId) {
      console.log(chalk.dim(`No correlated trace data found in the last ${since}.`));
      return;
    }

    const result = investigateTrace(store, traceId);

    if (options.llmProvider === "none") {
      console.log(
        chalk.red(
          'No LLM provider configured. Run `obyflow config llm --provider <provider>` to enable Q&A.',
        ),
      );
      return;
    }

    let adapter: LLMAdapter;
    try {
      adapter = createLLMAdapter(options.llmProvider, { model: options.llmModel })!;
    } catch (err) {
      if (err instanceof LLMConfigError) {
        console.log(chalk.red(err.message));
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
}
