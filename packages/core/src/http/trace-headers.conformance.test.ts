import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { extractInboundTraceHeaders } from "./trace-headers.js";

interface TraceHeaderCase {
  name: string;
  headers: Record<string, string>;
  expectedTraceId: string;
  expectedParentSpanId: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(
  __dirname,
  "../../../../fixtures/parity/trace_headers.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  cases: TraceHeaderCase[];
  generatedIdSentinel: string;
};

describe("trace-header assignment conformance (shared fixture)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const result = extractInboundTraceHeaders(
        testCase.headers,
        () => fixture.generatedIdSentinel,
      );
      const expectedTraceId =
        testCase.expectedTraceId === "GENERATED"
          ? fixture.generatedIdSentinel
          : testCase.expectedTraceId;
      expect(result.traceId).toBe(expectedTraceId);
      expect(result.parentSpanId).toBe(testCase.expectedParentSpanId);
    });
  }
});
