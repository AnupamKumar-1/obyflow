import chalk from "chalk";

export interface TableColumn<T> {
  header: string;
  width?: number;
  get: (row: T) => string;
  color?: (value: string, row: T) => string;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + "…";
}

function pad(value: string, width: number): string {
  const visibleLength = value.replace(/\u001b\[[0-9;]*m/g, "").length;
  const diff = width - visibleLength;
  return diff > 0 ? value + " ".repeat(diff) : value;
}

export function renderTable<T>(rows: T[], columns: TableColumn<T>[]): string {
  if (rows.length === 0) {
    return chalk.dim("No results.");
  }

  const widths = columns.map((col) => {
    const dataWidths = rows.map((row) => col.get(row).length);
    const natural = Math.max(col.header.length, ...dataWidths);
    return col.width ? Math.min(col.width, Math.max(natural, col.header.length)) : natural;
  });

  const headerLine = columns
    .map((col, i) => chalk.bold.cyan(pad(col.header, widths[i])))
    .join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("  ");

  const bodyLines = rows.map((row) =>
    columns
      .map((col, i) => {
        const raw = truncate(col.get(row), widths[i]);
        const colored = col.color ? col.color(raw, row) : raw;
        return pad(colored, widths[i]);
      })
      .join("  "),
  );

  return [headerLine, chalk.dim(separator), ...bodyLines].join("\n");
}