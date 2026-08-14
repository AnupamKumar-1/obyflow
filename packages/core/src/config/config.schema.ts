import { z } from "zod";

export const ProjectLanguage = z.enum(["node", "python", "unknown"]);
export type ProjectLanguage = z.infer<typeof ProjectLanguage>;

export const LLMProvider = z.enum(["anthropic", "openai", "gemini", "ollama", "none"]);
export type LLMProvider = z.infer<typeof LLMProvider>;

export const DEFAULT_CONFIG_FILENAME = "obyflow.config.json";

export const DEFAULT_REDACTION_FIELDS = [
  "password",
  "token",
  "authorization",
  "creditCard",
  "ssn",
  "apiKey",
];

export const ObyflowConfigSchema = z.object({
  version: z.number().int().default(1),
  project: z.object({
    name: z.string().min(1),
    language: ProjectLanguage.default("unknown"),
  }),
  storage: z.object({
    dbPath: z.string().min(1).default("obyflow.db"),
  }),
  llm: z.object({
    provider: LLMProvider.default("none"),
    model: z.string().nullable().default(null),
  }),
  redaction: z.object({
    enabled: z.boolean().default(true),
    fields: z.array(z.string()).default(DEFAULT_REDACTION_FIELDS),
    applied_at: z.enum(["ingestion", "evidence"]).default("ingestion"),
  }),
});

export type ObyflowConfig = z.infer<typeof ObyflowConfigSchema>;

export function createDefaultConfig(projectName: string): ObyflowConfig {
  return ObyflowConfigSchema.parse({
    version: 1,
    project: { name: projectName, language: "unknown" },
    storage: { dbPath: "obyflow.db" },
    llm: { provider: "none", model: null },
    redaction: {
      enabled: true,
      fields: DEFAULT_REDACTION_FIELDS,
      applied_at: "ingestion",
    },
  });
}
