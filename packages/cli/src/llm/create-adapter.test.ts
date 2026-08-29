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

  it("constructs an openai adapter given an api key and model", () => {
    const adapter = createLLMAdapter("openai", { apiKey: "test-key", model: "gpt-5.5" });
    expect(adapter?.provider).toBe("openai");
  });

  it("throws LLMConfigError for openai without a model", () => {
    expect(() => createLLMAdapter("openai", { apiKey: "test-key" })).toThrow(LLMConfigError);
  });

  it("constructs a gemini adapter given an api key and model", () => {
    const adapter = createLLMAdapter("gemini", { apiKey: "test-key", model: "gemini-2.5-flash" });
    expect(adapter?.provider).toBe("gemini");
  });

  it("throws LLMConfigError for gemini without a model", () => {
    expect(() => createLLMAdapter("gemini", { apiKey: "test-key" })).toThrow(LLMConfigError);
  });

  it("constructs an ollama adapter without requiring an api key, given a model", () => {
    const adapter = createLLMAdapter("ollama", { model: "llama3.1" });
    expect(adapter?.provider).toBe("ollama");
  });

  it("throws LLMConfigError for ollama without a model", () => {
    expect(() => createLLMAdapter("ollama")).toThrow(LLMConfigError);
  });
});
