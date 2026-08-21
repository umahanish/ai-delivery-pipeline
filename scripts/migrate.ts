// Minimal migration runner — same ~50-line pattern as the sibling
// devops-knowledge-mcp project's scripts/migrate.ts, not re-imported
// across repos (see CLAUDE.md) but deliberately kept identical in shape.
//
// Usage: npm run migrate

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map(
        (row) => row.filename,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`Applying ${file}...`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      ranCount++;
    }

    console.log(ranCount > 0 ? `Applied ${ranCount} migration(s).` : "Already up to date.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
