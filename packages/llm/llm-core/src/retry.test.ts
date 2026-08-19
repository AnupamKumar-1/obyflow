import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableLLMError } from "./retry.js";

function makeStatusError(status: number, message = "error"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("isRetryableLLMError", () => {
  it("treats 503 status errors as retryable", () => {
    expect(isRetryableLLMError(makeStatusError(503))).toBe(true);
  });

  it("treats 429 status errors as retryable", () => {
    expect(isRetryableLLMError(makeStatusError(429))).toBe(true);
  });

  it("treats UNAVAILABLE / high demand messages as retryable", () => {
    expect(
      isRetryableLLMError(
        new Error("503 UNAVAILABLE This model is currently experiencing high demand."),
      ),
    ).toBe(true);
  });

  it("does not treat unrelated errors as retryable", () => {
    expect(isRetryableLLMError(makeStatusError(400))).toBe(false);
    expect(isRetryableLLMError(new Error("invalid api key"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result immediately when the function succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { sleep: async () => {} });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a retryable error and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeStatusError(503))
      .mockRejectedValueOnce(makeStatusError(503))
      .mockResolvedValueOnce("recovered");

    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await withRetry(fn, { retries: 3, sleep });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(makeStatusError(400, "bad request"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { retries: 3, sleep })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(makeStatusError(503, "still unavailable"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { retries: 2, sleep })).rejects.toThrow("still unavailable");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff delays", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeStatusError(503))
      .mockRejectedValueOnce(makeStatusError(503))
      .mockResolvedValueOnce("done");

    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });

    await withRetry(fn, { retries: 3, baseDelayMs: 100, sleep });

    expect(delays).toEqual([100, 200]);
  });
});
