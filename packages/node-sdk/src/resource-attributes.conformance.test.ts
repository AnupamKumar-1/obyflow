import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

interface EnvPrecedenceCase {
  name: string;
  env: Record<string, string>;
  expectedGitSha: string;
}

interface MergeCase {
  name: string;
  custom: Record<string, unknown>;
  expectMergedKeys: Record<string, unknown>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(
  __dirname,
  "../../../fixtures/parity/resource_attributes.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  envPrecedenceCases: EnvPrecedenceCase[];
  fallbackCase: { name: string; env: Record<string, string> };
  mergeCases: MergeCase[];
};

function clearGitShaEnvVars(): void {
  for (const key of GIT_SHA_ENV_VARS) delete process.env[key];
}

describe("resource-attributes conformance (shared fixture)", () => {
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

  for (const testCase of fixture.envPrecedenceCases) {
    it(testCase.name, () => {
      for (const [key, value] of Object.entries(testCase.env)) {
        process.env[key] = value;
      }
      const attrs = baseResourceAttributes();
      expect(attrs.git_sha).toBe(testCase.expectedGitSha);
    });
  }

  it(fixture.fallbackCase.name, () => {
    const expectedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
    })
      .toString()
      .trim();
    const attrs = baseResourceAttributes();
    expect(attrs.git_sha).toBe(expectedSha);
  });

  for (const testCase of fixture.mergeCases) {
    it(testCase.name, () => {
      const merged = resolveResourceAttributes(testCase.custom);
      for (const [key, value] of Object.entries(testCase.expectMergedKeys)) {
        expect(merged[key]).toBe(value);
      }
    });
  }
});
