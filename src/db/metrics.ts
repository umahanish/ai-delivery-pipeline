// Aggregate metrics for the dashboard (Phase 9) -- everything here reads
// from backlog_items/pipeline_events, the same audit trail the rest of the
// app already writes to; there's no separate metrics store.

import type pg from "pg";

export interface PipelineMetrics {
  totalSubmitted: number;
  byStatus: Record<string, number>;
  needsHumanCount: number;
  /** Hours between the orchestrator claiming an item (dev_started) and it opening a PR (pr_opened), averaged across items that reached pr_opened. Null if none have yet. */
  avgTimeToPrHours: number | null;
  /** passing / (passing + failing), ignoring items whose CI has never reported (ci_status IS NULL) or is still pending. Null if no item has a resolved CI status yet. */
  ciPassRate: number | null;
  /** deployed / (deployed + failed), ignoring items that haven't reached a deploy attempt yet. Null if none have. */
  deploySuccessRate: number | null;
}

export interface RecentEvent {
  backlogItemId: string;
  title: string;
  jiraKey: string | null;
  eventType: string;
  detail: string | null;
  occurredAt: string;
}

function toRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export async function getPipelineMetrics(pool: pg.Pool): Promise<PipelineMetrics> {
  const [statusResult, timeToPrResult, ciResult, deployResult] = await Promise.all([
    pool.query<{ status: string; count: string }>(`SELECT status, count(*)::text AS count FROM backlog_items GROUP BY status`),
    pool.query<{ avg_hours: string | null }>(`
      SELECT avg(extract(epoch FROM (pr.occurred_at - dev.occurred_at)) / 3600.0)::text AS avg_hours
      FROM pipeline_events dev
      JOIN pipeline_events pr
        ON pr.backlog_item_id = dev.backlog_item_id AND pr.event_type = 'pr_opened'
      WHERE dev.event_type = 'dev_started'
    `),
    pool.query<{ ci_status: string; count: string }>(
      `SELECT ci_status, count(*)::text AS count FROM backlog_items WHERE ci_status IN ('passing', 'failing') GROUP BY ci_status`,
    ),
    pool.query<{ deploy_status: string; count: string }>(
      `SELECT deploy_status, count(*)::text AS count FROM backlog_items WHERE deploy_status IN ('deployed', 'failed') GROUP BY deploy_status`,
    ),
  ]);

  const byStatus: Record<string, number> = {};
  let totalSubmitted = 0;
  for (const row of statusResult.rows) {
    byStatus[row.status] = Number(row.count);
    totalSubmitted += Number(row.count);
  }

  const ciCounts = Object.fromEntries(ciResult.rows.map((r) => [r.ci_status, Number(r.count)]));
  const deployCounts = Object.fromEntries(deployResult.rows.map((r) => [r.deploy_status, Number(r.count)]));

  return {
    totalSubmitted,
    byStatus,
    needsHumanCount: byStatus["needs_human"] ?? 0,
    avgTimeToPrHours: timeToPrResult.rows[0]?.avg_hours ? Number(timeToPrResult.rows[0].avg_hours) : null,
    ciPassRate: toRate(ciCounts["passing"] ?? 0, (ciCounts["passing"] ?? 0) + (ciCounts["failing"] ?? 0)),
    deploySuccessRate: toRate(deployCounts["deployed"] ?? 0, (deployCounts["deployed"] ?? 0) + (deployCounts["failed"] ?? 0)),
  };
}

export async function listRecentEvents(pool: pg.Pool, limit: number): Promise<RecentEvent[]> {
  const { rows } = await pool.query<{
    backlog_item_id: string;
    title: string;
    jira_key: string | null;
    event_type: string;
    detail: string | null;
    occurred_at: Date;
  }>(
    `SELECT pe.backlog_item_id, bi.title, bi.jira_key, pe.event_type, pe.detail, pe.occurred_at
     FROM pipeline_events pe
     JOIN backlog_items bi ON bi.id = pe.backlog_item_id
     ORDER BY pe.occurred_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    backlogItemId: row.backlog_item_id,
    title: row.title,
    jiraKey: row.jira_key,
    eventType: row.event_type,
    detail: row.detail,
    occurredAt: row.occurred_at.toISOString(),
  }));
}
