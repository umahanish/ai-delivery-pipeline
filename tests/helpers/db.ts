// Shared helper for tests that need a real Postgres — same pattern as the
// sibling devops-knowledge-mcp project's tests/helpers/db.ts. Requires
// `docker compose up -d postgres && npm run migrate` first.

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getTestPool(): pg.Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set — tests under tests/db/ and tests/lib/ need a running Postgres. " +
          "Run `docker compose up -d postgres && npm run migrate` and copy .env.example to .env first.",
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE pipeline_events, backlog_items RESTART IDENTITY CASCADE`);
}
