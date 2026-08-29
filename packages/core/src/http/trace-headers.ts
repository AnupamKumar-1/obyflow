export interface InboundTraceHeaders {
  traceId: string;
  parentSpanId: string | null;
}

export type HeaderValue = string | string[] | undefined | null;

function normalizeHeaderValue(value: HeaderValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeHeaders(
  headers: Record<string, HeaderValue>,
): Record<string, HeaderValue> {
  const normalized: Record<string, HeaderValue> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

export function extractInboundTraceHeaders(
  headers: Record<string, HeaderValue>,
  generateId: () => string,
): InboundTraceHeaders {
  const normalized = normalizeHeaders(headers);
  const traceId =
    normalizeHeaderValue(normalized["x-obyflow-trace-id"]) || generateId();
  const parentSpanId = normalizeHeaderValue(
    normalized["x-obyflow-parent-span-id"],
  );
  return { traceId, parentSpanId };
}
