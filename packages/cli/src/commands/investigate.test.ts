import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { SqliteStore } from "@obyflow/core";
import { registerInvestigateCommand } from "./investigate.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInvestigateCommand(program);
  return program;
}

describe("obyflow investigate", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports that a nonexistent trace was not found and exits non-zero", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-investigate-"));
    const dbPath = join(dir, "empty-investigate.db");
    const store = new SqliteStore(dbPath);
    store.close();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const program = buildProgram();
    await program.parseAsync(
      ["investigate", "trace-does-not-exist", "--db", dbPath, "--no-llm"],
      { from: "user" },
    );

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("Trace not found: trace-does-not-exist");
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });

  it("does not report a false not-found for a trace that has events", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-investigate-"));
    const dbPath = join(dir, "populated.db");
    const store = new SqliteStore(dbPath);
    store.insert({
      id: "e1",
      type: "trace",
      trace_id: "trace-1",
      request_id: null,
      service: "checkout-service",
      host: null,
      container: null,
      deployment_id: null,
      timestamp: new Date().toISOString(),
      duration_ms: 12,
      attributes: {},
      severity: null,
    });
    store.close();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const program = buildProgram();
    await program.parseAsync(["investigate", "trace-1", "--db", dbPath, "--no-llm"], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).not.toContain("Trace not found");
    expect(process.exitCode).toBe(originalExitCode);
    process.exitCode = originalExitCode;
  });
});
