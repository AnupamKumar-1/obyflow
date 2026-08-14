import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ProjectLanguage } from "./config.schema.js";

export interface DetectedProject {
  name: string;
  language: ProjectLanguage;
  hasDocker: boolean;
}

function readPackageJsonName(packageJsonPath: string, fallback: string): string {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function detectProject(cwd: string = process.cwd()): DetectedProject {
  const dirName = basename(resolve(cwd)) || "obyflow-project";
  const packageJsonPath = resolve(cwd, "package.json");
  const pyprojectPath = resolve(cwd, "pyproject.toml");
  const requirementsPath = resolve(cwd, "requirements.txt");
  const dockerfilePath = resolve(cwd, "Dockerfile");

  const hasDocker = existsSync(dockerfilePath);

  if (existsSync(packageJsonPath)) {
    return {
      name: readPackageJsonName(packageJsonPath, dirName),
      language: "node",
      hasDocker,
    };
  }

  if (existsSync(pyprojectPath) || existsSync(requirementsPath)) {
    return { name: dirName, language: "python", hasDocker };
  }

  return { name: dirName, language: "unknown", hasDocker };
}
