import { InstrumentationContext, PgVectorClientLike } from "./types.js";

interface PgVectorResult {
  rows?: Array<Record<string, unknown>>;
}
import { emitVectorOpEvent, extractNumericField, timeAsync } from "./shared.js";

function isPgVectorQuery(sql: string): boolean {
  return /<->|<=>|<#>|vector/i.test(sql);
}

function classifyPgOperation(sql: string): "query" | "upsert" | "delete" {
  const normalized = sql.trim().toUpperCase();
  if (normalized.startsWith("INSERT")) return "upsert";
  if (normalized.startsWith("DELETE")) return "delete";
  return "query";
}

function extractTableName(sql: string): string | null {
  const match = sql.match(/(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_."]+)/i);
  return match ? match[1] : null;
}

export function instrumentPgVectorClient<T extends PgVectorClientLike>(
  client: T,
  ctx: InstrumentationContext,
): T {
  const original = client.query.bind(client);
  (client as any).query = async (text: any, params?: any) => {
    const sql = typeof text === "string" ? text : text?.text ?? "";
    const { result, latencyMs } = await timeAsync<PgVectorResult>(() => original(text, params));
    if (!isPgVectorQuery(sql)) return result;
    const rows = result?.rows ?? [];
    emitVectorOpEvent(ctx, "pgvector", {
      operation: classifyPgOperation(sql),
      collection: extractTableName(sql),
      result_count: Array.isArray(rows) ? rows.length : null,
      similarity_scores: extractNumericField(rows, ["distance", "similarity", "score"]),
      latency_ms: latencyMs,
    });
    return result;
  };
  return client;
}
