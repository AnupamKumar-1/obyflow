import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { SqliteStore } from "@obyflow/core";
import { registerIncidentCommand } from "./incident.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerIncidentCommand(program);
  return program;
}

function seedErrors(dbPath: string, count: number): void {
  const store = new SqliteStore(dbPath);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    store.insert({
      id: `err-${i}`,
      type: "error",
      trace_id: `trace-${i}`,
      request_id: null,
      service: "checkout-service",
      host: null,
      container: null,
      deployment_id: null,
      timestamp: new Date(now - i * 1000).toISOString(),
      duration_ms: null,
      attributes: {},
      severity: "error",
    });
  }
  store.close();
}

describe("obyflow incident summarize", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects --max-traces 0 with a validation error instead of claiming no errors exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-incident-"));
    const dbPath = join(dir, "new-test.db");
    seedErrors(dbPath, 3);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const program = buildProgram();
    await program.parseAsync(
      ["incident", "summarize", "--db", dbPath, "--since", "1h", "--max-traces", "0", "--no-llm"],
      { from: "user" },
    );

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).not.toContain("No error events found");
    expect(output).toContain("Invalid --max-traces");
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it("rejects a negative or non-integer --max-traces", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-incident-"));
    const dbPath = join(dir, "new-test.db");
    seedErrors(dbPath, 1);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const program = buildProgram();
    await program.parseAsync(
      ["incident", "summarize", "--db", dbPath, "--since", "1h", "--max-traces", "-1", "--no-llm"],
      { from: "user" },
    );

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Invalid --max-traces");
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it("still summarizes normally for a valid --max-traces", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-incident-"));
    const dbPath = join(dir, "new-test.db");
    seedErrors(dbPath, 3);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const program = buildProgram();
    await program.parseAsync(
      ["incident", "summarize", "--db", dbPath, "--since", "1h", "--max-traces", "5", "--no-llm"],
      { from: "user" },
    );

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).not.toContain("No error events found");
    expect(output).not.toContain("Invalid --max-traces");
    expect(process.exitCode).toBe(originalExitCode);
    process.exitCode = originalExitCode;
  });
});
