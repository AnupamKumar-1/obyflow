import { describe, it, expect } from "vitest";
import { LLMConfigError } from "@obyflow/llm-core";
import { createLLMAdapter } from "./create-adapter.js";

describe("createLLMAdapter", () => {
  it("returns null for the none provider", () => {
    expect(createLLMAdapter("none")).toBeNull();
  });

  it("throws LLMConfigError for anthropic without an api key", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createLLMAdapter("anthropic")).toThrow(LLMConfigError);
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  it("constructs an openai adapter given an api key", () => {
    const adapter = createLLMAdapter("openai", { apiKey: "test-key" });
    expect(adapter?.provider).toBe("openai");
  });

  it("constructs a gemini adapter given an api key", () => {
    const adapter = createLLMAdapter("gemini", { apiKey: "test-key" });
    expect(adapter?.provider).toBe("gemini");
  });

  it("constructs an ollama adapter without requiring an api key", () => {
    const adapter = createLLMAdapter("ollama");
    expect(adapter?.provider).toBe("ollama");
  });
});
