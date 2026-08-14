import { Command } from "commander";
import chalk from "chalk";
import { SqliteStore, rowToEvent } from "@obyflow/core";
import { renderTable, type TableColumn } from "../render/table.js";
import { renderDetailCards } from "../render/detail.js";
import { parseSince } from "../render/time.js";
import type { Event } from "@obyflow/core";

interface LogsCommandOptions {
  db: string;
  service?: string;
  since?: string;
  limit: string;
  detail?: boolean;
}

const columns: TableColumn<Event>[] = [
  { header: "SERVICE", width: 20, get: (e) => e.service },
  {
    header: "SEVERITY",
    width: 8,
    get: (e) => e.severity ?? "—",
    color: (value, e) => {
      if (e.severity === "error" || e.severity === "critical") return chalk.red(value);
      if (e.severity === "warn") return chalk.yellow(value);
      return value;
    },
  },
  {
    header: "MESSAGE",
    width: 50,
    get: (e) => {
      const msg = e.attributes["message"];
      return typeof msg === "string" ? msg : JSON.stringify(e.attributes);
    },
  },
  { header: "TIMESTAMP", width: 24, get: (e) => e.timestamp },
];

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("List log events")
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option("--service <name>", "filter by service name")
    .option("--since <window>", "time window, e.g. 15m, 2h, 1d")
    .option("--limit <n>", "max number of results", "50")
    .option("--detail", "show full detail cards instead of a table")
    .action((options: LogsCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        const rows = store.getRecent({
          type: "log",
          service: options.service,
          sinceIso: parseSince(options.since),
          limit: Number(options.limit) || 50,
        });
        const events = rows.map(rowToEvent);

        if (options.detail) {
          console.log(renderDetailCards(events));
        } else {
          console.log(renderTable(events, columns));
        }

        if (!options.detail && events.length > 0) {
          console.log(chalk.dim(`\n${events.length} log(s). Use --detail for full attributes.`));
        }
      } finally {
        store.close();
      }
    });
}