import pg from "pg";
import { sslConfigFor } from "./pgSsl";

const { Pool } = pg;

let pool: pg.Pool | undefined;

/** One shared pool per process — Next.js API routes/Server Components/Actions all import this rather than each opening their own. */
export function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set (see .env.example)");
    }
    pool = new Pool({ connectionString: databaseUrl, ssl: sslConfigFor(databaseUrl) });
  }
  return pool;
}
