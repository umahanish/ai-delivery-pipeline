// Next.js's instrumentation hook (stable since Next 15, runs once per
// server/edge process before any route handles a request) -- the one
// place allowed to import runtime-specific Sentry config conditionally,
// since this file itself runs in both the Node.js and Edge runtimes.
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown inside Server Components / Route Handlers that
// Next itself catches before they'd otherwise reach a try/catch here.
export const onRequestError = Sentry.captureRequestError;
