import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimForDev,
  getBacklogItem,
  insertBacklogItem,
  listBacklogItems,
  listMerged,
  listPrOpen,
  listReadyForDev,
  logPipelineEvent,
  markDeployed,
  markDeployFailed,
  markJiraCreated,
  markJiraFailed,
  markMerged,
  markNeedsHuman,
  markPrOpen,
  markReadyForDev,
} from "../../src/db/backlogItems";
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

describe("insertBacklogItem", () => {
  it("inserts with status 'submitted' and no jira_key yet", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    expect(item.status).toBe("submitted");
    expect(item.jiraKey).toBeNull();
    expect(item.title).toBe("Add rate limiting");
  });

  it("defaults acceptanceCriteria to null when omitted", async () => {
    const item = await insertBacklogItem(pool, { ...sampleInput, acceptanceCriteria: undefined });
    expect(item.acceptanceCriteria).toBeNull();
  });
});

describe("markJiraCreated / markJiraFailed", () => {
  it("markJiraCreated sets jira_key and jira_url", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://acme.atlassian.net/browse/PROJ-1");

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.jiraKey).toBe("PROJ-1");
    expect(updated?.jiraUrl).toBe("https://acme.atlassian.net/browse/PROJ-1");
    expect(updated?.status).toBe("submitted"); // unchanged
  });

  it("markJiraFailed sets status to jira_failed", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraFailed(pool, item.id);

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("jira_failed");
  });
});

describe("markReadyForDev", () => {
  it("transitions submitted -> ready_for_dev when a jira_key exists", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://x/PROJ-1");

    const updated = await markReadyForDev(pool, item.id);
    expect(updated?.status).toBe("ready_for_dev");
  });

  it("returns null (does not throw) when there's no jira_key yet", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    const result = await markReadyForDev(pool, item.id);
    expect(result).toBeNull();

    const unchanged = await getBacklogItem(pool, item.id);
    expect(unchanged?.status).toBe("submitted");
  });

  it("returns null when the item isn't in 'submitted' status", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://x/PROJ-1");
    await markReadyForDev(pool, item.id); // now ready_for_dev

    const secondAttempt = await markReadyForDev(pool, item.id);
    expect(secondAttempt).toBeNull();
  });
});

describe("listBacklogItems", () => {
  it("returns items newest-first", async () => {
    const first = await insertBacklogItem(pool, { ...sampleInput, title: "First" });
    const second = await insertBacklogItem(pool, { ...sampleInput, title: "Second" });

    const items = await listBacklogItems(pool);
    expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
  });
});

describe("logPipelineEvent", () => {
  it("inserts a row referencing the backlog item", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await logPipelineEvent(pool, item.id, "jira_story_created", "PROJ-1");

    const { rows } = await pool.query(`SELECT event_type, detail FROM pipeline_events WHERE backlog_item_id = $1`, [item.id]);
    expect(rows).toEqual([{ event_type: "jira_story_created", detail: "PROJ-1" }]);
  });
});

describe("listReadyForDev", () => {
  it("only returns items in ready_for_dev status, oldest first", async () => {
    const a = await insertBacklogItem(pool, { ...sampleInput, title: "A" });
    await markJiraCreated(pool, a.id, "PROJ-1", "https://x/PROJ-1");
    await markReadyForDev(pool, a.id);

    const b = await insertBacklogItem(pool, { ...sampleInput, title: "B" }); // still just 'submitted'

    const ready = await listReadyForDev(pool);
    expect(ready.map((i) => i.id)).toEqual([a.id]);
    expect(ready.map((i) => i.id)).not.toContain(b.id);
  });
});

describe("claimForDev", () => {
  it("transitions ready_for_dev -> in_dev", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://x/PROJ-1");
    await markReadyForDev(pool, item.id);

    const claimed = await claimForDev(pool, item.id);
    expect(claimed?.status).toBe("in_dev");
  });

  it("returns null on a second claim attempt — prevents two orchestrator runs from both picking up the same item", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markJiraCreated(pool, item.id, "PROJ-1", "https://x/PROJ-1");
    await markReadyForDev(pool, item.id);

    const firstClaim = await claimForDev(pool, item.id);
    const secondClaim = await claimForDev(pool, item.id);

    expect(firstClaim?.status).toBe("in_dev");
    expect(secondClaim).toBeNull();
  });

  it("returns null for an item that was never marked ready", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    expect(await claimForDev(pool, item.id)).toBeNull();
  });
});

describe("markPrOpen", () => {
  it("sets status, pr_number, and pr_url", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, item.id, 42, "https://github.com/acme/widgets/pull/42");

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("pr_open");
    expect(updated?.prNumber).toBe(42);
    expect(updated?.prUrl).toBe("https://github.com/acme/widgets/pull/42");
  });
});

describe("markNeedsHuman", () => {
  it("sets status to needs_human", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markNeedsHuman(pool, item.id);

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("needs_human");
  });
});

describe("listPrOpen", () => {
  it("returns only pr_open items, oldest first", async () => {
    const other = await insertBacklogItem(pool, sampleInput); // stays 'submitted'
    const prOpen = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, prOpen.id, 1, "https://github.com/acme/widgets/pull/1");

    const items = await listPrOpen(pool);
    expect(items.map((i) => i.id)).toEqual([prOpen.id]);
    expect(items.map((i) => i.id)).not.toContain(other.id);
  });
});

describe("markMerged", () => {
  it("sets status to merged and deploy_status to pending", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, item.id, 1, "https://github.com/acme/widgets/pull/1");
    await markMerged(pool, item.id);

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("merged");
    expect(updated?.deployStatus).toBe("pending");
  });
});

describe("listMerged", () => {
  it("returns only merged items", async () => {
    const merged = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, merged.id, 1, "https://github.com/acme/widgets/pull/1");
    await markMerged(pool, merged.id);
    const notMerged = await insertBacklogItem(pool, sampleInput);
    await markPrOpen(pool, notMerged.id, 2, "https://github.com/acme/widgets/pull/2");

    const items = await listMerged(pool);
    expect(items.map((i) => i.id)).toEqual([merged.id]);
  });
});

describe("markDeployed / markDeployFailed", () => {
  it("markDeployed sets status and deploy_status to deployed", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markDeployed(pool, item.id);

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("deployed");
    expect(updated?.deployStatus).toBe("deployed");
  });

  it("markDeployFailed sets status and deploy_status to failed", async () => {
    const item = await insertBacklogItem(pool, sampleInput);
    await markDeployFailed(pool, item.id);

    const updated = await getBacklogItem(pool, item.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.deployStatus).toBe("failed");
  });
});
