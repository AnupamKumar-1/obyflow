import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { SqliteStore } from "@obyflow/core";
import { registerServicesCommand } from "./services.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerServicesCommand(program);
  return program;
}

function seedEvents(dbPath: string): void {
  const store = new SqliteStore(dbPath);
  const now = Date.now();
  store.insert({
    id: "evt-1",
    type: "log",
    trace_id: "trace-1",
    request_id: null,
    service: "checkout-service",
    host: null,
    container: null,
    deployment_id: null,
    timestamp: new Date(now).toISOString(),
    duration_ms: null,
    attributes: {},
    severity: "info",
  });
  store.insert({
    id: "evt-2",
    type: "error",
    trace_id: "trace-2",
    request_id: null,
    service: "checkout-service",
    host: null,
    container: null,
    deployment_id: null,
    timestamp: new Date(now + 1000).toISOString(),
    duration_ms: null,
    attributes: {},
    severity: "error",
  });
  store.close();
}

describe("obyflow services --detail", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("does not reject the --detail flag", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-services-"));
    const dbPath = join(dir, "test.db");
    seedEvents(dbPath);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = buildProgram();

    await program.parseAsync(["services", "--db", dbPath, "--detail"], { from: "user" });

    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("renders detail cards including the service name and error count", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-services-"));
    const dbPath = join(dir, "test.db");
    seedEvents(dbPath);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();

    await program.parseAsync(["services", "--db", dbPath, "--detail"], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("checkout-service");
    expect(output).toContain("1");
    logSpy.mockRestore();
  });

  it("still renders the table when --detail is omitted", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-services-"));
    const dbPath = join(dir, "test.db");
    seedEvents(dbPath);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();

    await program.parseAsync(["services", "--db", dbPath], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("SERVICE");
    expect(output).toContain("checkout-service");
    logSpy.mockRestore();
  });
});
