// Phase 6's reconciliation step. The deploy + Qualys-substitute workflow
// (delivery-pipeline-sample-app's .github/workflows/deploy.yml) runs on
// GitHub's own cloud runners, which can never reach this project's local
// Postgres — there's no way for that workflow to write back to
// backlog_items directly. Instead this runs locally (same machine as the
// rest of the pipeline) and reaches *out* to GitHub's API to find out what
// happened, the same direction every other DB write in this project
// already goes. See docs/DECISIONS.md.
//
// Two independent transitions, because they're driven by two independent
// external events: a human merging the PR (pr_open -> merged), and the
// deploy workflow completing for that merge commit (merged -> deployed |
// failed). Not a poll daemon — same "run it manually, on a schedule, or
// via a webhook later" convention as scripts/run-orchestrator.ts.

import type pg from "pg";
import {
  listMerged,
  listPrOpen,
  logPipelineEvent,
  markDeployed,
  markDeployFailed,
  markMerged,
  type BacklogItem,
} from "../db/backlogItems";
import type { DeployWorkflowChecker, PullRequestChecker } from "../github/client";

export interface SyncDeployStatusDeps {
  pool: pg.Pool;
  github: PullRequestChecker & DeployWorkflowChecker;
  /** The workflow file name Actions identifies runs by, e.g. "deploy.yml". */
  deployWorkflowFileName: string;
}

export type DeployStatusOutcome =
  | { outcome: "still_open" }
  | { outcome: "merged" }
  | { outcome: "deploy_pending" }
  | { outcome: "deployed"; runUrl: string }
  | { outcome: "deploy_failed"; runUrl: string };

export async function checkPrOpenItem(deps: SyncDeployStatusDeps, item: BacklogItem): Promise<DeployStatusOutcome> {
  if (item.prNumber === null) {
    throw new Error(`checkPrOpenItem: item ${item.id} has status pr_open but no pr_number`);
  }

  const { merged } = await deps.github.getPullRequestMergeState(item.prNumber);
  if (!merged) {
    return { outcome: "still_open" };
  }

  await markMerged(deps.pool, item.id);
  await logPipelineEvent(deps.pool, item.id, "pr_merged", item.prUrl ?? undefined);
  return { outcome: "merged" };
}

export async function checkMergedItem(deps: SyncDeployStatusDeps, item: BacklogItem): Promise<DeployStatusOutcome> {
  if (item.prNumber === null) {
    throw new Error(`checkMergedItem: item ${item.id} has status merged but no pr_number`);
  }

  // Re-fetched rather than stored on the row at merge time — keeps
  // backlog_items free of a column that exists only to serve this one
  // lookup, and the PR's merge commit SHA never changes once merged.
  const { merged, mergeCommitSha } = await deps.github.getPullRequestMergeState(item.prNumber);
  if (!merged || !mergeCommitSha) {
    return { outcome: "deploy_pending" };
  }

  const run = await deps.github.getWorkflowRunForCommit(deps.deployWorkflowFileName, mergeCommitSha);
  if (!run || run.status !== "completed") {
    return { outcome: "deploy_pending" };
  }

  if (run.conclusion === "success") {
    await markDeployed(deps.pool, item.id);
    await logPipelineEvent(deps.pool, item.id, "deployed", run.htmlUrl);
    return { outcome: "deployed", runUrl: run.htmlUrl };
  }

  await markDeployFailed(deps.pool, item.id);
  await logPipelineEvent(deps.pool, item.id, "deploy_failed", `${run.conclusion ?? "unknown"}: ${run.htmlUrl}`);
  return { outcome: "deploy_failed", runUrl: run.htmlUrl };
}

export interface SyncDeployStatusSummary {
  checked: number;
  merged: number;
  deployed: number;
  failed: number;
}

/** One pass over every pr_open/merged item. A newly-merged item is picked up by the same pass's merged-item check, not left for the next run. */
export async function syncDeployStatus(deps: SyncDeployStatusDeps): Promise<SyncDeployStatusSummary> {
  const checkedIds = new Set<string>();
  let merged = 0;

  const prOpenItems = await listPrOpen(deps.pool);
  for (const item of prOpenItems) {
    checkedIds.add(item.id);
    const outcome = await checkPrOpenItem(deps, item);
    if (outcome.outcome === "merged") merged++;
  }

  let deployed = 0;
  let failed = 0;

  // Re-listed rather than reusing prOpenItems, specifically so an item
  // that just transitioned merged -> (deployed | failed) above gets its
  // deploy checked in this same pass rather than waiting for the next
  // run. checkedIds is a Set (not prOpenItems.length + mergedItems.length)
  // so that same item isn't double-counted in the summary.
  const mergedItems = await listMerged(deps.pool);
  for (const item of mergedItems) {
    checkedIds.add(item.id);
    const outcome = await checkMergedItem(deps, item);
    if (outcome.outcome === "deployed") deployed++;
    if (outcome.outcome === "deploy_failed") failed++;
  }

  return { checked: checkedIds.size, merged, deployed, failed };
}
