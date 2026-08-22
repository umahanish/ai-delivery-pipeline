// Phase 8 transport/request hardening. In-memory, single-process --
// correct for how this demo actually runs (one Next.js process, local
// dev or a single Render instance), explicitly *not* what a
// multi-instance production deployment should use. A real multi-instance
// deployment needs a shared store (Redis/Upstash) so limits are
// enforced across instances, not per-instance; swapping the Map below
// for a shared store is the only change that would take, since callers
// only depend on checkRateLimit's return shape. See docs/SECURITY.md.

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/** Sliding-window-ish fixed-window limiter: `limit` requests per `windowMs` per key. */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count };
}

/** Test-only: without this, tests run in the same process and share bucket state across unrelated test cases. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
