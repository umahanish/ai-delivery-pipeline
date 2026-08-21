import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getBacklogItem } from "../../src/db/backlogItems";
import type { CreatedIssue, CreateIssueInput, JiraIssueCreator } from "../../src/jira/client";
import { createBacklogItem } from "../../src/lib/createBacklogItem";
import { getTestPool, resetDb } from "../helpers/db";

// Real Postgres (the DB side genuinely needs it), a fake JiraClient (the
// external-API side doesn't — same split as the sibling project's
// connector-vs-persistence testing).

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

function fakeJira(behavior: "succeed" | "fail"): JiraIssueCreator & { calls: CreateIssueInput[] } {
  const calls: CreateIssueInput[] = [];
  return {
    calls,
    async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
      calls.push(input);
      if (behavior === "fail") throw new Error("JIRA is down");
      return { key: "PROJ-1", url: "https://acme.atlassian.net/browse/PROJ-1" };
    },
  };
}

describe("createBacklogItem", () => {
  it("saves the row and updates it with the JIRA key on success", async () => {
    const jira = fakeJira("succeed");
    const item = await createBacklogItem({ pool, getJira: () => jira }, sampleInput);

    expect(item.jiraKey).toBe("PROJ-1");
    expect(item.jiraUrl).toBe("https://acme.atlassian.net/browse/PROJ-1");
    expect(item.status).toBe("submitted");

    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.jiraKey).toBe("PROJ-1");
  });

  it("passes title as summary and folds acceptance criteria + target repo into the description", async () => {
    const jira = fakeJira("succeed");
    await createBacklogItem({ pool, getJira: () => jira }, sampleInput);

    expect(jira.calls[0]?.summary).toBe("Add rate limiting");
    expect(jira.calls[0]?.description).toContain("Protect the API gateway");
    expect(jira.calls[0]?.description).toContain("Returns 429 after the limit is hit.");
    expect(jira.calls[0]?.description).toContain("acme/widgets");
  });

  it("still saves the row and marks jira_failed when JIRA creation throws — never loses the submission", async () => {
    const jira = fakeJira("fail");
    const item = await createBacklogItem({ pool, getJira: () => jira }, sampleInput);

    expect(item.status).toBe("jira_failed");
    expect(item.jiraKey).toBeNull();

    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("jira_failed");
    expect(persisted?.title).toBe("Add rate limiting"); // the submission itself wasn't lost
  });

  it("still saves the row when the JIRA client factory itself throws (e.g. missing config) — not just when createIssue fails", async () => {
    // Regression test: found live while smoke-testing the actual app —
    // constructing JiraClient from env vars can throw synchronously
    // *before* any API call happens. getJira is called from inside
    // createBacklogItem's own try block specifically so this case is
    // handled identically to an unreachable-JIRA failure, not silently
    // skipped past insertBacklogItem.
    const item = await createBacklogItem(
      {
        pool,
        getJira: () => {
          throw new Error("JIRA is not configured");
        },
      },
      sampleInput,
    );

    expect(item.status).toBe("jira_failed");
    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.title).toBe("Add rate limiting");
  });

  it("logs a pipeline_events row for both the success and failure paths", async () => {
    const okItem = await createBacklogItem({ pool, getJira: () => fakeJira("succeed") }, sampleInput);
    const failedItem = await createBacklogItem({ pool, getJira: () => fakeJira("fail") }, sampleInput);

    const { rows: okEvents } = await pool.query(`SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1`, [okItem.id]);
    expect(okEvents).toEqual([{ event_type: "jira_story_created" }]);

    const { rows: failEvents } = await pool.query(`SELECT event_type, detail FROM pipeline_events WHERE backlog_item_id = $1`, [
      failedItem.id,
    ]);
    expect(failEvents[0]?.event_type).toBe("jira_create_failed");
    expect(failEvents[0]?.detail).toContain("JIRA is down");
  });
});
