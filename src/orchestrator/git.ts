// Shell out to `git` directly rather than a git library — the operations
// needed (clone, branch, diff, commit, push) are a handful of plain
// commands, and a library dependency wouldn't remove any real complexity
// here.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

export async function cloneRepo(url: string, dir: string): Promise<void> {
  // cwd doesn't matter for clone (the destination is an argument, not
  // relative to cwd in any way that affects behavior) — process.cwd() is
  // just a valid directory to satisfy execFile's cwd option.
  await run(process.cwd(), ["clone", url, dir]);
}

export async function checkoutNewBranch(dir: string, branch: string): Promise<void> {
  await run(dir, ["checkout", "-b", branch]);
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  const status = await run(dir, ["status", "--porcelain"]);
  return status.trim().length > 0;
}

export async function getWorkingDiff(dir: string): Promise<string> {
  return run(dir, ["diff"]);
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await run(dir, ["add", "-A"]);
  // Explicit -c identity flags rather than relying on inherited git
  // config — a CI/orchestrator environment may have no configured git
  // user at all, and this shouldn't depend on whatever happens to be on
  // the machine it runs on.
  await run(dir, [
    "-c",
    "user.email=agent@ai-delivery-pipeline.local",
    "-c",
    "user.name=AI Delivery Pipeline Agent",
    "commit",
    "-m",
    message,
  ]);
}

/**
 * Auth passed via a temporary `http.extraheader` config value (scoped to
 * this one command via `-c`, never written to `.git/config`) rather than
 * embedding the token in the remote URL — keeps it out of `git remote -v`
 * output and shell/command history. It's still visible transiently in
 * process args (`ps`) for the duration of the call, which is a real
 * limitation, not enterprise-grade secret hygiene — acceptable for a
 * single-user demo/reference pipeline, not for a genuinely multi-tenant
 * host. See docs/DECISIONS.md.
 */
export async function pushBranch(dir: string, branch: string, githubToken: string): Promise<void> {
  const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`;
  await run(dir, ["-c", `http.extraheader=${authHeader}`, "push", "origin", `HEAD:refs/heads/${branch}`]);
}
