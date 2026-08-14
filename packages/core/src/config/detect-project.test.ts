import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { detectProject } from "./detect-project.js";

describe("detectProject", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("detects a node project and reads its name from package.json", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-node-app" }), "utf-8");

    const result = detectProject(dir);
    expect(result.language).toBe("node");
    expect(result.name).toBe("my-node-app");
    expect(result.hasDocker).toBe(false);
  });

  it("falls back to the directory name when package.json has no name", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({}), "utf-8");

    const result = detectProject(dir);
    expect(result.language).toBe("node");
    expect(result.name).toBe(basename(dir));
  });

  it("detects a python project via requirements.txt", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    writeFileSync(join(dir, "requirements.txt"), "fastapi\n", "utf-8");

    const result = detectProject(dir);
    expect(result.language).toBe("python");
  });

  it("detects a python project via pyproject.toml", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    writeFileSync(join(dir, "pyproject.toml"), "[tool.poetry]\nname = 'demo'\n", "utf-8");

    const result = detectProject(dir);
    expect(result.language).toBe("python");
  });

  it("falls back to unknown when no recognizable manifest is present", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    const result = detectProject(dir);
    expect(result.language).toBe("unknown");
    expect(result.name).toBe(basename(dir));
  });

  it("flags a Dockerfile when present regardless of language", () => {
    dir = mkdtempSync(join(tmpdir(), "obyflow-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "containerized" }), "utf-8");
    writeFileSync(join(dir, "Dockerfile"), "FROM node:22\n", "utf-8");

    const result = detectProject(dir);
    expect(result.hasDocker).toBe(true);
  });
});
