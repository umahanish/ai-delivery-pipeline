-- Migration 0003: Phase 8 -- Zero Trust RBAC allowlist.
--
-- No open self-signup: a GitHub login that isn't in this table is
-- refused at NextAuth's signIn callback, before a session is ever
-- created (see src/auth.ts). Seeded via `npm run authorize-user`, not
-- hardcoded here -- a migration shouldn't bake in a specific person's
-- username.

CREATE TABLE authorized_users (
    github_login  text PRIMARY KEY,
    role          text NOT NULL CHECK (role IN ('maintainer', 'viewer')),
    added_by      text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
