import type { EvidenceObject } from "@obyflow/core";
import type { TokenLimitWarning, TokenUsage } from "./token-usage.js";

export type { ConfidenceTier } from "@obyflow/core";

export interface LLMAdapterConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface InvestigationFinding {
  root_cause: string;
  evidence_refs: string[];
  recommendation: string;
}

export interface LLMInvestigationResult extends InvestigationFinding {
  provider: string;
  model: string;
  requested_at: string;
  latency_ms: number;
  raw_response: string;
  usage: TokenUsage;
  context_limit: number;
  token_warning: TokenLimitWarning | null;
  estimated_cost_usd: number | null;
}

export interface LLMAdapter {
  readonly provider: string;
  readonly model: string;
  investigate(
    evidence: EvidenceObject,
    question?: string,
  ): Promise<LLMInvestigationResult>;
}

export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export function resolveConfigValue(
  explicit: string | undefined,
  envVar: string,
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromEnv = process.env[envVar];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined;
}

export function resolveNumberConfigValue(
  explicit: number | undefined,
  envVar: string,
): number | undefined {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env[envVar];
  if (fromEnv === undefined || fromEnv.length === 0) return undefined;
  const parsed = Number(fromEnv);
  return Number.isFinite(parsed) ? parsed : undefined;
}
