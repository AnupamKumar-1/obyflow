import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ObyflowConfigSchema, DEFAULT_CONFIG_FILENAME } from "./config.schema.js";
import type { ObyflowConfig } from "./config.schema.js";

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function resolveConfigPath(
  cwd: string = process.cwd(),
  fileName: string = DEFAULT_CONFIG_FILENAME,
): string {
  return isAbsolute(fileName) ? fileName : resolve(cwd, fileName);
}

export function configExists(path: string): boolean {
  return existsSync(path);
}

export function loadConfig(path: string): ObyflowConfig {
  const raw = readFileSync(path, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigValidationError(
      `Config file at ${path} is not valid JSON`,
      err instanceof Error ? err.message : err,
    );
  }

  const result = ObyflowConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigValidationError(
      `Config file at ${path} failed validation`,
      result.error.issues,
    );
  }

  return result.data;
}

export function saveConfig(path: string, config: ObyflowConfig): void {
  const validated = ObyflowConfigSchema.parse(config);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export function resolveDbPath(cwd: string, dbPath: string): string {
  return isAbsolute(dbPath) ? dbPath : resolve(cwd, dbPath);
}
