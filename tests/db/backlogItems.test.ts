import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getBacklogItem,
  insertBacklogItem,
  listBacklogItems,
  logPipelineEvent,
  markJiraCreated,
  markJiraFailed,
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
