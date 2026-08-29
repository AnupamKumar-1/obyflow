import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { redactAttributes } from "./redact.js";

interface AttributeCase {
  name: string;
  attributes: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(
  __dirname,
  "../../../../fixtures/parity/redaction.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  attributeCases: AttributeCase[];
};

describe("redaction conformance (shared fixture)", () => {
  for (const testCase of fixture.attributeCases) {
    it(testCase.name, () => {
      const result = redactAttributes(testCase.attributes);
      expect(result).toEqual(testCase.expected);
    });
  }
});
