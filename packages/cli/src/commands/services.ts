import { Command } from "commander";
import chalk from "chalk";
import { SqliteStore, type ServiceSummary } from "@obyflow/core";
import { renderTable, type TableColumn } from "../render/table.js";
import { renderServiceDetailCards } from "../render/detail.js";

interface ServicesCommandOptions {
  db: string;
  detail?: boolean;
}

const columns: TableColumn<ServiceSummary>[] = [
  { header: "SERVICE", width: 24, get: (s) => s.service },
  { header: "EVENTS", width: 8, get: (s) => String(s.event_count) },
  {
    header: "ERRORS",
    width: 8,
    get: (s) => String(s.error_count),
    color: (value, s) => (s.error_count > 0 ? chalk.red(value) : chalk.dim(value)),
  },
  { header: "LAST SEEN", width: 24, get: (s) => s.last_seen },
];

export function registerServicesCommand(program: Command): void {
  program
    .command("services")
    .description("List all services observed, with event and error counts")
    .option("--db <path>", "path to the obyflow SQLite database", "obyflow.db")
    .option("--detail", "show full detail cards instead of a table")
    .action((options: ServicesCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        const summaries = store.getServices();
        if (options.detail) {
          console.log(renderServiceDetailCards(summaries));
        } else {
          console.log(renderTable(summaries, columns));
        }
        if (!options.detail && summaries.length > 0) {
          console.log(chalk.dim(`\n${summaries.length} service(s). Use --detail for full attributes.`));
        }
      } finally {
        store.close();
      }
    });
}