// Isolated workspace per story: a fresh clone into its own scratch
// directory, on its own branch. Chosen over `git worktree` (which
// CLAUDE.md's Architecture section names) because a fresh clone already
// satisfies every isolation property the brief actually cares about — its
// own directory, its own branch, never touching a shared checkout —
// without needing a persistent shared bare repo to add worktrees against,
// or worrying about worktree-specific edge cases (stale locks, concurrent
// worktree limits). Same intent, simpler mechanism. See docs/DECISIONS.md.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkoutNewBranch, cloneRepo } from "./git";

export interface Workspace {
  dir: string;
  branch: string;
  cleanup: () => Promise<void>;
}

export async function prepareWorkspace(cloneUrl: string, branchName: string): Promise<Workspace> {
  const parent = await mkdtemp(path.join(tmpdir(), "ai-delivery-pipeline-"));
  const dir = path.join(parent, "repo");

  await cloneRepo(cloneUrl, dir);
  await checkoutNewBranch(dir, branchName);

  return {
    dir,
    branch: branchName,
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}
