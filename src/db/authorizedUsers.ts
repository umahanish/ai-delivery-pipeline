// Zero Trust RBAC allowlist -- a GitHub login must exist here before
// NextAuth's signIn callback (see src/auth.ts) will let it create a
// session. Deliberately not tied to backlog_items.ts's pool-per-call
// convention with the app pool alone -- also used by scripts/authorize-user.ts.

import type pg from "pg";

export type Role = "maintainer" | "viewer";

export interface AuthorizedUser {
  githubLogin: string;
  role: Role;
  addedBy: string | null;
  createdAt: string;
}

interface AuthorizedUserRow {
  github_login: string;
  role: Role;
  added_by: string | null;
  created_at: Date;
}

function mapRow(row: AuthorizedUserRow): AuthorizedUser {
  return {
    githubLogin: row.github_login,
    role: row.role,
    addedBy: row.added_by,
    createdAt: row.created_at.toISOString(),
  };
}

/** Case-sensitive on the stored value, but GitHub logins are case-insensitive -- callers should lowercase before calling, same as GitHub itself treats them. */
export async function getUserRole(pool: pg.Pool, githubLogin: string): Promise<Role | null> {
  const { rows } = await pool.query<{ role: Role }>(`SELECT role FROM authorized_users WHERE github_login = $1`, [
    githubLogin.toLowerCase(),
  ]);
  return rows[0]?.role ?? null;
}

export async function listAuthorizedUsers(pool: pg.Pool): Promise<AuthorizedUser[]> {
  const { rows } = await pool.query<AuthorizedUserRow>(`SELECT * FROM authorized_users ORDER BY created_at ASC`);
  return rows.map(mapRow);
}

/** Upsert so re-running with a new role changes it rather than erroring. */
export async function upsertAuthorizedUser(
  pool: pg.Pool,
  githubLogin: string,
  role: Role,
  addedBy: string | null,
): Promise<AuthorizedUser> {
  const { rows } = await pool.query<AuthorizedUserRow>(
    `INSERT INTO authorized_users (github_login, role, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (github_login) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [githubLogin.toLowerCase(), role, addedBy],
  );
  const row = rows[0];
  if (!row) throw new Error("upsertAuthorizedUser: INSERT ... RETURNING * returned no row");
  return mapRow(row);
}

export async function removeAuthorizedUser(pool: pg.Pool, githubLogin: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM authorized_users WHERE github_login = $1`, [
    githubLogin.toLowerCase(),
  ]);
  return (rowCount ?? 0) > 0;
}
