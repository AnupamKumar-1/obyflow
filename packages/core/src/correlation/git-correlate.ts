import { execFileSync } from "node:child_process";
import { ChangeEvent } from "../change/what-changed.js";

export interface GitCommitMetadata {
  sha: string;
  author_name: string | null;
  author_email: string | null;
  committed_at: string | null;
  subject: string | null;
  files_changed: string[];
  files_changed_truncated: boolean;
  insertions: number;
  deletions: number;
}

export interface GitCorrelationOptions {
  repoPath: string;
  maxFiles?: number;
}

export interface GitEnrichedChangeEvent extends ChangeEvent {
  git?: GitCommitMetadata | null;
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const DEFAULT_MAX_FILES = 25;

function isPlausibleSha(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value.trim());
}

function runGit(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return null;
  }
}

function parseStatLine(line: string): string | null {
  const match = line.match(/^\s*(.+?)\s+\|\s+\d+/);
  return match ? match[1].trim() : null;
}

function parseSummaryLine(line: string): { insertions: number; deletions: number } | null {
  if (!/file[s]? changed/.test(line)) return null;
  const insMatch = line.match(/(\d+) insertion/);
  const delMatch = line.match(/(\d+) deletion/);
  return {
    insertions: insMatch ? Number(insMatch[1]) : 0,
    deletions: delMatch ? Number(delMatch[1]) : 0,
  };
}

export function correlateGitCommit(
  sha: string,
  options: GitCorrelationOptions,
): GitCommitMetadata | null {
  if (!isPlausibleSha(sha)) return null;
  const cleanSha = sha.trim();

  const showOutput = runGit(options.repoPath, [
    "show",
    "--no-color",
    "--stat=200",
    "--format=%H%n%an%n%ae%n%aI%n%s",
    cleanSha,
  ]);
  if (showOutput === null) return null;

  const lines = showOutput.split("\n");
  const fullSha = lines[0]?.trim() || cleanSha;
  const authorName = lines[1]?.trim() || null;
  const authorEmail = lines[2]?.trim() || null;
  const committedAt = lines[3]?.trim() || null;
  const subject = lines[4]?.trim() || null;

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const filesChanged: string[] = [];
  let filesChangedTruncated = false;
  let insertions = 0;
  let deletions = 0;

  for (const line of lines.slice(5)) {
    const file = parseStatLine(line);
    if (file) {
      if (filesChanged.length < maxFiles) {
        filesChanged.push(file);
      } else {
        filesChangedTruncated = true;
      }
      continue;
    }
    const summary = parseSummaryLine(line);
    if (summary) {
      insertions = summary.insertions;
      deletions = summary.deletions;
    }
  }

  return {
    sha: fullSha,
    author_name: authorName,
    author_email: authorEmail,
    committed_at: committedAt,
    subject,
    files_changed: filesChanged,
    files_changed_truncated: filesChangedTruncated,
    insertions,
    deletions,
  };
}

export function enrichChangesWithGitMetadata(
  changes: ChangeEvent[],
  options?: GitCorrelationOptions,
): GitEnrichedChangeEvent[] {
  if (!options?.repoPath) return changes;
  return changes.map((change) => {
    if (change.type !== "commit") return change;
    if (!isPlausibleSha(change.to_value)) return change;
    const git = correlateGitCommit(change.to_value, options);
    return { ...change, git };
  });
}
