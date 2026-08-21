// Data access for backlog_items / pipeline_events. Every function takes a
// pg.Pool explicitly rather than importing the singleton from pool.ts
// directly — same dependency-injection shape as the sibling project's
// src/db/persist.ts, and what lets tests point these at a test pool.

import type pg from "pg";

export type Priority = "low" | "medium" | "high" | "critical";

export type BacklogItemStatus =
  | "submitted"
  | "jira_failed"
  | "ready_for_dev"
  | "in_dev"
  | "pr_open"
  | "needs_human"
  | "merged"
  | "deployed"
  | "failed";

export type PrReviewStatus = "pending" | "approved" | "changes_requested";
export type CiStatus = "pending" | "passing" | "failing";

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string | null;
  priority: Priority;
  targetRepo: string;
  status: BacklogItemStatus;
  jiraKey: string | null;
  jiraUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  deployStatus: "pending" | "deployed" | "failed" | null;
  prReviewStatus: PrReviewStatus | null;
  ciStatus: CiStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewBacklogItemInput {
  title: string;
  description: string;
  acceptanceCriteria?: string;
  priority: Priority;
  targetRepo: string;
}

interface BacklogItemRow {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: Priority;
  target_repo: string;
  status: BacklogItemStatus;
  jira_key: string | null;
  jira_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  deploy_status: "pending" | "deployed" | "failed" | null;
  pr_review_status: PrReviewStatus | null;
  ci_status: CiStatus | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: BacklogItemRow): BacklogItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: row.acceptance_criteria,
    priority: row.priority,
    targetRepo: row.target_repo,
    status: row.status,
    jiraKey: row.jira_key,
    jiraUrl: row.jira_url,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    deployStatus: row.deploy_status,
    prReviewStatus: row.pr_review_status,
    ciStatus: row.ci_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function insertBacklogItem(pool: pg.Pool, input: NewBacklogItemInput): Promise<BacklogItem> {
  const { rows } = await pool.query<BacklogItemRow>(
    `INSERT INTO backlog_items (title, description, acceptance_criteria, priority, target_repo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.title, input.description, input.acceptanceCriteria ?? null, input.priority, input.targetRepo],
  );
  const row = rows[0];
  if (!row) throw new Error("insertBacklogItem: INSERT ... RETURNING * returned no row");
  return mapRow(row);
}

export async function markJiraCreated(pool: pg.Pool, id: string, jiraKey: string, jiraUrl: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET jira_key = $1, jira_url = $2, updated_at = now() WHERE id = $3`, [
    jiraKey,
    jiraUrl,
    id,
  ]);
}

export async function markJiraFailed(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET status = 'jira_failed', updated_at = now() WHERE id = $1`, [id]);
}

/**
 * Only transitions submitted -> ready_for_dev, and only when a JIRA story
 * actually exists — returns null (not a thrown error) if the row wasn't in
 * a state this transition applies to, so the caller can show a clear
 * "can't do that right now" instead of a generic 500.
 */
export async function markReadyForDev(pool: pg.Pool, id: string): Promise<BacklogItem | null> {
  const { rows } = await pool.query<BacklogItemRow>(
    `UPDATE backlog_items SET status = 'ready_for_dev', updated_at = now()
     WHERE id = $1 AND status = 'submitted' AND jira_key IS NOT NULL
     RETURNING *`,
    [id],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listBacklogItems(pool: pg.Pool): Promise<BacklogItem[]> {
  const { rows } = await pool.query<BacklogItemRow>(`SELECT * FROM backlog_items ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

/** What Phase 4's orchestrator polls for — items a PM explicitly marked ready and nothing has picked up yet. */
export async function listReadyForDev(pool: pg.Pool): Promise<BacklogItem[]> {
  const { rows } = await pool.query<BacklogItemRow>(
    `SELECT * FROM backlog_items WHERE status = 'ready_for_dev' ORDER BY created_at ASC`,
  );
  return rows.map(mapRow);
}

/**
 * Only transitions ready_for_dev -> in_dev, atomically (the UPDATE's WHERE
 * clause is the compare-and-swap) — returns null if another orchestrator
 * run already claimed this item, so two runs can never both start working
 * on the same story.
 */
export async function claimForDev(pool: pg.Pool, id: string): Promise<BacklogItem | null> {
  const { rows } = await pool.query<BacklogItemRow>(
    `UPDATE backlog_items SET status = 'in_dev', updated_at = now()
     WHERE id = $1 AND status = 'ready_for_dev'
     RETURNING *`,
    [id],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function markPrOpen(pool: pg.Pool, id: string, prNumber: number, prUrl: string): Promise<void> {
  await pool.query(
    `UPDATE backlog_items SET status = 'pr_open', pr_number = $1, pr_url = $2, updated_at = now() WHERE id = $3`,
    [prNumber, prUrl, id],
  );
}

/**
 * Phase 7: PR review/CI status, polled and written by the same
 * reconciliation pass that checks for a merge (see
 * src/orchestrator/deployStatus.ts). Only actually writes (and returns
 * true) when a value changed, so a repeated poll that finds nothing new
 * doesn't touch updated_at or need a pipeline_events entry every run.
 */
export async function updatePrStatus(
  pool: pg.Pool,
  id: string,
  prReviewStatus: PrReviewStatus,
  ciStatus: CiStatus,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE backlog_items SET pr_review_status = $1, ci_status = $2, updated_at = now()
     WHERE id = $3 AND (pr_review_status IS DISTINCT FROM $1 OR ci_status IS DISTINCT FROM $2)`,
    [prReviewStatus, ciStatus, id],
  );
  return (rowCount ?? 0) > 0;
}

/** What Phase 6's reconciliation script polls to find PRs it should check for a merge. */
export async function listPrOpen(pool: pg.Pool): Promise<BacklogItem[]> {
  const { rows } = await pool.query<BacklogItemRow>(`SELECT * FROM backlog_items WHERE status = 'pr_open' ORDER BY created_at ASC`);
  return rows.map(mapRow);
}

/** What Phase 6's reconciliation script polls to find merged items still awaiting a deploy result. */
export async function listMerged(pool: pg.Pool): Promise<BacklogItem[]> {
  const { rows } = await pool.query<BacklogItemRow>(`SELECT * FROM backlog_items WHERE status = 'merged' ORDER BY created_at ASC`);
  return rows.map(mapRow);
}

/** A human merged the PR (detected, not caused, by this codebase — see Constraints: nothing here ever merges). deploy_status starts 'pending' since Phase 6's deploy workflow hasn't necessarily run yet. */
export async function markMerged(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET status = 'merged', deploy_status = 'pending', updated_at = now() WHERE id = $1`, [id]);
}

export async function markDeployed(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET status = 'deployed', deploy_status = 'deployed', updated_at = now() WHERE id = $1`, [id]);
}

export async function markDeployFailed(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET status = 'failed', deploy_status = 'failed', updated_at = now() WHERE id = $1`, [id]);
}

/** The agent exhausted its retry budget without converging — see CLAUDE.md Constraints. Never left silently stuck in 'in_dev'. */
export async function markNeedsHuman(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`UPDATE backlog_items SET status = 'needs_human', updated_at = now() WHERE id = $1`, [id]);
}

export async function getBacklogItem(pool: pg.Pool, id: string): Promise<BacklogItem | null> {
  const { rows } = await pool.query<BacklogItemRow>(`SELECT * FROM backlog_items WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function logPipelineEvent(pool: pg.Pool, backlogItemId: string, eventType: string, detail?: string): Promise<void> {
  await pool.query(`INSERT INTO pipeline_events (backlog_item_id, event_type, detail) VALUES ($1, $2, $3)`, [
    backlogItemId,
    eventType,
    detail ?? null,
  ]);
}
