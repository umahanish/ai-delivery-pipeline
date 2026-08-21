// REST surface for backlog items — the UI's own form uses the server
// action in src/app/actions.ts directly (no HTTP round-trip needed for
// same-app usage), but this route exists for external/future callers
// (e.g. a script, or Phase 4's orchestrator if it ever needs HTTP access
// instead of querying Postgres directly).

import { NextResponse } from "next/server";
import { z } from "zod";
import { listBacklogItems } from "../../../db/backlogItems";
import { getPool } from "../../../db/pool";
import { createJiraClientFromEnv } from "../../../jira/fromEnv";
import { createBacklogItem } from "../../../lib/createBacklogItem";

const NewBacklogItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  targetRepo: z.string().min(1),
});

export async function GET(): Promise<NextResponse> {
  const items = await listBacklogItems(getPool());
  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = NewBacklogItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const item = await createBacklogItem({ pool: getPool(), getJira: createJiraClientFromEnv }, parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    // createBacklogItem never throws on a JIRA failure, including missing
    // config — reaching here means something more fundamental broke,
    // most likely the DB.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create backlog item" }, { status: 500 });
  }
}
