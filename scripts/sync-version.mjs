#!/usr/bin/env node
/**
 * Sync a single version across every publishable package in the monorepo
 * (root package.json, all pnpm workspace packages, and the Python SDK's
 * pyproject.toml).
 *
 * This is the ONLY place a version bump should happen — never hand-edit
 * a version field in an individual package.json or pyproject.toml.
 *
 * Usage:
 *   node scripts/sync-version.mjs 1.1.0
 *   pnpm run version:sync 1.1.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/sync-version.mjs <semver>  e.g. 1.1.0");
  process.exit(1);
}

// Discover every workspace package.json from pnpm-workspace.yaml globs,
// so new packages are picked up automatically — nothing hardcoded here.
function findPackageJsonFiles() {
  const out = execSync(
    `pnpm -r exec node -e "console.log(process.cwd())"`,
    { cwd: rootDir, encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((dir) => path.join(dir, "package.json"));
  return [path.join(rootDir, "package.json"), ...out];
}

function bumpJson(file) {
  const raw = readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  const before = json.version;
  json.version = version;
  // preserve trailing newline / formatting style
  const newline = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(file, JSON.stringify(json, null, 2) + newline);
  console.log(`✓ ${path.relative(rootDir, file)}  ${before} -> ${version}`);
}

function bumpPyproject(file) {
  const raw = readFileSync(file, "utf8");
  const before = raw.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const updated = raw.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`
  );
  writeFileSync(file, updated);
  console.log(`✓ ${path.relative(rootDir, file)}  ${before} -> ${version}`);
}

for (const f of findPackageJsonFiles()) {
  bumpJson(f);
}

bumpPyproject(path.join(rootDir, "python/obyflow-python/pyproject.toml"));

console.log(`\nAll packages synced to ${version}.`);
