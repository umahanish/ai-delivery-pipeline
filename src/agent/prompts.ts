// Prompt construction for the two agent invocations: implement (+ fix on
// retry) and self-review. Kept as pure string-building functions, separate
// from runCodingAgent.ts, so they're testable without touching the SDK at
// all.

export interface StorySpec {
  title: string;
  description: string;
  acceptanceCriteria: string | null;
  testCommand: string;
}

export function buildImplementPrompt(story: StorySpec): string {
  const criteria = story.acceptanceCriteria?.trim()
    ? `\n\nAcceptance criteria:\n${story.acceptanceCriteria.trim()}`
    : "";

  return [
    `Implement the following backlog item in this repository.`,
    `Read CLAUDE.md first for the repo's conventions before making any change.`,
    ``,
    `Title: ${story.title}`,
    `Description: ${story.description}${criteria}`,
    ``,
    `Requirements:`,
    `- Keep the change scoped to exactly what's asked for — no drive-by refactors.`,
    `- Run \`${story.testCommand}\` yourself and make sure it passes before finishing. Add or update tests as needed.`,
    `- Do not commit, push, or open a pull request — that happens outside this session.`,
    `- Do not run \`git push\` or change git remote/config — you don't have the credentials for it and it isn't your job.`,
  ].join("\n");
}

export function buildFixPrompt(story: StorySpec, previousAttemptOutput: string): string {
  return [
    buildImplementPrompt(story),
    ``,
    `--- Your previous attempt ---`,
    `The last attempt did not pass \`${story.testCommand}\` (verified independently, not just by your own report). Its final output was:`,
    ``,
    previousAttemptOutput,
    ``,
    `Fix the issue. Re-run the tests yourself before finishing.`,
  ].join("\n");
}

/**
 * Asks for a literal "VERDICT: APPROVE" / "VERDICT: REQUEST_CHANGES" line
 * specifically so the caller can parse a reliable machine-readable
 * signal (see parseReviewVerdict in orchestrator/processBacklogItem.ts)
 * instead of pattern-matching free-form prose, which would be fragile in
 * both directions —
 * false negatives on a review that approves in different words, false
 * positives on a review that merely *mentions* the word "approve" while
 * explaining why it isn't approving.
 */
export function buildSelfReviewPrompt(story: StorySpec, diff: string): string {
  const lines = [
    `You are reviewing a code change against the backlog item it's supposed to implement — not writing code this turn.`,
    ``,
    `Backlog item:`,
    `Title: ${story.title}`,
    `Description: ${story.description}`,
  ];
  if (story.acceptanceCriteria?.trim()) {
    lines.push(`Acceptance criteria:\n${story.acceptanceCriteria.trim()}`);
  }
  lines.push(
    ``,
    `Diff to review:`,
    "```diff",
    diff,
    "```",
    ``,
    `Check: does the diff actually satisfy the backlog item and its acceptance criteria? Is it scoped to what was asked (no unrelated changes)? Any obvious bugs?`,
    ``,
    `End your response with exactly one of these two lines, and nothing after it:`,
    `VERDICT: APPROVE`,
    `VERDICT: REQUEST_CHANGES`,
  );
  return lines.join("\n");
}
