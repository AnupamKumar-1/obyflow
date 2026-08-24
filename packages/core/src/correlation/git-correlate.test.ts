import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correlateGitCommit, enrichChangesWithGitMetadata } from "./git-correlate.js";
import type { ChangeEvent } from "../change/what-changed.js";

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoPath }).toString();
}

function makeChange(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    type: overrides.type ?? "commit",
    service: overrides.service ?? "checkout-service",
    from_deployment_id: overrides.from_deployment_id ?? null,
    to_deployment_id: overrides.to_deployment_id ?? "dep-2",
    from_value: overrides.from_value ?? "aaaaaaa",
    to_value: overrides.to_value ?? "bbbbbbb",
    detected_at: overrides.detected_at ?? "2026-01-01T00:00:00.000Z",
    ms_before_incident_window: overrides.ms_before_incident_window ?? 1000,
    correlated_anomaly_count: overrides.correlated_anomaly_count ?? 0,
    relevance_score: overrides.relevance_score ?? 1,
    reason: overrides.reason ?? "checkout-service commit changed",
  };
}

describe("git-correlate", () => {
  let repoPath: string;
  let commitSha: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), "obyflow-git-"));
    git(repoPath, ["init", "-q"]);
    git(repoPath, ["config", "user.email", "test@example.com"]);
    git(repoPath, ["config", "user.name", "Test User"]);
    writeFileSync(join(repoPath, "checkout.ts"), "export const a = 1;\n");
    git(repoPath, ["add", "."]);
    git(repoPath, ["commit", "-q", "-m", "initial commit"]);
    writeFileSync(join(repoPath, "checkout.ts"), "export const a = 2;\nexport const b = 3;\n");
    git(repoPath, ["add", "."]);
    git(repoPath, ["commit", "-q", "-m", "bump checkout constants"]);
    commitSha = git(repoPath, ["rev-parse", "HEAD"]).trim();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("returns null for a non-sha-shaped value", () => {
    expect(correlateGitCommit("not-a-sha", { repoPath })).toBeNull();
  });

  it("returns null when the repo path has no matching commit", () => {
    expect(correlateGitCommit("deadbeefdeadbeef", { repoPath })).toBeNull();
  });

  it("extracts commit metadata for a real commit", () => {
    const metadata = correlateGitCommit(commitSha, { repoPath });
    expect(metadata).not.toBeNull();
    expect(metadata?.sha).toBe(commitSha);
    expect(metadata?.author_email).toBe("test@example.com");
    expect(metadata?.subject).toBe("bump checkout constants");
    expect(metadata?.files_changed).toContain("checkout.ts");
    expect(metadata?.insertions).toBeGreaterThan(0);
  });

  it("enriches only commit-type changes when a repo path is provided", () => {
    const changes = [
      makeChange({ type: "commit", to_value: commitSha }),
      makeChange({ type: "config", to_value: "some-config-hash" }),
    ];
    const enriched = enrichChangesWithGitMetadata(changes, { repoPath });
    expect(enriched[0].git?.sha).toBe(commitSha);
    expect(enriched[1].git).toBeUndefined();
  });

  it("leaves changes untouched when no repo path is configured", () => {
    const changes = [makeChange({ type: "commit", to_value: commitSha })];
    const enriched = enrichChangesWithGitMetadata(changes);
    expect(enriched[0].git).toBeUndefined();
  });

  it("does not throw when to_value is not a plausible sha", () => {
    const changes = [makeChange({ type: "commit", to_value: "v2.3.1" })];
    const enriched = enrichChangesWithGitMetadata(changes, { repoPath });
    expect(enriched[0].git).toBeUndefined();
  });
});
