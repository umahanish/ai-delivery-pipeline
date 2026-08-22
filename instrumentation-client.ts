// Sentry for the browser bundle (Phase 9) -- Next.js auto-loads this file
// client-side, no explicit import needed. Uses NEXT_PUBLIC_SENTRY_DSN
// (baked into the client bundle at build time), not SENTRY_DSN, which
// stays server-only.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
});
