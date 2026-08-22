// Sentry for the Edge runtime (src/middleware.ts). A separate init from
// sentry.server.config.ts because the Edge runtime can't load the Node.js
// SDK internals the server config pulls in -- same Edge/Node split that
// forced auth.config.ts apart from auth.ts in Phase 8, see
// docs/DECISIONS.md.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.1,
});
