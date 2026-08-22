// Sentry for the orchestrator/sync Node scripts (Phase 9) — separate from
// the Next.js app's instrumentation.ts/sentry.*.config.ts, which only run
// inside `next dev`/`next build`, never under `tsx scripts/*.ts`. Scripts
// are short-lived processes, not a long-running server, so callers must
// explicitly `await Sentry.close()` before `process.exit()` or a captured
// exception can be dropped before it's sent — see scripts/run-orchestrator.ts
// and scripts/sync-deploy-status.ts.

import * as Sentry from "@sentry/node";

let initialized = false;

/** No-ops (rather than throwing) when SENTRY_DSN isn't set — dev/CI never has one, and that must never be what breaks a pipeline run. */
export function initSentryForScript(): void {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  Sentry.init({ dsn, enabled: Boolean(dsn), tracesSampleRate: 0 });
}

export { Sentry };
