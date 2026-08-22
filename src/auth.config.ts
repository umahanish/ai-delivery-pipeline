// Split from auth.ts specifically for src/middleware.ts, which Next.js
// runs in the Edge Runtime by default -- Edge can't use Node's `crypto`
// module, which `pg` needs for its SASL auth handshake. auth.ts's
// signIn/jwt callbacks look up a role in Postgres, so anything that
// imports auth.ts (even transitively) drags `pg` into whatever bundle
// it's in. Middleware only ever needs to check "is there a valid,
// already-signed JWT on this request" -- it doesn't need to touch the
// database at all, since the role was already looked up once at sign-in
// time and is carried inside the token from then on. Keeping this file
// free of any `pg`-reaching import is what makes that split real, not
// just cosmetic -- see docs/DECISIONS.md for the live error this fixed.
import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/signin" },
};
