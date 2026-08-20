import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { SqliteStore } from "@obyflow/core";
import { registerUsageCommand } from "./usage.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerUsageCommand(program);
  return program;
}

function seedLlmCalls(
  dbPath: string,
  calls: Array<{ service: string; model: string; promptTokens: number; completionTokens: number }>,
): void {
  const store = new SqliteStore(dbPath);
  const now = Date.now();
  calls.forEach((call, i) => {
    store.insert({
      id: `llm-${i}`,
      type: "llm_call",
      trace_id: `trace-${i}`,
      request_id: null,
      service: call.service,
      host: null,
      container: null,
      deployment_id: null,
      timestamp: new Date(now - i * 1000).toISOString(),
      duration_ms: 120,
      attributes: {
        model: call.model,
        provider: "anthropic",
        prompt_tokens: call.promptTokens,
        completion_tokens: call.completionTokens,
      },
      severity: null,
    });
  });
  store.close();
}

describe("obyflow usage", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates token counts per service", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-usage-"));
    const dbPath = join(dir, "test.db");
    seedLlmCalls(dbPath, [
      { service: "checkout-api", model: "claude-sonnet-4", promptTokens: 1000, completionTokens: 200 },
      { service: "checkout-api", model: "claude-sonnet-4", promptTokens: 500, completionTokens: 100 },
      { service: "billing-api", model: "gpt-4o", promptTokens: 300, completionTokens: 50 },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["usage", "--db", dbPath], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("checkout-api");
    expect(output).toContain("billing-api");
    expect(output).toContain("1,800");
    expect(output).toContain("350");
    expect(output).toContain("3 llm_call event(s) across 2 service(s)");
    expect(output).toContain("2,150 tokens");
  });

  it("filters by service", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-usage-"));
    const dbPath = join(dir, "test.db");
    seedLlmCalls(dbPath, [
      { service: "checkout-api", model: "claude-sonnet-4", promptTokens: 1000, completionTokens: 200 },
      { service: "billing-api", model: "gpt-4o", promptTokens: 300, completionTokens: 50 },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["usage", "--db", dbPath, "--service", "billing-api"], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("billing-api");
    expect(output).not.toContain("checkout-api");
  });

  it("prints a no-results message when there are no llm_call events", async () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-cli-usage-"));
    const dbPath = join(dir, "test.db");
    seedLlmCalls(dbPath, []);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram();
    await program.parseAsync(["usage", "--db", dbPath], { from: "user" });

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    logSpy.mockRestore();

    expect(output).toContain("No results.");
  });
});
