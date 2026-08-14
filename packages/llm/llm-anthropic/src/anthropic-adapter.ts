import Anthropic from "@anthropic-ai/sdk";
import type { EvidenceObject } from "@obyflow/core";
import {
  LLMConfigError,
  resolveConfigValue,
  resolveNumberConfigValue,
} from "@obyflow/llm-core";
import type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMInvestigationResult,
} from "@obyflow/llm-core";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;

const FINDING_TOOL_NAME = "submit_investigation_finding";

const FINDING_TOOL: Anthropic.Tool = {
  name: FINDING_TOOL_NAME,
  description:
    "Submit the structured root-cause investigation finding derived strictly from the provided evidence object.",
  input_schema: {
    type: "object",
    properties: {
      root_cause: {
        type: "string",
        description:
          "A concise explanation of the most likely root cause, grounded only in the supplied evidence.",
      },
      evidence_refs: {
        type: "array",
        items: { type: "string" },
        description:
          "IDs of evidence items (from the evidence array) that support the root cause.",
      },
      recommendation: {
        type: "string",
        description:
          "A concrete, actionable recommendation to resolve or mitigate the issue.",
      },
    },
    required: ["root_cause", "evidence_refs", "recommendation"],
  },
};

function buildSystemPrompt(): string {
  return [
    "You are the investigation engine inside Obyflow, an observability platform.",
    "You are given a structured Evidence Object containing correlated trace, log, metric, and error data along with computed anomaly scores.",
    "Ground every claim strictly in the supplied evidence. Do not invent services, timestamps, or values that are not present in the evidence object.",
    "Reference evidence items by their id field in evidence_refs.",
    "Do not compute or state a confidence level; that is handled outside of you.",
    "Call the submit_investigation_finding tool exactly once with your finding.",
  ].join(" ");
}

function buildUserPrompt(evidence: EvidenceObject, question?: string): string {
  return [
    question
      ? `Investigation question: ${question}`
      : "Investigate this trace and determine the most likely root cause.",
    "Evidence Object (JSON):",
    JSON.stringify(evidence, null, 2),
  ].join("\n\n");
}

interface RawFinding {
  root_cause?: unknown;
  evidence_refs?: unknown;
  recommendation?: unknown;
}

function isValidFinding(
  finding: RawFinding,
): finding is { root_cause: string; evidence_refs: unknown[]; recommendation: string } {
  return (
    typeof finding.root_cause === "string" &&
    typeof finding.recommendation === "string" &&
    Array.isArray(finding.evidence_refs)
  );
}

export class AnthropicLLMAdapter implements LLMAdapter {
  readonly provider = "anthropic";
  readonly model: string;

  private readonly client: Anthropic;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: LLMAdapterConfig = {}) {
    const apiKey = resolveConfigValue(config.apiKey, "ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new LLMConfigError(
        "Missing Anthropic API key. Pass apiKey to AnthropicLLMAdapter or set ANTHROPIC_API_KEY.",
      );
    }

    this.model =
      resolveConfigValue(config.model, "OBYFLOW_ANTHROPIC_MODEL") ?? DEFAULT_MODEL;
    this.maxTokens =
      resolveNumberConfigValue(config.maxTokens, "OBYFLOW_ANTHROPIC_MAX_TOKENS") ??
      DEFAULT_MAX_TOKENS;
    this.temperature =
      resolveNumberConfigValue(config.temperature, "OBYFLOW_ANTHROPIC_TEMPERATURE") ??
      DEFAULT_TEMPERATURE;

    const baseURL = resolveConfigValue(config.baseUrl, "OBYFLOW_ANTHROPIC_BASE_URL");

    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async investigate(
    evidence: EvidenceObject,
    question?: string,
  ): Promise<LLMInvestigationResult> {
    const requestedAt = new Date().toISOString();
    const startedAt = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(evidence, question),
        },
      ],
      tools: [FINDING_TOOL],
      tool_choice: { type: "tool", name: FINDING_TOOL_NAME },
    });

    const latencyMs = Date.now() - startedAt;

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUseBlock) {
      throw new Error(
        "Anthropic response did not include a tool_use block for submit_investigation_finding",
      );
    }

    const finding = toolUseBlock.input as RawFinding;

    if (!isValidFinding(finding)) {
      throw new Error(
        "Anthropic tool_use input did not match the expected investigation finding shape",
      );
    }

    const evidenceRefs = finding.evidence_refs.filter(
      (ref): ref is string => typeof ref === "string",
    );

    return {
      root_cause: finding.root_cause,
      evidence_refs: evidenceRefs,
      recommendation: finding.recommendation,
      provider: this.provider,
      model: this.model,
      requested_at: requestedAt,
      latency_ms: latencyMs,
      raw_response: JSON.stringify(response.content),
    };
  }
}
