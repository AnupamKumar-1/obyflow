import { Command } from "commander";
import chalk from "chalk";
import { SqliteStore, rowToEvent } from "@obyflow/core";
import { renderTable, type TableColumn } from "../render/table.js";
import { renderDetailCards } from "../render/detail.js";
import { parseSince } from "../render/time.js";
import type { Event } from "@obyflow/core";

interface MetricsCommandOptions {
  db: string;
  service?: string;
  since?: string;
  limit: string;
  detail?: boolean;
}

function formatValue(e: Event): string {
  const value = e.attributes["value"];
  const unit = e.attributes["unit"];
  if (value === undefined) return JSON.stringify(e.attributes);
  return unit ? `${value} ${unit}` : String(value);
}

const columns: TableColumn<Event>[] = [
  { header: "SERVICE", width: 20, get: (e) => e.service },
  {
    header: "METRIC",
    width: 24,
    get: (e) => {
      const name = e.attributes["name"];
      return typeof name === "string" ? name : "—";
    },
  },
  { header: "VALUE", width: 14, get: formatValue },
  { header: "TIMESTAMP", width: 24, get: (e) => e.timestamp },
];

export function registerMetricsCommand(program: Command): void {
  program
    .command("metrics")
    .description("List metric events")
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option("--service <name>", "filter by service name")
    .option("--since <window>", "time window, e.g. 15m, 2h, 1d")
    .option("--limit <n>", "max number of results", "50")
    .option("--detail", "show full detail cards instead of a table")
    .action((options: MetricsCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        const rows = store.getRecent({
          type: "metric",
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
          console.log(chalk.dim(`\n${events.length} metric(s). Use --detail for full attributes.`));
        }
      } finally {
        store.close();
      }
    });
}