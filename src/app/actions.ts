"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../auth";
import { markReadyForDev } from "../db/backlogItems";
import { getPool } from "../db/pool";
import { createJiraClientFromEnv } from "../jira/fromEnv";
import { createBacklogItem } from "../lib/createBacklogItem";
import { logger } from "../lib/logger";
import { checkRateLimit } from "../lib/rateLimit";

/**
 * Defense in depth (Phase 8): middleware already blocks unauthenticated
 * requests, but Server Actions can in principle be invoked directly, not
 * only through a page middleware protected -- so every mutating action
 * checks role again here, server-side, not just via a hidden UI button.
 * Also enforces per-user rate limiting here, keyed by GitHub login
 * (meaningful since every caller is already authenticated by this
 * point -- no need to fall back to IP-based keying).
 */
async function requireMaintainer(): Promise<string> {
  const session = await auth();
  if (session?.user.role !== "maintainer") {
    throw new Error("Only a maintainer can do this — your account is read-only (or not signed in).");
  }
  const login = session.user.githubLogin ?? "unknown";
  const { allowed } = checkRateLimit(`action:${login}`, 20, 10 * 60 * 1000);
  if (!allowed) {
    logger.warn("rate_limited", { githubLogin: login, surface: "action" });
    throw new Error("Too many actions too quickly — wait a few minutes and try again.");
  }
  return login;
}

const NewBacklogItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  acceptanceCriteria: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  targetRepo: z.string().min(1, "Target repo is required"),
});

export interface SubmitBacklogItemState {
  error?: string;
}

/** Bound to the /new form via useActionState — parses+validates, then either returns a field error or redirects to the list on success. */
export async function submitBacklogItemAction(
  _prevState: SubmitBacklogItemState,
  formData: FormData,
): Promise<SubmitBacklogItemState> {
  try {
    await requireMaintainer();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not authorized" };
  }

  const parsed = NewBacklogItemSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    acceptanceCriteria: formData.get("acceptanceCriteria") || undefined,
    priority: formData.get("priority"),
    targetRepo: formData.get("targetRepo"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let itemId: string;
  try {
    const item = await createBacklogItem({ pool: getPool(), getJira: createJiraClientFromEnv }, parsed.data);
    itemId = item.id;
  } catch (err) {
    // createBacklogItem itself never throws on a JIRA failure, including
    // missing config (see its own docstring) — reaching here means
    // something more fundamental broke, most likely the DB.
    return { error: err instanceof Error ? err.message : "Failed to submit backlog item" };
  }

  revalidatePath("/");
  redirect(`/?created=${itemId}`);
}

/** Bound per-row on the list page: <form action={markReadyAction.bind(null, item.id)}>. */
export async function markReadyAction(id: string): Promise<void> {
  await requireMaintainer();
  const updated = await markReadyForDev(getPool(), id);
  if (!updated) {
    throw new Error("Couldn't mark this item ready — it may not have a JIRA story yet, or has already moved past this stage.");
  }
  revalidatePath("/");
}
