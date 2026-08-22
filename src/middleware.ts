// Phase 8: Zero Trust means every request is checked, not just ones that
// "look" sensitive -- this middleware is the single enforcement point for
// every route in the app. Server Actions and the REST API additionally
// check role server-side (src/app/actions.ts, src/app/api/backlog-items/route.ts)
// as defense in depth -- middleware alone would be enough for routing,
// but Server Actions can in principle be invoked directly, not only
// through a page this middleware protected.
//
// Built from auth.config.ts, NOT auth.ts -- middleware runs in the Edge
// Runtime, which can't load `pg` (Node-only `crypto` module). auth.ts's
// role lookup only needs to run once, at sign-in, in a Node.js runtime
// context; middleware only ever needs to check the already-signed JWT
// already on the request. See docs/DECISIONS.md.

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (req.auth) return NextResponse.next();

  // API callers (README documents this route "for external/scripted
  // use") want a 401 they can branch on, not a 302 into an HTML page.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const signInUrl = new URL("/signin", req.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  // Everything except NextAuth's own API routes, the sign-in page itself
  // (or this would redirect-loop), and Next's static/internal assets.
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)"],
};
