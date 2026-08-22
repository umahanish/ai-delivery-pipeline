// Sentry error tracking (Phase 9) for the Next.js app's server runtime
// (Server Components, Server Actions, Route Handlers). Loaded by
// instrumentation.ts's register(), never imported directly. `enabled:
// false` when SENTRY_DSN isn't set — dev/CI never has one, and the app
// must still build and run without it (see docs/DECISIONS.md's CI env
// var minimalism note).
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.1,
});
