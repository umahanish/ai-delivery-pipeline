import type { DefaultSession } from "next-auth";
import type { Role } from "../db/authorizedUsers";

declare module "next-auth" {
  interface Session {
    user: {
      githubLogin?: string;
      role: Role | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    githubLogin?: string;
    role?: Role | null;
  }
}
