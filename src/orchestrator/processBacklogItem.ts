// The Phase 4 pipeline for one backlog item: claim -> isolated workspace
// -> implement/test/fix loop -> self-review -> commit/push/PR, or
// needs_human if the round budget runs out. See CLAUDE.md Constraints for
// why every one of these steps exists (isolated workspace, bounded
// retries, no auto-merge — this function never touches `main`, never
// merges anything; it stops at "PR opened").

import type pg from "pg";
import type { AgentRunner } from "../agent/runCodingAgent";
import { buildFixPrompt, buildImplementPrompt, buildSelfReviewPrompt, type StorySpec } from "../agent/prompts";
import { claimForDev, logPipelineEvent, markNeedsHuman, markPrOpen, type BacklogItem } from "../db/backlogItems";
import type { PullRequestOpener } from "../github/client";
import { parseGitHubRepo } from "../github/parseRepo";
import { Sentry } from "../lib/sentryNode";
import { notifySlack } from "../lib/notify";
import { commitAll, getWorkingDiff, hasUncommittedChanges, pushBranch } from "./git";
import { prepareWorkspace, type Workspace } from "./workspace";

export interface ProcessBacklogItemDeps {
  pool: pg.Pool;
  agentRunner: AgentRunner;
  github: PullRequestOpener;
  githubToken: string;
  /** Combined budget for implement-failure and review-rejection rounds — see docs/DECISIONS.md on why this is one counter, not two. */
  maxRounds: number;
  testCommand: string;
  baseBranch: string;
}

export type ProcessOutcome =
  | { outcome: "pr_opened"; prNumber: number; prUrl: string; rounds: number }
  | { outcome: "needs_human"; rounds: number; lastOutput: string }
  | { outcome: "skipped"; reason: string };

const MAX_DIFF_CHARS = 20_000;

export async function processBacklogItem(deps: ProcessBacklogItemDeps, item: BacklogItem): Promise<ProcessOutcome> {
  const claimed = await claimForDev(deps.pool, item.id);
  if (!claimed) {
    return { outcome: "skipped", reason: "already claimed by another run" };
  }

  let workspace: Workspace | undefined;
  let roundsAttempted = 0;

  try {
    const { owner, repo } = parseGitHubRepo(item.targetRepo);
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const branchName = `story/${(item.jiraKey ?? item.id).toLowerCase()}`;

    await logPipelineEvent(deps.pool, item.id, "dev_started", branchName);

    workspace = await prepareWorkspace(cloneUrl, branchName);
    const story: StorySpec = {
      title: item.title,
      description: item.description,
      acceptanceCriteria: item.acceptanceCriteria,
      testCommand: deps.testCommand,
    };

    let lastOutput = "";

    for (let round = 1; round <= deps.maxRounds; round++) {
      roundsAttempted = round;
      const prompt = round === 1 ? buildImplementPrompt(story) : buildFixPrompt(story, lastOutput);
      const implementResult = await deps.agentRunner({ cwd: workspace.dir, prompt, maxTurns: 15 });
      lastOutput = implementResult.resultText;

      if (!implementResult.success) {
        await logPipelineEvent(deps.pool, item.id, "implement_failed", `round ${round}: ${implementResult.subtype}`);
        continue;
      }

      if (!(await hasUncommittedChanges(workspace.dir))) {
        lastOutput = "Agent reported success but made no file changes.";
        await logPipelineEvent(deps.pool, item.id, "implement_no_changes", `round ${round}`);
        continue;
      }

      const diff = await getWorkingDiff(workspace.dir);
      const reviewPrompt = buildSelfReviewPrompt(story, diff.slice(0, MAX_DIFF_CHARS));
      // 3 turns looked sufficient on paper (the diff is embedded directly
      // in the prompt) but a live run hit that cap anyway — the agent
      // still explores the repo (CLAUDE.md, surrounding code) before
      // answering rather than only reading the embedded diff. See
      // docs/DECISIONS.md.
      const reviewResult = await deps.agentRunner({ cwd: workspace.dir, prompt: reviewPrompt, maxTurns: 8 });
      const approved = parseReviewVerdict(reviewResult.resultText);

      await logPipelineEvent(
        deps.pool,
        item.id,
        approved ? "self_review_approved" : "self_review_requested_changes",
        `round ${round}`,
      );

      if (!approved) {
        lastOutput = reviewResult.resultText;
        continue;
      }

      await commitAll(workspace.dir, `${item.jiraKey ?? item.id}: ${item.title}`);
      await pushBranch(workspace.dir, branchName, deps.githubToken);

      const pr = await deps.github.createPullRequest({
        title: `${item.jiraKey ?? ""} ${item.title}`.trim(),
        body: buildPrBody(item),
        head: branchName,
        base: deps.baseBranch,
      });

      await markPrOpen(deps.pool, item.id, pr.number, pr.url);
      await logPipelineEvent(deps.pool, item.id, "pr_opened", pr.url);
      await notifySlack(`:tada: PR opened for *${item.jiraKey ?? item.title}* — ${pr.url}`);
      return { outcome: "pr_opened", prNumber: pr.number, prUrl: pr.url, rounds: round };
    }

    await markNeedsHuman(deps.pool, item.id);
    await logPipelineEvent(deps.pool, item.id, "needs_human", lastOutput.slice(0, 2000));
    await notifySlack(
      `:warning: *${item.jiraKey ?? item.title}* needs a human — the coding agent exhausted its ${deps.maxRounds}-round budget without converging.`,
    );
    return { outcome: "needs_human", rounds: deps.maxRounds, lastOutput };
  } catch (err) {
    // Belt-and-suspenders beyond the per-round handling above: an
    // unexpected throw from *anywhere* in the try block (a live run hit
    // one from the SDK itself before runCodingAgent.ts caught it — see
    // docs/DECISIONS.md) must never leave the row silently stuck in
    // in_dev with no explanation, which is exactly the failure mode
    // CLAUDE.md's Phase 4 "on exhausting retries" requirement exists to
    // prevent — that intent extends to crashes, not just clean exhaustion.
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    Sentry.captureException(err);
    await markNeedsHuman(deps.pool, item.id);
    await logPipelineEvent(deps.pool, item.id, "needs_human", `unexpected error: ${message.slice(0, 2000)}`);
    await notifySlack(`:rotating_light: *${item.jiraKey ?? item.title}* crashed unexpectedly and needs a human: ${message.slice(0, 300)}`);
    return { outcome: "needs_human", rounds: roundsAttempted, lastOutput: message };
  } finally {
    await workspace?.cleanup();
  }
}

/** Looks for the *last* verdict line specifically so a review that quotes/discusses the other verdict earlier in its own reasoning doesn't get mismatched. No clear verdict at all -> treated as not-approved, erring conservative rather than defaulting to merge-worthy. */
function parseReviewVerdict(text: string): boolean {
  const approveIdx = text.lastIndexOf("VERDICT: APPROVE");
  const rejectIdx = text.lastIndexOf("VERDICT: REQUEST_CHANGES");
  if (approveIdx === -1 && rejectIdx === -1) return false;
  return approveIdx > rejectIdx;
}

function buildPrBody(item: BacklogItem): string {
  const lines = [
    item.jiraKey ? `JIRA: ${item.jiraUrl}` : null,
    "",
    item.description,
    item.acceptanceCriteria ? `\nAcceptance criteria:\n${item.acceptanceCriteria}` : null,
    "",
    "---",
    "Opened automatically by ai-delivery-pipeline's coding agent, after passing its own tests and a self-review pass. A human must still approve this PR before merge — see CLAUDE.md.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}
