"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { markReadyForDev } from "../db/backlogItems";
import { getPool } from "../db/pool";
import { createJiraClientFromEnv } from "../jira/fromEnv";
import { createBacklogItem } from "../lib/createBacklogItem";

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
  const updated = await markReadyForDev(getPool(), id);
  if (!updated) {
    throw new Error("Couldn't mark this item ready — it may not have a JIRA story yet, or has already moved past this stage.");
  }
  revalidatePath("/");
}
