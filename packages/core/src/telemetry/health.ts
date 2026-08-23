import { Event } from "../event-model/event.schema.js";
import { TimeWindow } from "../correlation/join-keys.js";

export interface TelemetryFailure {
  id: string;
  timestamp: string;
  service: string | null;
  operation: string;
  reason: string;
}

export interface TelemetryGap {
  service: string;
  start: string;
  end: string;
  duration_ms: number;
}

export interface TelemetryHealthReport {
  dropped_event_count: number;
  recent_failures: TelemetryFailure[];
  gaps: TelemetryGap[];
}

export interface DetectTelemetryGapsOptions {
  minGapMs?: number;
}

const DEFAULT_MIN_GAP_MS = 30000;

function clampToWindow(timestampMs: number, windowStartMs: number, windowEndMs: number): number {
  if (timestampMs < windowStartMs) return windowStartMs;
  if (timestampMs > windowEndMs) return windowEndMs;
  return timestampMs;
}

export function detectTelemetryGaps(
  events: Event[],
  window: TimeWindow,
  options: DetectTelemetryGapsOptions = {},
): TelemetryGap[] {
  const minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
  const windowStartMs = new Date(window.start).getTime();
  const windowEndMs = new Date(window.end).getTime();

  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return [];
  }

  const byService = new Map<string, Event[]>();
  for (const event of events) {
    const list = byService.get(event.service) ?? [];
    list.push(event);
    byService.set(event.service, list);
  }

  const gaps: TelemetryGap[] = [];

  for (const [service, serviceEvents] of byService) {
    const sorted = serviceEvents
      .map((e) => clampToWindow(new Date(e.timestamp).getTime(), windowStartMs, windowEndMs))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);

    if (sorted.length === 0) continue;

    const boundaries = [windowStartMs, ...sorted, windowEndMs];
    for (let i = 1; i < boundaries.length; i++) {
      const prev = boundaries[i - 1];
      const next = boundaries[i];
      const duration = next - prev;
      if (duration >= minGapMs) {
        gaps.push({
          service,
          start: new Date(prev).toISOString(),
          end: new Date(next).toISOString(),
          duration_ms: duration,
        });
      }
    }
  }

  gaps.sort((a, b) => b.duration_ms - a.duration_ms);
  return gaps;
}
