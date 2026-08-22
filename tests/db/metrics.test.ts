import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  insertBacklogItem,
  logPipelineEvent,
  markDeployed,
  markDeployFailed,
  markJiraCreated,
  markNeedsHuman,
  markPrOpen,
  markReadyForDev,
  updatePrStatus,
} from "../../src/db/backlogItems";
import { getPipelineMetrics, listRecentEvents } from "../../src/db/metrics";
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
  priority: "high" as const,
  targetRepo: "acme/widgets",
};

describe("getPipelineMetrics", () => {
  it("returns zeroes/nulls for an empty pipeline", async () => {
    const metrics = await getPipelineMetrics(pool);
    expect(metrics).toEqual({
      totalSubmitted: 0,
      byStatus: {},
      needsHumanCount: 0,
      avgTimeToPrHours: null,
      ciPassRate: null,
      deploySuccessRate: null,
    });
  });

  it("counts items by status and totals them", async () => {
    await insertBacklogItem(pool, sampleInput);
    const item2 = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item2.id, "PROJ-2", "https://acme.atlassian.net/browse/PROJ-2");
    await markReadyForDev(pool, item2.id);

    const metrics = await getPipelineMetrics(pool);
    expect(metrics.totalSubmitted).toBe(2);
    expect(metrics.byStatus).toEqual({ submitted: 1, ready_for_dev: 1 });
  });

  it("counts needs_human items", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markNeedsHuman(pool, item.id);

    const metrics = await getPipelineMetrics(pool);
    expect(metrics.needsHumanCount).toBe(1);
  });

  it("averages hours between dev_started and pr_opened", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    // logPipelineEvent's occurred_at defaults to now() -- inserted directly
    // with an explicit gap so the average is deterministic rather than
    // racing the test's own execution speed.
    await pool.query(
      `INSERT INTO pipeline_events (backlog_item_id, event_type, occurred_at) VALUES ($1, 'dev_started', now() - interval '2 hours')`,
      [item.id],
    );
    await pool.query(`INSERT INTO pipeline_events (backlog_item_id, event_type, occurred_at) VALUES ($1, 'pr_opened', now())`, [item.id]);

    const metrics = await getPipelineMetrics(pool);
    expect(metrics.avgTimeToPrHours).not.toBeNull();
    expect(metrics.avgTimeToPrHours!).toBeGreaterThan(1.9);
    expect(metrics.avgTimeToPrHours!).toBeLessThan(2.1);
  });

  it("computes CI pass rate only from resolved (passing/failing) statuses, ignoring pending/null", async () => {
    const passing = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, passing.id, 1, "https://github.com/acme/widgets/pull/1");
    await updatePrStatus(pool, passing.id, "approved", "passing");

    const failing = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, failing.id, 2, "https://github.com/acme/widgets/pull/2");
    await updatePrStatus(pool, failing.id, "pending", "failing");

    const stillPending = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, stillPending.id, 3, "https://github.com/acme/widgets/pull/3");
    await updatePrStatus(pool, stillPending.id, "pending", "pending");

    await insertBacklogItem(pool, sampleInput); // never reached pr_open, ci_status stays null

    const metrics = await getPipelineMetrics(pool);
    expect(metrics.ciPassRate).toBe(0.5);
  });

  it("computes deploy success rate only from resolved (deployed/failed) statuses", async () => {
    const deployed = await insertBacklogItem(pool, sampleInput);
    await markDeployed(pool, deployed.id);

    const failed = await insertBacklogItem(pool, sampleInput);
    await markDeployFailed(pool, failed.id);

    const metrics = await getPipelineMetrics(pool);
    expect(metrics.deploySuccessRate).toBe(0.5);
  });
});

describe("listRecentEvents", () => {
  it("returns events newest-first, joined with the item's title/jiraKey", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://acme.atlassian.net/browse/PROJ-1");
    await logPipelineEvent(pool, item.id, "jira_story_created", "PROJ-1");
    await logPipelineEvent(pool, item.id, "dev_started", "story/proj-1");

    const events = await listRecentEvents(pool, 10);
    expect(events[0]?.eventType).toBe("dev_started");
    expect(events[0]?.title).toBe("Add rate limiting");
    expect(events[0]?.jiraKey).toBe("PROJ-1");
    expect(events.map((e) => e.eventType)).toContain("jira_story_created");
  });

  it("respects the limit", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    for (let i = 0; i < 5; i++) {
      await logPipelineEvent(pool, item.id, `event_${i}`);
    }

    const events = await listRecentEvents(pool, 3);
    expect(events).toHaveLength(3);
  });
});
