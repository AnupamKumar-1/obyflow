export function parseSince(since: string | undefined): string | undefined {
  if (!since) return undefined;
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] as "m" | "h" | "d";
  const msPerUnit: Record<"m" | "h" | "d", number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return new Date(Date.now() - amount * msPerUnit[unit]).toISOString();
}