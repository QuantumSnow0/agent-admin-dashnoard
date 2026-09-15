/**
 * In-memory sliding-window rate limiter keyed by instance + actor.
 * Default: 30 tool calls per minute (configurable via AppConfig).
 *
 * Scheduled jobs / ai_service: bind a dedicated instance with its own
 * WAM_AI_RATE_LIMIT_PER_MINUTE; do not share a human Gateway instance.
 */

type WindowEntry = {
  timestamps: number[];
};

const windows = new Map<string, WindowEntry>();

export function rateLimitKey(instanceId: string | null, actorId: string): string {
  return `${instanceId ?? "no-instance"}::${actorId}`;
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };

/**
 * Check (and record) a tool-call attempt under the sliding window.
 * Returns denied when the limit would be exceeded; does not record on deny.
 */
export function checkRateLimit(
  key: string,
  limitPerMinute: number,
  nowMs: number = Date.now(),
): RateLimitResult {
  const windowMs = 60_000;
  const entry = windows.get(key) ?? { timestamps: [] };
  const cutoff = nowMs - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limitPerMinute) {
    const oldest = entry.timestamps[0] ?? nowMs;
    windows.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1, oldest + windowMs - nowMs),
    };
  }

  entry.timestamps.push(nowMs);
  windows.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, limitPerMinute - entry.timestamps.length),
  };
}

/** Test helper — clear all windows. */
export function resetRateLimitState(): void {
  windows.clear();
}
