# Project brief: AI Delivery Pipeline

You (Claude Code) own the end-to-end build of this project. Work through it
autonomously in the phases below, committing as you go. Ask the user only
when you hit a genuine external blocker (missing credentials, an API you
can't reach, an ambiguous business rule) — otherwise make a reasonable
decision, note it in `docs/DECISIONS.md`, and keep moving.

## Goal

Let a Product Owner / Project Manager / Scrum Master submit a backlog item
through a small web UI, and have everything downstream happen without
further human input **until a pull request exists**:

1. UI submission creates a JIRA story.
2. When the story is marked ready for development, an orchestrator spins
   up an isolated workspace and runs an AI coding agent against it.
3. The agent's own diff goes through an automated AI review pass before
   anything is pushed.
4. A PR is opened. CI runs tests, a SonarQube scan, and a Nexus IQ scan —
   all required checks.
5. **A human approves the PR.** This is not automated and this brief does
   not automate it later — see "Constraints" below.
6. Merge triggers a deploy-to-staging workflow. Qualys scans the deployed
   staging environment (infrastructure/host scanning happens against a
   running environment, not source code — it cannot be a PR check).
7. The UI reflects each backlog item's status end-to-end (JIRA state → PR
   state → deploy state) so the PM never has to leave it to know where
   something stands.

This is a companion project to `devops-knowledge-mcp` (a sibling
directory) and reuses its patterns where they fit — the JIRA client's auth
handling, the SonarQube/Nexus IQ connector shapes, the "fixtures +
stubbed fetch" connector-testing convention — but is otherwise a separate
system with its own repo, schema, and lifecycle. Don't import code across
the two repos; re-implement the pattern, don't reach across the
filesystem for it.

## Constraints (already decided — do not re-litigate)

These came out of an explicit conversation with the user before this brief
was written. Do not "improve" past them without asking first.

- **A human approves every PR before merge. No exceptions, no
  configuration flag to disable it.** GitHub branch protection on the
  target repo must require at least one human review — this is
  infrastructure this project sets up and must never be able to bypass
  itself. If a future phase is tempted to add an "auto-merge when CI is
  green" option, that is out of scope; flag it in `docs/DECISIONS.md`
  instead of building it.
- **The coding agent runs in an isolated workspace per story** (a
  dedicated git worktree/clone on its own branch), never against a shared
  checkout, and never touches `main` directly. It commits and pushes to
  its own branch only.
- **The target codebase the agent develops against is a dedicated sample
  repo built as part of this project (Phase 2), not a real production
  codebase.** This is a reference/training pipeline; pointing an
  autonomous agent at real production source in its first build is not a
  reasonable default. Swapping the target repo later is a config change,
  not a redesign — keep the orchestrator repo-agnostic enough that this
  is true.
- **Bounded retries everywhere the agent can loop**: the implement → test
  → fix cycle and the self-review → fix cycle each need an explicit max
  iteration count (start at 3). An agent that can't converge in 3 tries
  should stop and mark the story `needs-human`, not spin indefinitely
  burning API budget.
- **Secrets never logged**, same convention as `devops-knowledge-mcp` —
  redact tokens in error logs, `.env` gitignored, `.env.example` lists
  every credential.
- Running the orchestrator for real makes real Anthropic API calls with
  real cost per story, and actually commits/pushes code. Phase 4's own
  tests must not do this — mock the agent invocation the same way
  connectors mock `fetch`.

## Architecture (already decided — do not re-litigate)

```
[Backlog UI] --submit--> [JIRA story created]
                                |
                    (PM marks story "Ready for Dev")
                                |
                                v
                    [Orchestrator: poll/webhook JIRA]
                                |
                    [Isolated git worktree, one per story]
                                |
                    [Coding agent: implement + test, bounded retries]
                                |
                    [Self-review pass: AI review of its own diff]
                                |
                    [Push branch, open PR via GitHub API]
                                |
                    [GitHub Actions: tests, SonarQube, Nexus IQ  <-- required checks]
                                |
                    [Human reviews and approves the PR]  <-- the one manual step
                                |
                    [Merge to main]
                                |
                    [GitHub Actions: deploy to staging]
                                |
                    [Qualys scans the deployed staging environment]
                                |
                    [Backlog UI reflects final status]
```

Store: Postgres (same reasoning as `devops-knowledge-mcp` — one
`backlog_items` table is the source of truth for UI status, cross-
referencing a JIRA key, a GitHub PR number, and a deploy status once each
exists).

Orchestrator: Node/TypeScript, using the Claude Agent SDK to run the
coding agent programmatically (see `docs/AGENT_SDK_NOTES.md`, to be
written in Phase 4 once the exact SDK surface is confirmed against
`claude-api` skill reference material — don't guess at the API shape from
memory before checking it).

## Phase 1 — Foundations

- [x] `docker-compose.yml`: Postgres.
- [x] `src/db/schema.sql` + `src/db/migrations/`: a `backlog_items` table
      (id, title, description, acceptance_criteria, priority, target_repo,
      status, jira_key, pr_number, pr_url, deploy_status, created_at,
      updated_at) and a `pipeline_events` table (backlog_item_id, event_type,
      detail, occurred_at) for an audit trail of what happened when — the
      UI's status view reads from this, not by re-polling JIRA/GitHub live
      on every page load.
- [x] `.env.example`: `DATABASE_URL`, JIRA credentials (reuse
      `devops-knowledge-mcp/.env.example`'s JIRA vars as the template),
      `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, SonarQube/Nexus IQ/Qualys vars
      for the target repo's CI to use.
- [x] Basic scaffolding: TypeScript + Node, `package.json`, a test runner
      (vitest, matching the sibling project).

## Phase 2 — Sample target repo

- [ ] A small, separate sample application (pick something genuinely
      simple — a CLI tool or a tiny REST API, not another MCP server) that
      the coding agent will develop against. Give it its own `CLAUDE.md`-
      style context file describing its conventions, so the agent has
      something to ground its changes in, the same way this repo has one.
- [ ] Push it to its own GitHub repo. Set up branch protection requiring
      PR review + the CI checks Phase 5 will add (add the rule now with
      just "require a review"; CI checks get added to the required list
      once they exist).

## Phase 3 — Backlog UI

- [x] Small web app (Next.js or a plain React + Express API — pick one,
      note the choice) — a form to submit a backlog item (title,
      description, acceptance criteria, priority, target repo) and a list
      view showing every item's current status, reading from
      `backlog_items`. Built as Next.js (App Router) — see
      `docs/DECISIONS.md`.
- [x] On submit: write the row, then create the JIRA story (reuse the
      JIRA REST API auth pattern from `devops-knowledge-mcp`'s
      `src/connectors/jira/client.ts` — Basic auth with email:apiToken —
      but this project only ever *creates* issues, it doesn't sync them
      back in bulk, so don't port the whole connector, just the auth +
      create-issue call). Store the returned JIRA key on the row.
- [x] A visible, explicit "Ready for Dev" action the PM takes on an item
      (button in the UI, or moving the JIRA story to a specific status) —
      submitting a backlog item does not by itself mean "start
      developing this now." Decide which and document it; either is
      reasonable, but it must be a deliberate step, not implicit. Built as
      a button per row (see `docs/DECISIONS.md`).

## Phase 4 — Orchestrator: the coding agent

- [ ] Poll (or webhook, matching the sibling project's pattern) for
      backlog items whose JIRA story entered the "ready" state.
- [ ] For each: create an isolated git worktree on a new branch in the
      Phase 2 sample repo, named from the JIRA key.
- [ ] Invoke the Claude Agent SDK with the story's title/description/
      acceptance criteria plus the target repo's own context file as the
      prompt. Implementation loop: agent edits, runs the repo's own test
      command, iterates up to the bounded retry limit (see Constraints).
- [ ] Self-review pass: a second agent invocation reviewing the diff
      against the acceptance criteria (this can be a genuinely small,
      focused prompt — it doesn't need its own framework). If it flags
      something, loop back into the fix cycle, same bounded retry limit.
- [ ] On success: commit, push, open a PR via the GitHub API, write the PR
      number/URL back onto the `backlog_items` row, log a
      `pipeline_events` entry.
- [ ] On exhausting retries without converging: mark the item
      `needs-human` with the last agent output attached, don't leave it
      silently stuck with no explanation.
- [ ] Tests for this phase mock the agent invocation (no real API calls in
      `npm test`), same convention as every connector in the sibling
      project.

## Phase 5 — CI: automated checks on the PR

- [ ] GitHub Actions workflow on the sample repo, triggered on PR: run
      tests, a SonarQube scan, a Nexus IQ scan. All three are required
      status checks (branch protection, set from Phase 2, gets these
      three added now that they exist).
- [ ] These are quality/security gates, not another chance to write code —
      if a scan fails, the PR sits waiting for a human, it doesn't trigger
      another agent auto-fix loop. (A future project could build that;
      this brief doesn't, to keep the human-approval boundary meaningful —
      see Constraints.)

## Phase 6 — Deploy + Qualys

- [ ] GitHub Actions workflow triggered on merge to main: deploy the
      sample repo to a staging environment. Pick the simplest deployment
      target that makes the demo real without new infra cost/complexity —
      note the choice and why in `docs/DECISIONS.md` (a container on a
      free-tier host, a static deploy target, whatever fits what the
      sample app in Phase 2 actually is).
- [ ] Qualys scan runs against the deployed staging environment (a real
      host/URL to scan), not the source — this is the one gate that
      structurally can't be a pre-merge PR check. Document this
      distinction clearly for anyone who assumes "Qualys scan" means the
      same thing as the SonarQube/Nexus IQ PR checks.
- [ ] Update the `backlog_items` row's deploy status; log a
      `pipeline_events` entry.

## Phase 7 — Status feedback & docs

- [ ] The UI's list view shows, per item: JIRA status, PR status (open /
      changes requested / approved / merged), CI check results, deploy
      status — pulled from `backlog_items`/`pipeline_events`, kept current
      by the orchestrator writing to them at each step (Phases 3-6), not
      by the UI polling three APIs live.
- [ ] `README.md`: setup, how to run the whole pipeline locally, how to
      point it at a different target repo.
- [ ] `docs/DEMO_SCRIPT.md`: submit a backlog item, watch it move through
      every stage, ending at a real PR (and, time permitting, a real
      staging deploy).

## Conventions

- TypeScript, strict mode. No `any` without a comment explaining why.
- Never log or persist raw credentials; redact tokens in error logs.
- Commit after each phase checkbox, not after the whole phase.
- Every external-service integration (JIRA, GitHub, the Agent SDK itself)
  gets fixtures/stubbed-call tests, not live-API tests, in `npm test` —
  same reasoning as `devops-knowledge-mcp`'s connectors.
