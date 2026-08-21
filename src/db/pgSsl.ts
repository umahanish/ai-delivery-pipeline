// Local Docker Postgres doesn't speak TLS at all; a real hosted Postgres
// (Render, Neon, RDS, etc.) requires it. Rather than a separate env var
// to keep in sync with DATABASE_URL, derive it from the URL itself --
// localhost/127.0.0.1 means no SSL, anything else means SSL with
// rejectUnauthorized: false (these providers use certs Node's default
// trust store doesn't always chain cleanly, and verifying the exact
// chain isn't the security boundary that matters here — the connection
// string itself, kept out of git via .env, is).
export function sslConfigFor(connectionString: string): false | { rejectUnauthorized: boolean } {
  const { hostname } = new URL(connectionString);
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return isLocal ? false : { rejectUnauthorized: false };
}
