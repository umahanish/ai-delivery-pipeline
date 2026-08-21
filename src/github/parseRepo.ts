/**
 * Backlog items' target_repo has been entered both ways in practice
 * ("acme/widgets" during early testing, a full
 * "https://github.com/owner/repo" URL for a real submission) — accept
 * both rather than assuming a single format the UI doesn't actually
 * enforce.
 */
export function parseGitHubRepo(targetRepo: string): { owner: string; repo: string } {
  // Order matters: strip a trailing slash *before* the .git suffix check,
  // or "...repo.git/" never matches /\.git$/ (the slash is in the way) and
  // the .git suffix silently survives into the parsed repo name.
  const trimmed = targetRepo.trim().replace(/\/$/, "").replace(/\.git$/, "");

  const urlMatch = /github\.com[/:]([^/]+)\/([^/]+)$/i.exec(trimmed);
  if (urlMatch) return { owner: urlMatch[1]!, repo: urlMatch[2]! };

  const shortMatch = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (shortMatch) return { owner: shortMatch[1]!, repo: shortMatch[2]! };

  throw new Error(`Could not parse a GitHub owner/repo from target_repo "${targetRepo}"`);
}
