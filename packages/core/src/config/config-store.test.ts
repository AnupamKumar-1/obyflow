import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  resolveDbPath,
  ConfigValidationError,
} from "./config-store.js";
import { createDefaultConfig } from "./config.schema.js";

describe("config-store", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the default config path relative to a cwd", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const path = resolveConfigPath(dir);
    expect(path).toBe(join(dir, "obyflow.config.json"));
  });

  it("reports a config file as missing until it has been saved", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const path = resolveConfigPath(dir);
    expect(configExists(path)).toBe(false);

    saveConfig(path, createDefaultConfig("demo"));
    expect(configExists(path)).toBe(true);
  });

  it("round-trips a config through save and load", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const path = resolveConfigPath(dir);
    const config = createDefaultConfig("demo");
    config.storage.dbPath = "custom.db";
    config.llm.provider = "anthropic";
    config.llm.model = "claude-sonnet-5";

    saveConfig(path, config);
    const loaded = loadConfig(path);

    expect(loaded.project.name).toBe("demo");
    expect(loaded.storage.dbPath).toBe("custom.db");
    expect(loaded.llm.provider).toBe("anthropic");
    expect(loaded.llm.model).toBe("claude-sonnet-5");
  });

  it("throws a ConfigValidationError for malformed JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const path = resolveConfigPath(dir);
    writeFileSync(path, "{ not valid json", "utf-8");

    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });

  it("throws a ConfigValidationError when required fields are missing", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const path = resolveConfigPath(dir);
    writeFileSync(path, JSON.stringify({ version: 1 }), "utf-8");

    expect(() => loadConfig(path)).toThrow(ConfigValidationError);
  });

  it("resolveDbPath leaves absolute paths untouched and resolves relative ones against cwd", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    expect(resolveDbPath(dir, "obyflow.db")).toBe(join(dir, "obyflow.db"));
    expect(resolveDbPath(dir, "/tmp/absolute.db")).toBe("/tmp/absolute.db");
  });
});
