export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.status === "number") return anyErr.status;
    if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
    const response = anyErr.response as Record<string, unknown> | undefined;
    if (response && typeof response === "object" && typeof response.status === "number") {
      return response.status as number;
    }
  }
  return undefined;
}

export function isRetryableLLMError(err: unknown): boolean {
  const status = extractStatus(err);
  if (status === 429 || status === 503) return true;
  const message = err instanceof Error ? err.message : String(err);
  return (
    /\b(429|503)\b/.test(message) ||
    /UNAVAILABLE/i.test(message) ||
    /rate.?limit/i.test(message) ||
    /overloaded/i.test(message) ||
    /high demand/i.test(message) ||
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED/.test(message)
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const isRetryable = options.isRetryable ?? isRetryableLLMError;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) {
        throw err;
      }
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError;
}
