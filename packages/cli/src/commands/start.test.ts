import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerInitCommand } from "./init.js";
import { registerStartCommand } from "./start.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  registerStartCommand(program);
  return program;
}

describe("obyflow start", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates the sqlite database referenced by the config", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir, "--db", "obyflow.db"], { from: "user" });
    await program.parseAsync(["start", "--cwd", dir], { from: "user" });

    logSpy.mockRestore();
    expect(existsSync(join(dir, "obyflow.db"))).toBe(true);
  });

  it("falls back to defaults and warns when no config exists", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["start", "--cwd", dir], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(existsSync(join(dir, "obyflow.db"))).toBe(true);
    expect(output).toContain("No config found");
  });

  it("an explicit --db overrides the value stored in the config", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir, "--db", "configured.db"], { from: "user" });
    await program.parseAsync(["start", "--cwd", dir, "--db", "override.db"], { from: "user" });

    logSpy.mockRestore();
    expect(existsSync(join(dir, "override.db"))).toBe(true);
    expect(existsSync(join(dir, "configured.db"))).toBe(false);
  });

  it("reports the configured llm provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = buildProgram();
    await program.parseAsync(["init", "--cwd", dir], { from: "user" });
    await program.parseAsync(["start", "--cwd", dir], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("none");
  });
});
