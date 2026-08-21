// The single entry point for turning a PM's form submission into both a
// backlog_items row and a JIRA story. Used by both the API route
// (src/app/api/backlog-items/route.ts) and the UI's server action
// (src/app/new/actions.ts), so this logic lives in exactly one place.

import type pg from "pg";
import { insertBacklogItem, logPipelineEvent, markJiraCreated, markJiraFailed, type BacklogItem, type NewBacklogItemInput } from "../db/backlogItems";
import { JiraApiError, type JiraIssueCreator } from "../jira/client";

export interface CreateBacklogItemDeps {
  pool: pg.Pool;
  /**
   * A factory, not a pre-built client — constructing a JiraClient can
   * itself throw (e.g. missing env vars via createJiraClientFromEnv()).
   * If that construction happened at the call site instead, it would
   * throw *before* insertBacklogItem ever ran, silently breaking the "the
   * PM's submission is never lost" guarantee this function exists to
   * provide. Calling the factory inside the try block below means a
   * missing-config failure is handled exactly like an unreachable-JIRA
   * failure: the row is already saved by the time it happens.
   */
  getJira: () => JiraIssueCreator;
}

function buildJiraDescription(input: NewBacklogItemInput): string {
  const parts = [input.description];
  if (input.acceptanceCriteria?.trim()) {
    parts.push(`Acceptance criteria:\n${input.acceptanceCriteria.trim()}`);
  }
  parts.push(`Target repo: ${input.targetRepo}`);
  return parts.join("\n\n");
}

/**
 * Never throws on a JIRA failure — the row is always saved first (the
 * PM's input is never lost even if JIRA is unreachable), and a JIRA
 * failure just leaves the item in `jira_failed` status with the error
 * logged to pipeline_events, visible in the UI rather than swallowed.
 */
export async function createBacklogItem(deps: CreateBacklogItemDeps, input: NewBacklogItemInput): Promise<BacklogItem> {
  const item = await insertBacklogItem(deps.pool, input);

  try {
    const issue = await deps.getJira().createIssue({
      summary: input.title,
      description: buildJiraDescription(input),
    });
    await markJiraCreated(deps.pool, item.id, issue.key, issue.url);
    await logPipelineEvent(deps.pool, item.id, "jira_story_created", issue.key);
    return { ...item, jiraKey: issue.key, jiraUrl: issue.url };
  } catch (err) {
    const message =
      err instanceof JiraApiError ? `${err.message} (status ${err.status})` : err instanceof Error ? err.message : String(err);
    await markJiraFailed(deps.pool, item.id);
    await logPipelineEvent(deps.pool, item.id, "jira_create_failed", message);
    return { ...item, status: "jira_failed" };
  }
}
