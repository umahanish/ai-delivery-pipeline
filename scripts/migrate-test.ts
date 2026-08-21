// Applies the same migrations to TEST_DATABASE_URL — a separate database
// from DATABASE_URL, specifically so `npm test`'s resetDb() (which
// TRUNCATEs backlog_items/pipeline_events between tests) can never touch
// real dev/demo data again. See docs/DECISIONS.md for the incident this
// fixes: an `npm test` run silently wiped a real, in-flight backlog item.
//
// Usage: npm run migrate:test

import "dotenv/config";
import { runMigrations } from "./migrate";

async function main(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  }
  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL — tests truncate tables on every run.");
  }
  await runMigrations(databaseUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
