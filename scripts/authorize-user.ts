// `npm run authorize-user -- <github-login> <maintainer|viewer>` -- the
// admin tool for Phase 8's RBAC allowlist. There's no admin UI for this
// yet (out of scope for this pass); a GitHub login not added here can
// never sign in at all, regardless of whether they have a valid GitHub
// account -- that's the point (see docs/SECURITY.md).

import "dotenv/config";
import pg from "pg";
import { upsertAuthorizedUser } from "../src/db/authorizedUsers.js";
import { sslConfigFor } from "../src/db/pgSsl.js";

async function main(): Promise<void> {
  const [githubLogin, role] = process.argv.slice(2);
  if (!githubLogin || (role !== "maintainer" && role !== "viewer")) {
    throw new Error("usage: npm run authorize-user -- <github-login> <maintainer|viewer>");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: sslConfigFor(databaseUrl) });
  try {
    const user = await upsertAuthorizedUser(pool, githubLogin, role, "cli");
    console.log(`${user.githubLogin} -> ${user.role}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
