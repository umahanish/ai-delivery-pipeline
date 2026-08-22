// Phase 8: Zero Trust auth. GitHub OAuth as the identity provider rather
// than a hand-rolled password store -- "don't roll your own auth" is
// itself a Zero Trust principle, and GitHub is already this project's
// central identity anyway (it's who opens every PR).
//
// No open self-signup: signIn() below refuses anyone not already in the
// authorized_users allowlist (see src/db/authorizedUsers.ts and
// scripts/authorize-user.ts) -- a valid GitHub account is necessary but
// not sufficient. JWT session strategy (no NextAuth database adapter);
// role is looked up from Postgres once at sign-in and carried in the
// token from then on -- src/middleware.ts uses a separate, DB-free
// config (auth.config.ts) precisely so it never needs to repeat that
// lookup on every request from the Edge Runtime.

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { authConfig } from "./auth.config";
import { getUserRole } from "./db/authorizedUsers";
import { getPool } from "./db/pool";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      const login = typeof profile?.login === "string" ? profile.login : undefined;
      if (!login) return false;
      const role = await getUserRole(getPool(), login);
      return role !== null;
    },
    async jwt({ token, profile }) {
      if (profile) {
        const login = typeof profile.login === "string" ? profile.login : undefined;
        if (login) {
          token.githubLogin = login;
          token.role = await getUserRole(getPool(), login);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.githubLogin = typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      session.user.role = token.role === "maintainer" || token.role === "viewer" ? token.role : null;
      return session;
    },
  },
});
