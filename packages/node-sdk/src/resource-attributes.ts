import os from "node:os";
import { execFileSync } from "node:child_process";

export type ResourceAttributesInput =
  | Record<string, unknown>
  | (() => Record<string, unknown>);

let cachedGitSha: string | null | undefined;

function detectGitSha(): string | null {
  if (cachedGitSha !== undefined) return cachedGitSha;

  const envSha =
    process.env.OBYFLOW_GIT_SHA ||
    process.env.GIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.HEROKU_SLUG_COMMIT ||
    null;

  if (envSha) {
    cachedGitSha = envSha;
    return cachedGitSha;
  }

  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    cachedGitSha = sha || null;
  } catch {
    cachedGitSha = null;
  }

  return cachedGitSha;
}

export function baseResourceAttributes(): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    hostname: os.hostname(),
    pid: process.pid,
    node_version: process.version,
  };
  const gitSha = detectGitSha();
  if (gitSha) attrs.git_sha = gitSha;
  return attrs;
}

export function resolveResourceAttributes(
  custom?: ResourceAttributesInput,
): Record<string, unknown> {
  const base = baseResourceAttributes();
  if (!custom) return base;
  const extra = typeof custom === "function" ? custom() : custom;
  return { ...base, ...extra };
}

export function _resetResourceAttributesCacheForTests(): void {
  cachedGitSha = undefined;
}
