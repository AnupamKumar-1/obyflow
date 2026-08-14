import { describe, it, expect } from "vitest";
import {
  redactAttributes,
  redactEvent,
  DEFAULT_REDACTION_CONFIG,
} from "./redact.js";
import type { Event } from "../event-model/event.schema.js";

function makeEvent(attributes: Record<string, unknown>): Event {
  return {
    id: "evt_1",
    type: "log",
    trace_id: "t1",
    request_id: null,
    service: "checkout-service",
    host: null,
    container: null,
    deployment_id: null,
    timestamp: new Date().toISOString(),
    duration_ms: null,
    attributes,
    severity: "info",
  };
}

describe("redactAttributes", () => {
  it("redacts exact-match sensitive field names", () => {
    const result = redactAttributes({
      password: "hunter2",
      username: "alice",
    });
    expect(result["password"]).toBe("[REDACTED]");
    expect(result["username"]).toBe("alice");
  });

  it("matches keys case-insensitively and across naming conventions", () => {
    const result = redactAttributes({
      Authorization: "abc",
      api_key: "xyz",
      apiKey: "xyz2",
      creditCardNumber: "4111111111111111",
    });
    expect(result["Authorization"]).toBe("[REDACTED]");
    expect(result["api_key"]).toBe("[REDACTED]");
    expect(result["apiKey"]).toBe("[REDACTED]");
    expect(result["creditCardNumber"]).toBe("[REDACTED]");
  });

  it("redacts nested objects and arrays by key", () => {
    const result = redactAttributes({
      headers: {
        authorization: "Bearer abcdefghijklmnop",
        contentType: "application/json",
      },
      tokens: ["abc123", "def456"],
    });
    const headers = result["headers"] as Record<string, unknown>;
    expect(headers["authorization"]).toBe("[REDACTED]");
    expect(headers["contentType"]).toBe("application/json");
    expect(result["tokens"]).toEqual(["[REDACTED]", "[REDACTED]"]);
  });

  it("redacts a valid credit-card-shaped value found under an unrelated key", () => {
    const result = redactAttributes({
      note: "4111111111111111",
    });
    expect(result["note"]).toBe("[REDACTED]");
  });

  it("does not redact a digit string that fails the Luhn check", () => {
    const result = redactAttributes({
      note: "4111111111111112",
    });
    expect(result["note"]).toBe("4111111111111112");
  });

  it("redacts an SSN-shaped value under an unrelated key", () => {
    const result = redactAttributes({
      comment: "123-45-6789",
    });
    expect(result["comment"]).toBe("[REDACTED]");
  });

  it("redacts a bearer-token-shaped value under an unrelated key", () => {
    const result = redactAttributes({
      note: "Bearer abcdefghij1234567890",
    });
    expect(result["note"]).toBe("[REDACTED]");
  });

  it("leaves unrelated values untouched", () => {
    const result = redactAttributes({
      status_code: 200,
      message: "checkout completed",
      count: 42,
    });
    expect(result).toEqual({
      status_code: 200,
      message: "checkout completed",
      count: 42,
    });
  });

  it("passes attributes through unchanged when redaction is disabled", () => {
    const result = redactAttributes(
      { password: "hunter2" },
      { ...DEFAULT_REDACTION_CONFIG, enabled: false },
    );
    expect(result["password"]).toBe("hunter2");
  });
});

describe("redactEvent", () => {
  it("returns a new event with attributes redacted and does not mutate the original", () => {
    const event = makeEvent({ password: "hunter2", message: "ok" });
    const redacted = redactEvent(event);
    expect(redacted.attributes["password"]).toBe("[REDACTED]");
    expect(event.attributes["password"]).toBe("hunter2");
    expect(redacted).not.toBe(event);
  });
});