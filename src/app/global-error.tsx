"use client";

// Next.js's global-error boundary -- the only place a render error in the
// root layout itself can be caught. Reports to Sentry (Phase 9) and shows
// a plain fallback; it has to render its own <html>/<body> since it
// replaces the root layout when it activates.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 20px", fontFamily: "sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>The error has been reported. Try reloading the page.</p>
        </main>
      </body>
    </html>
  );
}
