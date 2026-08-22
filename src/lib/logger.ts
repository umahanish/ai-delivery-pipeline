// Structured audit logging (Phase 9). pipeline_events already writes one
// row per state transition — this is the same events, also emitted as one
// JSON object per line to stdout, so they're grep/jq-able and ship
// cleanly to any log aggregator (Render's own log stream, Datadog, etc.)
// without a DB round-trip to reconstruct what happened. correlationId is
// the backlog item id whenever there is one, so every stage for a given
// story — across the Next.js app and the orchestrator/sync scripts —
// filters to a single thread.

export interface LogFields {
  correlationId?: string;
  [key: string]: unknown;
}

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
