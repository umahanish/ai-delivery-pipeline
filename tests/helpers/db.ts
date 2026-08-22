// Shared helper for tests that need a real Postgres — same pattern as the
// sibling devops-knowledge-mcp project's tests/helpers/db.ts. Requires
// `docker compose up -d postgres && npm run migrate:test` first.
//
// Deliberately points at TEST_DATABASE_URL, not DATABASE_URL: resetDb()
// below TRUNCATEs backlog_items/pipeline_events before every test, and an
// earlier version of this file pointed at DATABASE_URL directly — a real
// `npm test` run silently wiped a real, in-flight backlog item along with
// its history. See docs/DECISIONS.md.

import "dotenv/config";
import pg from "pg";
import { sslConfigFor } from "../../src/db/pgSsl";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getTestPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL is not set — tests under tests/db/, tests/lib/, and tests/orchestrator/ need a " +
          "dedicated test Postgres database (never the dev one, since tests TRUNCATE it). " +
          "Run `docker compose up -d postgres && npm run migrate:test` and copy .env.example to .env first.",
      );
    }
    if (databaseUrl === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — tests TRUNCATE tables on every run and would wipe real data.",
      );
    }
    pool = new Pool({ connectionString: databaseUrl, ssl: sslConfigFor(databaseUrl) });
  }
  return pool;
}

export async function resetDb(pool: pg.Pool): Promise<void> {
  // authorized_users has no FK relationship to the other two -- listed
  // explicitly rather than relying on CASCADE to reach it, so a table
  // added later (as this one was) doesn't silently stay untruncated the
  // way this one initially did. See docs/DECISIONS.md.
  await pool.query(`TRUNCATE pipeline_events, backlog_items, authorized_users RESTART IDENTITY CASCADE`);
}
