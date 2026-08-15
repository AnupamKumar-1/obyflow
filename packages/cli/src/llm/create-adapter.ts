import { AnthropicLLMAdapter } from "@obyflow/llm-anthropic";
import { OpenAILLMAdapter } from "@obyflow/llm-openai";
import { GeminiLLMAdapter } from "@obyflow/llm-gemini";
import { OllamaLLMAdapter } from "@obyflow/llm-ollama";
import { LLMConfigError } from "@obyflow/llm-core";
import type { LLMAdapter, LLMAdapterConfig } from "@obyflow/llm-core";
import type { LLMProvider } from "@obyflow/core";

export function createLLMAdapter(
  provider: LLMProvider,
  config: LLMAdapterConfig = {},
): LLMAdapter | null {
  switch (provider) {
    case "anthropic":
      return new AnthropicLLMAdapter(config);
    case "openai":
      return new OpenAILLMAdapter(config);
    case "gemini":
      return new GeminiLLMAdapter(config);
    case "ollama":
      return new OllamaLLMAdapter(config);
    case "none":
      return null;
    default:
      throw new LLMConfigError(`Unsupported LLM provider "${provider}".`);
  }
}
