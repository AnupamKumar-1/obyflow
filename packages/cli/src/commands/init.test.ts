import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerInitCommand } from "./init.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  return program;
}

describe("obyflow init", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("scaffolds a config file and detects a node project", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "widgets" }), "utf-8");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    logSpy.mockRestore();

    const configPath = join(dir, "obyflow.config.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.project.name).toBe("widgets");
    expect(config.project.language).toBe("node");
    expect(config.storage.dbPath).toBe("obyflow.db");
    expect(config.llm.provider).toBe("none");
  });

  it("falls back to unknown language and the directory name with no manifest", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    logSpy.mockRestore();

    const config = JSON.parse(readFileSync(join(dir, "obyflow.config.json"), "utf-8"));
    expect(config.project.language).toBe("unknown");
  });

  it("respects a custom --db path", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir, "--db", "custom.db"], { from: "user" });
    logSpy.mockRestore();

    const config = JSON.parse(readFileSync(join(dir, "obyflow.config.json"), "utf-8"));
    expect(config.storage.dbPath).toBe("custom.db");
  });

  it("refuses to overwrite an existing config without --force", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program1 = buildProgram();
    await program1.parseAsync(["init", "--cwd", dir], { from: "user" });
    const configPath = join(dir, "obyflow.config.json");
    const before = readFileSync(configPath, "utf-8");

    const program2 = buildProgram();
    await program2.parseAsync(["init", "--cwd", dir, "--db", "other.db"], { from: "user" });
    const after = readFileSync(configPath, "utf-8");

    logSpy.mockRestore();
    expect(after).toBe(before);
  });

  it("overwrites the existing config when --force is passed", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program1 = buildProgram();
    await program1.parseAsync(["init", "--cwd", dir], { from: "user" });

    const program2 = buildProgram();
    await program2.parseAsync(["init", "--cwd", dir, "--db", "custom.db", "--force"], {
      from: "user",
    });

    logSpy.mockRestore();

    const config = JSON.parse(readFileSync(join(dir, "obyflow.config.json"), "utf-8"));
    expect(config.storage.dbPath).toBe("custom.db");
  });
});
