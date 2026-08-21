import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getBacklogItem, insertBacklogItem, markPrOpen } from "../../src/db/backlogItems";
import type {
  DeployWorkflowChecker,
  PrStatus,
  PrStatusChecker,
  PullRequestChecker,
  PullRequestMergeState,
  WorkflowRun,
} from "../../src/github/client";
import { checkMergedItem, checkPrOpenItem, syncDeployStatus } from "../../src/orchestrator/deployStatus";
import { getTestPool, resetDb } from "../helpers/db";

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

const sampleInput = {
  title: "Add rate limiting",
  description: "Protect the API gateway from abusive clients.",
  acceptanceCriteria: "Returns 429 after the limit is hit.",
  priority: "high" as const,
  targetRepo: "acme/widgets",
};

async function makePrOpenItem(prNumber = 1) {
  const item = await insertBacklogItem(pool, sampleInput);
  await markPrOpen(pool, item.id, prNumber, `https://github.com/acme/widgets/pull/${prNumber}`);
  return (await getBacklogItem(pool, item.id))!; // re-fetch: markPrOpen doesn't return the row, and the pre-markPrOpen `item` has prNumber: null
}

function fakeGithub(overrides: {
  mergeState?: PullRequestMergeState;
  run?: WorkflowRun | null;
  prStatus?: PrStatus;
} = {}): PullRequestChecker & DeployWorkflowChecker & PrStatusChecker {
  return {
    async getPullRequestMergeState() {
      return overrides.mergeState ?? { merged: false, mergeCommitSha: null };
    },
    async getWorkflowRunForCommit() {
      return overrides.run ?? null;
    },
    async getPrStatus() {
      return overrides.prStatus ?? { reviewStatus: "pending", ciStatus: "pending" };
    },
  };
}

describe("checkPrOpenItem", () => {
  it("returns still_open and makes no DB change when the PR isn't merged yet", async () => {
    const item = await makePrOpenItem();
    const github = fakeGithub({ mergeState: { merged: false, mergeCommitSha: null } });

    const outcome = await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);

    expect(outcome).toEqual({ outcome: "still_open" });
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("pr_open");
  });

  it("marks merged and logs pr_merged when the PR has been merged", async () => {
    const item = await makePrOpenItem();
    const github = fakeGithub({ mergeState: { merged: true, mergeCommitSha: "abc123" } });

    const outcome = await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);

    expect(outcome).toEqual({ outcome: "merged" });
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("merged");
    expect(persisted?.deployStatus).toBe("pending");

    const { rows } = await pool.query(`SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1`, [item.id]);
    expect(rows.map((r) => r.event_type)).toContain("pr_merged");
  });

  it("throws if called on an item with no pr_number rather than silently no-op-ing", async () => {
    const item = await insertBacklogItem(pool, sampleInput); // status 'submitted', no pr_number
    const github = fakeGithub();
    await expect(checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item)).rejects.toThrow(/no pr_number/);
  });

  it("writes pr_review_status/ci_status even while the PR is still open, and logs pr_status_updated only when something changed", async () => {
    const item = await makePrOpenItem();
    const github = fakeGithub({
      mergeState: { merged: false, mergeCommitSha: null },
      prStatus: { reviewStatus: "changes_requested", ciStatus: "failing" },
    });

    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);

    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("pr_open"); // still open -- this isn't a merge signal
    expect(persisted?.prReviewStatus).toBe("changes_requested");
    expect(persisted?.ciStatus).toBe("failing");

    const { rows: firstPassEvents } = await pool.query(`SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1`, [item.id]);
    expect(firstPassEvents.map((r) => r.event_type)).toContain("pr_status_updated");

    // Same status again: no new event, since nothing actually changed.
    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, (await getBacklogItem(pool, item.id))!);
    const { rows: secondPassEvents } = await pool.query(
      `SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1 AND event_type = 'pr_status_updated'`,
      [item.id],
    );
    expect(secondPassEvents).toHaveLength(1);
  });
});

describe("checkMergedItem", () => {
  it("returns deploy_pending when no workflow run has started yet", async () => {
    const item = await makePrOpenItem();
    const github = fakeGithub({ mergeState: { merged: true, mergeCommitSha: "abc123" }, run: null });
    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);
    const merged = (await getBacklogItem(pool, item.id))!;

    const outcome = await checkMergedItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, merged);
    expect(outcome).toEqual({ outcome: "deploy_pending" });
  });

  it("returns deploy_pending while the run is still in progress", async () => {
    const item = await makePrOpenItem();
    const github = fakeGithub({
      mergeState: { merged: true, mergeCommitSha: "abc123" },
      run: { status: "in_progress", conclusion: null, htmlUrl: "https://github.com/acme/widgets/actions/runs/1" },
    });
    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);
    const merged = (await getBacklogItem(pool, item.id))!;

    const outcome = await checkMergedItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, merged);
    expect(outcome).toEqual({ outcome: "deploy_pending" });
  });

  it("marks deployed on a completed run with conclusion success", async () => {
    const item = await makePrOpenItem();
    const runUrl = "https://github.com/acme/widgets/actions/runs/1";
    const github = fakeGithub({
      mergeState: { merged: true, mergeCommitSha: "abc123" },
      run: { status: "completed", conclusion: "success", htmlUrl: runUrl },
    });
    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);
    const merged = (await getBacklogItem(pool, item.id))!;

    const outcome = await checkMergedItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, merged);

    expect(outcome).toEqual({ outcome: "deployed", runUrl });
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("deployed");
    expect(persisted?.deployStatus).toBe("deployed");
  });

  it("marks failed on a completed run with a non-success conclusion", async () => {
    const item = await makePrOpenItem();
    const runUrl = "https://github.com/acme/widgets/actions/runs/1";
    const github = fakeGithub({
      mergeState: { merged: true, mergeCommitSha: "abc123" },
      run: { status: "completed", conclusion: "failure", htmlUrl: runUrl },
    });
    await checkPrOpenItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, item);
    const merged = (await getBacklogItem(pool, item.id))!;

    const outcome = await checkMergedItem({ pool, github, deployWorkflowFileName: "deploy.yml" }, merged);

    expect(outcome).toEqual({ outcome: "deploy_failed", runUrl });
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("failed");
    expect(persisted?.deployStatus).toBe("failed");
  });
});

describe("syncDeployStatus", () => {
  it("picks up a newly-merged item's completed deploy in the same pass", async () => {
    const item = await makePrOpenItem();
    const runUrl = "https://github.com/acme/widgets/actions/runs/1";
    const github = fakeGithub({
      mergeState: { merged: true, mergeCommitSha: "abc123" },
      run: { status: "completed", conclusion: "success", htmlUrl: runUrl },
    });

    const summary = await syncDeployStatus({ pool, github, deployWorkflowFileName: "deploy.yml" });

    expect(summary).toEqual({ checked: 1, merged: 1, deployed: 1, failed: 0 });
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("deployed");
  });

  it("reports zero for everything when there's nothing to check", async () => {
    const github = fakeGithub();
    const summary = await syncDeployStatus({ pool, github, deployWorkflowFileName: "deploy.yml" });
    expect(summary).toEqual({ checked: 0, merged: 0, deployed: 0, failed: 0 });
  });
});
