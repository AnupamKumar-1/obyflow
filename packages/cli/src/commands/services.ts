import { Command } from "commander";
import chalk from "chalk";
import { SqliteStore, type ServiceSummary } from "@obyflow/core";
import { renderTable, type TableColumn } from "../render/table.js";

interface ServicesCommandOptions {
  db: string;
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
    .action((options: ServicesCommandOptions) => {
      const store = new SqliteStore(options.db);
      try {
        const summaries = store.getServices();
        console.log(renderTable(summaries, columns));
        if (summaries.length > 0) {
          console.log(chalk.dim(`\n${summaries.length} service(s).`));
        }
      } finally {
        store.close();
      }
    });
}