import { configExists, loadConfig, resolveConfigPath, DEFAULT_REDACTION_CONFIG } from "@obyflow/core";
import type { RedactionConfig } from "@obyflow/core";

export function loadRedactionConfig(cwd: string = process.cwd()): RedactionConfig {
  try {
    const path = resolveConfigPath(cwd);
    if (configExists(path)) {
      return loadConfig(path).redaction;
    }
  } catch {
    return DEFAULT_REDACTION_CONFIG;
  }
  return DEFAULT_REDACTION_CONFIG;
}
