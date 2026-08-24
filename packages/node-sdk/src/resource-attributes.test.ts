import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  baseResourceAttributes,
  resolveResourceAttributes,
  _resetResourceAttributesCacheForTests,
} from "./resource-attributes.js";

const GIT_SHA_ENV_VARS = [
  "OBYFLOW_GIT_SHA",
  "GIT_SHA",
  "GIT_COMMIT",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "HEROKU_SLUG_COMMIT",
];

function clearGitShaEnvVars(): void {
  for (const key of GIT_SHA_ENV_VARS) delete process.env[key];
}

describe("resource-attributes", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of GIT_SHA_ENV_VARS) savedEnv[key] = process.env[key];
    clearGitShaEnvVars();
    _resetResourceAttributesCacheForTests();
  });

  afterEach(() => {
    for (const key of GIT_SHA_ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    _resetResourceAttributesCacheForTests();
  });

  it("includes hostname, pid, and node_version", () => {
    const attrs = baseResourceAttributes();
    expect(attrs.hostname).toBeDefined();
    expect(attrs.pid).toBe(process.pid);
    expect(attrs.node_version).toBe(process.version);
  });

  it("prefers OBYFLOW_GIT_SHA over other env vars", () => {
    process.env.OBYFLOW_GIT_SHA = "sha-primary";
    process.env.GIT_SHA = "sha-secondary";
    const attrs = baseResourceAttributes();
    expect(attrs.git_sha).toBe("sha-primary");
  });

  it("falls back through the env var precedence order", () => {
    process.env.GIT_COMMIT = "sha-from-git-commit";
    const attrs = baseResourceAttributes();
    expect(attrs.git_sha).toBe("sha-from-git-commit");
  });

  it("caches the detected git_sha across calls", () => {
    process.env.OBYFLOW_GIT_SHA = "cached-sha";
    const first = baseResourceAttributes();
    delete process.env.OBYFLOW_GIT_SHA;
    const second = baseResourceAttributes();
    expect(first.git_sha).toBe("cached-sha");
    expect(second.git_sha).toBe("cached-sha");
  });

  it("resolveResourceAttributes merges a static custom object over the base", () => {
    process.env.OBYFLOW_GIT_SHA = "sha1";
    const merged = resolveResourceAttributes({ config_hash: "abc", hostname: "override" });
    expect(merged.config_hash).toBe("abc");
    expect(merged.hostname).toBe("override");
    expect(merged.git_sha).toBe("sha1");
  });

  it("resolveResourceAttributes merges a callback's return value over the base", () => {
    process.env.OBYFLOW_GIT_SHA = "sha1";
    const merged = resolveResourceAttributes(() => ({ model_version: "gpt-x-2" }));
    expect(merged.model_version).toBe("gpt-x-2");
    expect(merged.git_sha).toBe("sha1");
  });

  it("resolveResourceAttributes returns just the base when no custom is given", () => {
    process.env.OBYFLOW_GIT_SHA = "sha1";
    expect(resolveResourceAttributes()).toEqual(baseResourceAttributes());
  });
});
