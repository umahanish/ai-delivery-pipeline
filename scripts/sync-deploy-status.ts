// `npm run sync-deploy-status` -- a one-shot pass, same convention as
// scripts/run-orchestrator.ts: checks every pr_open item for a human
// merge, and every merged item for a completed deploy workflow run, and
// updates backlog_items/pipeline_events accordingly. See
// src/orchestrator/deployStatus.ts for why this has to run locally rather
// than as part of the GitHub Actions deploy workflow itself.

import "dotenv/config";
import { listMerged, listPrOpen } from "../src/db/backlogItems.js";
import { getPool } from "../src/db/pool.js";
import { GitHubClient } from "../src/github/client.js";
import { parseGitHubRepo } from "../src/github/parseRepo.js";
import { syncDeployStatus } from "../src/orchestrator/deployStatus.js";

async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is not set (see .env.example)");
  }

  const pool = getPool();

  try {
    const [prOpenItems, mergedItems] = await Promise.all([listPrOpen(pool), listMerged(pool)]);
    const candidates = [...prOpenItems, ...mergedItems];
    if (candidates.length === 0) {
      console.log("No pr_open or merged backlog items to check.");
      return;
    }

    // syncDeployStatus() checks every pr_open/merged row in one pass against
    // a single GitHubClient — fine for this reference pipeline, which only
    // ever targets one sample repo (Phase 2). Built against the first
    // candidate's target_repo; would need a per-repo GitHubClient and a
    // repo-scoped syncDeployStatus() if this ever targeted more than one.
    const { owner, repo } = parseGitHubRepo(candidates[0]!.targetRepo);
    const github = new GitHubClient({ token: githubToken, owner, repo });

    const summary = await syncDeployStatus({ pool, github, deployWorkflowFileName: "deploy.yml" });
    console.log(summary);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
