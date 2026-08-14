import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerInitCommand } from "./init.js";
import { registerConfigCommand } from "./config.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  registerConfigCommand(program);
  return program;
}

describe("obyflow config", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("set persists a value and get reads it back", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    await program.parseAsync(
      ["config", "set", "storage.dbPath", "custom.db", "--cwd", dir],
      { from: "user" },
    );
    logSpy.mockClear();
    await program.parseAsync(["config", "get", "storage.dbPath", "--cwd", dir], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("custom.db");
  });

  it("config llm --provider anthropic updates and persists the provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    await program.parseAsync(
      ["config", "llm", "--provider", "anthropic", "--cwd", dir],
      { from: "user" },
    );
    logSpy.mockRestore();

    const config = JSON.parse(readFileSync(join(dir, "obyflow.config.json"), "utf-8"));
    expect(config.llm.provider).toBe("anthropic");
  });

  it("rejects an unknown llm provider and leaves the config unchanged", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    await program.parseAsync(["config", "llm", "--provider", "bogus", "--cwd", dir], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Invalid provider");
    const config = JSON.parse(readFileSync(join(dir, "obyflow.config.json"), "utf-8"));
    expect(config.llm.provider).toBe("none");
  });

  it("config list falls back to defaults without writing a file when none exists", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["config", "list", "--cwd", dir], { from: "user" });

    logSpy.mockRestore();
    expect(existsSync(join(dir, "obyflow.config.json"))).toBe(false);
  });

  it("config get reports an unknown key", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    await program.parseAsync(["config", "get", "not.a.real.key", "--cwd", dir], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();
    expect(output).toContain("Unknown config key");
  });
});
