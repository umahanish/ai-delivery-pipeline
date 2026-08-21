import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunner, AgentRunResult } from "../../src/agent/runCodingAgent";
import { getBacklogItem, insertBacklogItem, markJiraCreated, markReadyForDev, type BacklogItem } from "../../src/db/backlogItems";
import type { CreatePullRequestInput, CreatedPullRequest, PullRequestOpener } from "../../src/github/client";
import { getTestPool, resetDb } from "../helpers/db";

// git.ts/workspace.ts wrap real subprocess calls (`git clone`, `git push`,
// ...) — treated as an external I/O boundary to fake here, the same way
// JIRA/GitHub HTTP calls are faked elsewhere, rather than requiring a real
// git subprocess and a real (or local-fixture) remote in every test run.
// The real implementations get exercised by an actual live orchestrator
// run instead — see docs/DECISIONS.md.
vi.mock("../../src/orchestrator/workspace", () => ({
  prepareWorkspace: vi.fn(),
}));
vi.mock("../../src/orchestrator/git", () => ({
  hasUncommittedChanges: vi.fn(),
  getWorkingDiff: vi.fn(),
  commitAll: vi.fn(),
  pushBranch: vi.fn(),
}));

const { prepareWorkspace } = await import("../../src/orchestrator/workspace");
const { hasUncommittedChanges, getWorkingDiff, commitAll, pushBranch } = await import("../../src/orchestrator/git");
const { processBacklogItem } = await import("../../src/orchestrator/processBacklogItem");

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
  vi.clearAllMocks();
  vi.mocked(prepareWorkspace).mockResolvedValue({ dir: "/fake/workspace", branch: "story/proj-1", cleanup: vi.fn() });
  vi.mocked(hasUncommittedChanges).mockResolvedValue(true);
  vi.mocked(getWorkingDiff).mockResolvedValue("+ added a line");
  vi.mocked(commitAll).mockResolvedValue(undefined);
  vi.mocked(pushBranch).mockResolvedValue(undefined);
});

afterAll(async () => {
  await pool.end();
});

async function makeReadyItem(overrides: Partial<Parameters<typeof insertBacklogItem>[1]> = {}): Promise<BacklogItem> {
  const item = await insertBacklogItem(pool, {
    title: "Add a health endpoint",
    description: "Return { status: 'ok' } from GET /health",
    priority: "medium",
    targetRepo: "https://github.com/umahanish/delivery-pipeline-sample-app",
    ...overrides,
  });
  await markJiraCreated(pool, item.id, "PROJ-1", "https://example.atlassian.net/browse/PROJ-1");
  const ready = await markReadyForDev(pool, item.id);
  return ready!;
}

function agentResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return { success: true, resultText: "done", totalCostUsd: 0.01, numTurns: 3, subtype: "success", ...overrides };
}

/** Scripted responses returned in order across successive agentRunner calls. */
function scriptedAgent(results: AgentRunResult[]): AgentRunner {
  let call = 0;
  return async () => {
    const result = results[Math.min(call, results.length - 1)]!;
    call++;
    return result;
  };
}

function fakeGitHub(): PullRequestOpener & { calls: CreatePullRequestInput[] } {
  const calls: CreatePullRequestInput[] = [];
  return {
    calls,
    async createPullRequest(input) {
      calls.push(input);
      return { number: 42, url: "https://github.com/umahanish/delivery-pipeline-sample-app/pull/42" };
    },
  };
}

function baseDeps(agentRunner: AgentRunner, github: PullRequestOpener) {
  return { pool, agentRunner, github, githubToken: "gh-token", maxRounds: 3, testCommand: "npm test", baseBranch: "main" };
}

describe("processBacklogItem: claiming", () => {
  it("returns 'skipped' for an item not in ready_for_dev status", async () => {
    const item = await insertBacklogItem(pool, {
      title: "x",
      description: "y",
      priority: "low",
      targetRepo: "acme/widgets",
    }); // still 'submitted', never marked ready

    const outcome = await processBacklogItem(baseDeps(scriptedAgent([agentResult()]), fakeGitHub()), item);
    expect(outcome).toEqual({ outcome: "skipped", reason: "already claimed by another run" });
  });
});

describe("processBacklogItem: happy path", () => {
  it("implements, self-reviews (approved), commits, pushes, and opens a PR on the first round", async () => {
    const item = await makeReadyItem();
    const github = fakeGitHub();
    const agent = scriptedAgent([
      agentResult({ resultText: "implemented" }), // implement call
      agentResult({ resultText: "Looks good.\nVERDICT: APPROVE" }), // self-review call
    ]);

    const outcome = await processBacklogItem(baseDeps(agent, github), item);

    expect(outcome).toEqual({
      outcome: "pr_opened",
      prNumber: 42,
      prUrl: "https://github.com/umahanish/delivery-pipeline-sample-app/pull/42",
      rounds: 1,
    });
    expect(github.calls).toHaveLength(1);
    expect(github.calls[0]?.head).toBe("story/proj-1");
    expect(github.calls[0]?.base).toBe("main");
    expect(github.calls[0]?.title).toContain("PROJ-1");

    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("pr_open");
    expect(persisted?.prNumber).toBe(42);

    const { rows: events } = await pool.query(`SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1 ORDER BY occurred_at`, [
      item.id,
    ]);
    expect(events.map((e) => e.event_type)).toEqual(["dev_started", "self_review_approved", "pr_opened"]);
  });

  it("cleans up the workspace even after a successful run", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(prepareWorkspace).mockResolvedValueOnce({ dir: "/fake/workspace", branch: "story/proj-1", cleanup });

    const item = await makeReadyItem();
    await processBacklogItem(
      baseDeps(scriptedAgent([agentResult(), agentResult({ resultText: "VERDICT: APPROVE" })]), fakeGitHub()),
      item,
    );

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("processBacklogItem: retry on implement failure", () => {
  it("retries with a fix prompt after an implement failure, then succeeds", async () => {
    const item = await makeReadyItem();
    const agent = scriptedAgent([
      agentResult({ success: false, subtype: "error_during_execution", resultText: "crashed" }), // round 1 implement fails
      agentResult({ resultText: "fixed it" }), // round 2 implement succeeds
      agentResult({ resultText: "VERDICT: APPROVE" }), // round 2 self-review
    ]);

    const outcome = await processBacklogItem(baseDeps(agent, fakeGitHub()), item);

    expect(outcome.outcome).toBe("pr_opened");
    if (outcome.outcome === "pr_opened") expect(outcome.rounds).toBe(2);
  });

  it("retries when the agent reports success but made no file changes", async () => {
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const item = await makeReadyItem();
    const agent = scriptedAgent([
      agentResult({ resultText: "nothing to do" }), // round 1: "succeeds" but no changes
      agentResult({ resultText: "now really did it" }), // round 2 implement
      agentResult({ resultText: "VERDICT: APPROVE" }), // round 2 review
    ]);

    const outcome = await processBacklogItem(baseDeps(agent, fakeGitHub()), item);
    expect(outcome.outcome).toBe("pr_opened");
  });
});

describe("processBacklogItem: self-review rejection", () => {
  it("loops back to implement when the review requests changes, then succeeds", async () => {
    const item = await makeReadyItem();
    const agent = scriptedAgent([
      agentResult({ resultText: "first attempt" }), // round 1 implement
      agentResult({ resultText: "not quite right.\nVERDICT: REQUEST_CHANGES" }), // round 1 review: rejected
      agentResult({ resultText: "addressed feedback" }), // round 2 implement
      agentResult({ resultText: "VERDICT: APPROVE" }), // round 2 review: approved
    ]);

    const outcome = await processBacklogItem(baseDeps(agent, fakeGitHub()), item);
    expect(outcome.outcome).toBe("pr_opened");
    if (outcome.outcome === "pr_opened") expect(outcome.rounds).toBe(2);

    const { rows: events } = await pool.query(`SELECT event_type FROM pipeline_events WHERE backlog_item_id = $1 ORDER BY occurred_at`, [
      item.id,
    ]);
    expect(events.map((e) => e.event_type)).toContain("self_review_requested_changes");
  });

  it("treats an ambiguous review response (no clear VERDICT line) as not-approved rather than guessing", async () => {
    const item = await makeReadyItem();
    const agent = scriptedAgent([
      agentResult({ resultText: "implemented" }),
      agentResult({ resultText: "I think this looks approve-able but let me reconsider..." }), // no literal VERDICT line
      agentResult({ resultText: "revised" }),
      agentResult({ resultText: "VERDICT: APPROVE" }),
    ]);

    const outcome = await processBacklogItem(baseDeps(agent, fakeGitHub()), item);
    expect(outcome.outcome).toBe("pr_opened");
    if (outcome.outcome === "pr_opened") expect(outcome.rounds).toBe(2); // needed the second round, first wasn't accepted
  });
});

describe("processBacklogItem: exhausted retries", () => {
  it("marks needs_human after maxRounds failed attempts, and never calls GitHub", async () => {
    const item = await makeReadyItem();
    const github = fakeGitHub();
    const agent = scriptedAgent([agentResult({ success: false, subtype: "error_max_turns", resultText: "gave up" })]);

    const outcome = await processBacklogItem(baseDeps(agent, github), item);

    expect(outcome).toEqual({ outcome: "needs_human", rounds: 3, lastOutput: "gave up" });
    expect(github.calls).toHaveLength(0);

    const persisted = await getBacklogItem(pool, item.id);
    expect(persisted?.status).toBe("needs_human");
  });

  it("respects a custom maxRounds", async () => {
    const item = await makeReadyItem();
    const agent = scriptedAgent([agentResult({ success: false, resultText: "nope" })]);
    let calls = 0;
    const countingAgent: AgentRunner = async (input) => {
      calls++;
      return agent(input);
    };

    await processBacklogItem({ ...baseDeps(countingAgent, fakeGitHub()), maxRounds: 1 }, item);
    expect(calls).toBe(1); // one implement attempt, no self-review call since implement never succeeded
  });
});
