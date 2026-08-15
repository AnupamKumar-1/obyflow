export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface TokenLimitWarning {
  used_tokens: number;
  limit_tokens: number;
  usage_percentage: number;
  message: string;
  suggestions: string[];
}

const WARNING_THRESHOLD = 0.8;

const PROVIDER_DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
  anthropic: 200000,
  openai: 128000,
  gemini: 1000000,
  ollama: 8192,
};

const MODEL_CONTEXT_OVERRIDES: Array<{ pattern: RegExp; limit: number }> = [
  { pattern: /^claude-(opus|sonnet|haiku)-/i, limit: 200000 },
  { pattern: /^gpt-4o-mini/i, limit: 128000 },
  { pattern: /^gpt-4o/i, limit: 128000 },
  { pattern: /^gpt-4\.1/i, limit: 1000000 },
  { pattern: /^gpt-5/i, limit: 400000 },
  { pattern: /^o[13](-mini)?/i, limit: 200000 },
  { pattern: /^gemini-1\.5-pro/i, limit: 2000000 },
  { pattern: /^gemini-(2|3)/i, limit: 1000000 },
  { pattern: /^llama3\.1/i, limit: 128000 },
  { pattern: /^llama3(\.[02])?$/i, limit: 8192 },
  { pattern: /^mistral/i, limit: 32000 },
  { pattern: /^mixtral/i, limit: 32000 },
  { pattern: /^qwen2\.5/i, limit: 128000 },
];

const MODEL_PRICING_USD_PER_MILLION_TOKENS: Array<{
  pattern: RegExp;
  input: number;
  output: number;
}> = [
  { pattern: /^claude-opus-/i, input: 15, output: 75 },
  { pattern: /^claude-sonnet-/i, input: 3, output: 15 },
  { pattern: /^claude-haiku-/i, input: 0.8, output: 4 },
  { pattern: /^gpt-4o-mini/i, input: 0.15, output: 0.6 },
  { pattern: /^gpt-4o/i, input: 2.5, output: 10 },
  { pattern: /^gpt-5/i, input: 3, output: 15 },
  { pattern: /^gemini-.*flash/i, input: 0.075, output: 0.3 },
  { pattern: /^gemini-.*pro/i, input: 1.25, output: 5 },
];

export function estimateTokenCount(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function getContextLimit(provider: string, model: string): number {
  const override = MODEL_CONTEXT_OVERRIDES.find((entry) => entry.pattern.test(model));
  if (override) return override.limit;
  return PROVIDER_DEFAULT_CONTEXT_LIMITS[provider] ?? 32000;
}

export function normalizeUsage(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  totalTokens?: number | null | undefined,
): TokenUsage {
  const input = inputTokens ?? null;
  const output = outputTokens ?? null;
  const total =
    totalTokens ?? (input !== null && output !== null ? input + output : null);
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

export function buildTokenWarning(
  usage: TokenUsage,
  contextLimit: number,
): TokenLimitWarning | null {
  const used = usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
  if (!used || !contextLimit) return null;

  const ratio = used / contextLimit;
  if (ratio < WARNING_THRESHOLD) return null;

  return {
    used_tokens: used,
    limit_tokens: contextLimit,
    usage_percentage: Math.round(ratio * 1000) / 10,
    message: "Token usage is approaching the model limit.",
    suggestions: [
      "Reduce trace context",
      "Summarize older events",
      "Remove low-value events",
      "Use a larger-context model",
    ],
  };
}

export function estimateCostUsd(usage: TokenUsage, model: string): number | null {
  const entry = MODEL_PRICING_USD_PER_MILLION_TOKENS.find((e) => e.pattern.test(model));
  if (!entry) return null;

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cost = (inputTokens / 1_000_000) * entry.input + (outputTokens / 1_000_000) * entry.output;
  return Math.round(cost * 10000) / 10000;
}
