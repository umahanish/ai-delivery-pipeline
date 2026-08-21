// `npm run orchestrator` — a one-shot pass over every backlog item
// currently marked ready_for_dev, not a long-running poll daemon. Simpler
// for a reference/demo pipeline than an actual poll loop; run it manually,
// on a schedule, or via a webhook trigger later. See docs/DECISIONS.md.

import "dotenv/config";
import { runCodingAgent } from "../src/agent/runCodingAgent.js";
import { listReadyForDev } from "../src/db/backlogItems.js";
import { getPool } from "../src/db/pool.js";
import { GitHubClient } from "../src/github/client.js";
import { parseGitHubRepo } from "../src/github/parseRepo.js";
import { processBacklogItem } from "../src/orchestrator/processBacklogItem.js";

async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is not set (see .env.example) — required to push branches and open PRs");
  }

  const pool = getPool();

  try {
    const items = await listReadyForDev(pool);
    if (items.length === 0) {
      console.log("No backlog items are ready for dev.");
      return;
    }

    for (const item of items) {
      console.log(`\n=== ${item.jiraKey ?? item.id}: ${item.title} ===`);

      const { owner, repo } = parseGitHubRepo(item.targetRepo);
      const github = new GitHubClient({ token: githubToken, owner, repo });

      const outcome = await processBacklogItem(
        {
          pool,
          agentRunner: runCodingAgent,
          github,
          githubToken,
          maxRounds: 3,
          testCommand: "npm test",
          baseBranch: "main",
        },
        item,
      );

      console.log(outcome);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
