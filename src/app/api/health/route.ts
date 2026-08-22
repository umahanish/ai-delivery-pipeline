// Unauthenticated health check (Phase 9) -- deliberately excluded from
// src/middleware.ts's auth gate (see that file's matcher) since an
// external uptime monitor has no session cookie to present. Checks real
// DB connectivity rather than just returning 200 unconditionally --
// "the process is running" and "the app actually works" are different
// facts, and only the second one is worth alerting on.

import { NextResponse } from "next/server";
import { getPool } from "../../../db/pool";

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json({ status: "error", error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
