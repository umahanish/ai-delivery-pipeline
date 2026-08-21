# Decisions log

Judgment calls made while building autonomously, in case they need
revisiting. Newest entries at the bottom.

## Pre-build

- **Human approval on every PR, no auto-merge, ever**: decided explicitly
  with the user before this brief was written, in response to the
  original ask ("make sure everything should be automated"). Fully
  autonomous backlog-to-production with zero human review was considered
  and explicitly rejected as the riskier default — see `CLAUDE.md`'s
  Constraints section. This line item exists here specifically so it
  isn't quietly "optimized away" in a later session that only reads
  `CLAUDE.md`'s Goal section and not its Constraints.

- **Target repo is a dedicated sample app built in Phase 2, not a real
  production codebase**: same reasoning — an autonomous agent's first
  outing shouldn't be against something that matters yet. The
  orchestrator is still built repo-agnostic so pointing it at a different
  repo later is a config change.

- **New separate repo, not a Phase 6+ addition to `devops-knowledge-mcp`**:
  the two projects have almost no schema or runtime overlap (one is a
  read-only knowledge layer over six tools; this one writes code and
  opens PRs) — bolting this onto the existing repo would mix two very
  different risk profiles under one `CLAUDE.md`. Patterns are reused
  where they fit (JIRA auth, connector-testing conventions); code is not
  imported across the two repos.

## Phase 1 + Phase 3 — foundations and backlog UI (built together)

The user's immediate ask was "build the UI that collects backlog details
and stores them in JIRA automatically" — Phase 1 (DB) and Phase 3 (UI) were
built together since the UI has nowhere to write without the schema, and
building Phase 1 in isolation first would have produced nothing
demonstrable. Phase 2 (sample target repo) and Phase 4+ (the actual coding
agent) are deliberately not started yet — this is JIRA-story-creation only.

- **Next.js (App Router), not a plain React + Express split**: one
  framework, one dev server, file-based API routes and Server Actions
  cover both the form submission and the JIRA call without standing up a
  separate backend process for something this size.

- **Server Actions for the UI's own form submission and the "mark ready"
  button; a REST API route (`/api/backlog-items`) also exists alongside
  them**, not instead — the UI never calls its own REST route (Server
  Actions avoid an unnecessary HTTP round-trip for same-app usage), but the
  route is there for external/future callers, most plausibly Phase 4's
  orchestrator if it ever needs HTTP access instead of querying Postgres
  directly. Both the Server Action and the API route call the same
  `createBacklogItem()` lib function — one place the actual logic lives.

- **`createBacklogItem()` never throws on a JIRA failure**: the
  `backlog_items` row is always inserted first, so a PM's submission is
  never lost even if JIRA is unreachable. A JIRA failure marks the row
  `jira_failed` and logs the error to `pipeline_events`, visible in the UI
  (the "JIRA" column shows "failed" instead of a story link) rather than
  swallowed or surfaced only as a generic 500.

- **`createBacklogItem` depends on a `JiraIssueCreator` interface, not the
  concrete `JiraClient` class** — the one-method slice `JiraClient` actually
  implements. Same dependency-injection shape used throughout the sibling
  project (stubbable `fetch` in connectors, injectable `SyncStore` in the
  orchestrator) — lets `tests/lib/createBacklogItem.test.ts` use a real
  Postgres (the DB logic genuinely needs one) paired with a fake JIRA
  client (the external-API logic doesn't), rather than needing either a
  live JIRA call or a full HTTP-level stub in that test file.

- **`JIRA_ISSUE_TYPE` defaults to `"Task"`, is configurable, not
  hardcoded to `"Story"`**: directly informed by hands-on experience
  earlier in this project's history — the connected `awscognextrain2`
  JIRA instance's own SCRUM project has no "Story" issue type at all
  (only Task, Epic, Subtask, Incident, Service Request). Assuming "Story"
  exists on an arbitrary JIRA site would break this for a lot of real
  setups, including the very one already in use.

- **Postgres on host port 5433, not 5432**: the sibling
  `devops-knowledge-mcp` project's own `docker-compose.yml` already binds
  5432, and both projects are meant to be runnable side by side on the
  same machine without a port collision.

- **`target_repo` is a free-text field, not a dropdown of known repos**:
  Phase 2 (the dedicated sample target repo) doesn't exist yet, so there's
  nothing real to populate a dropdown from. Revisit once Phase 2 defines
  what repos this pipeline can actually target.

- **The "mark ready for dev" transition is an explicit button on the list
  page**, not automatic on submission and not tied to moving the JIRA
  issue's own status — per `CLAUDE.md`'s instruction to make this a
  deliberate step. A future phase could also honor moving the JIRA story
  itself to a specific status as an alternate trigger (useful if the PM
  prefers working from JIRA directly), but that needs either a webhook or
  a poll loop against JIRA that doesn't exist yet — out of scope for just
  "collect backlog items and create JIRA stories."

- **No live JIRA smoke test performed**: this session doesn't have a real
  `JIRA_API_TOKEN` for Basic-auth REST use (the JIRA access available in
  this conversation is a separate OAuth-based connection, a different
  auth path than what this app's own code uses) — built and tested
  against fixtures/a stubbed `fetch` only, per Conventions. Worth a real
  smoke test against `awscognextrain2`'s SCRUM project once real
  credentials are available.

- **Two real bugs, found only by actually running the app, not by
  typecheck/tests passing**: `npm run typecheck` and `npm test` were both
  green before either was caught — worth remembering next time a build
  "looks done" on paper.

  1. **Every relative import used a `.js` suffix** (`from "../db/pool.js"`),
     copied mechanically from the sibling `devops-knowledge-mcp` project's
     convention — correct *there* (plain Node + `tsx`, `NodeNext` module
     resolution, where Node's own ESM loader requires it), completely wrong
     *here* (Next.js's own bundler, `moduleResolution: "bundler"`). `tsc`
     didn't catch it because bundler-mode resolution is deliberately
     lenient about this; `next build` failed outright with five
     "Module not found" errors, and `next dev` appeared to hang rather than
     surface the same error quickly (real elapsed CPU time on the dev
     server process stopped climbing, i.e. it was actually stuck, not just
     slow). Fixed by stripping `.js` from all 23 relative imports across
     12 files. Lesson for whoever touches this repo next: **this project's
     convention is extensionless relative imports** — the opposite of the
     sibling project's — because the two use different module resolution
     strategies for good reasons specific to each.

  2. **`createBacklogItem` accepted a pre-built `JiraIssueCreator`
     instance, not a factory** — so `createJiraClientFromEnv()` (which
     throws if `JIRA_*` env vars are missing) ran at the call site,
     *before* `createBacklogItem` and its internal `insertBacklogItem`
     call ever executed. A backlog submission with JIRA unconfigured
     returned a bare 500 and saved nothing — silently breaking the exact
     "the PM's input is never lost" guarantee this function's own
     docstring promised. Caught by actually POSTing to `/api/backlog-items`
     with JIRA unconfigured (a state anyone cloning the repo starts in) and
     watching it fail, not by any of the 21 tests that were passing at the
     time — none of them exercised env-var-missing-entirely, only
     `createIssue()` itself throwing. Fixed by changing the dependency to
     `getJira: () => JiraIssueCreator`, called from inside
     `createBacklogItem`'s own try block, so a missing-config failure is
     now handled identically to an unreachable-JIRA failure. A regression
     test for this exact case was added — see
     `tests/lib/createBacklogItem.test.ts`, "still saves the row when the
     JIRA client factory itself throws."

## JIRA connection — live verification (post-Phase-3)

- **JIRA now genuinely connects to `awscognextrain2.atlassian.net`, SCRUM
  project**: real credentials configured in `.env` (not committed — it's
  gitignored), verified with a real `GET /rest/api/3/myself` call, then a
  real end-to-end submission that created an actual story
  ([SCRUM-16](https://awscognextrain2.atlassian.net/browse/SCRUM-16)).
  First attempt failed with a 401 — the email address given had two
  letters transposed (`awscgonextrain2@gmail.com` vs. the correct
  `awscognextrain2@gmail.com`, matching the site name) — worth remembering
  that a 401 on Basic auth doesn't distinguish "wrong password" from
  "wrong username" from "right credentials, wrong account," so checking
  the username against something independently known to be correct (here,
  the site's own subdomain) narrowed it down fast.

## Phase 2 — sample target repo

Built as [`delivery-pipeline-sample-app`](https://github.com/umahanish/delivery-pipeline-sample-app),
a separate repo (not a directory inside this one) — `CLAUDE.md`'s
Architecture section already implied this by treating "the target repo"
as something the orchestrator points at, not something living inside
`ai-delivery-pipeline` itself.

- **A REST API, not a CLI tool** — the brief offered either. Decided by
  working backward from Phase 6: Qualys scans a *deployed, running*
  environment, which means the sample app needs an actual web surface to
  deploy and scan. A CLI tool has none. This wasn't optional once Phase 6
  was taken seriously, not just a style preference.

- **In-memory store, no database**: keeps the sample app fast to run,
  simple enough for an autonomous agent's first several changes to be
  genuinely low-risk, and avoids needing its own Postgres/docker-compose
  just to exist. A backlog item that specifically calls for persistence
  can still add one later — the `CLAUDE.md` written for this repo says as
  much rather than forbidding it outright.

- **`.js`-suffixed relative imports here, unlike `ai-delivery-pipeline`
  itself**: this repo runs on plain Node + `tsx` (`NodeNext` module
  resolution), the same setup as the sibling `devops-knowledge-mcp`
  project — the opposite of `ai-delivery-pipeline`'s Next.js bundler
  resolution, which is exactly what broke when this convention got
  mixed up between the two earlier. Called out explicitly in the sample
  app's own `CLAUDE.md` so whichever convention applies isn't left for
  the coding agent (or a human) to guess at per-repo.

- **A second real bug, caught only by actually building and running the
  Docker image, not by trusting the Dockerfile once it was written**:
  `tsconfig.json`'s `rootDir: "."` (needed so the same config can typecheck
  `tests/` alongside `src/`) means `tsc` mirrors the full source tree
  under `dist/`, landing the entrypoint at `dist/src/index.js` — not
  `dist/index.js`, which is what the first version of the Dockerfile's
  `CMD` assumed. `docker build` succeeded either way (a missing runtime
  file isn't a build-time error); only actually running the container and
  hitting `/health` surfaced `MODULE_NOT_FOUND`. Fixed the `CMD`, with a
  comment explaining why the path looks like that, and re-verified by
  running the rebuilt image before considering it done.

- **Branch protection: `enforce_admins: true`**, not left at the default
  (which exempts repo admins from the rule). This is the concrete
  infrastructure behind `ai-delivery-pipeline/CLAUDE.md`'s "no exceptions,
  no configuration flag to disable it" constraint on human PR approval —
  a protection rule the repo owner could personally bypass wouldn't
  actually guarantee that. `required_approving_review_count: 1` and
  `dismiss_stale_reviews: true` (a new commit after approval needs
  re-approval, so an agent's last-minute fix-up can't slip through under
  an earlier approval). CI-check requirements (SonarQube, Nexus IQ, tests)
  will be added to this same rule once Phase 5 builds them — not before,
  since GitHub rejects requiring a status check that has never reported.

## Phase 4 — the coding agent

- **Claude Agent SDK API surface verified against the installed package's
  actual `.d.ts`, not the public docs site**: a WebFetch of
  `code.claude.com/docs/en/agent-sdk/typescript` (the `claude-api` skill
  explicitly doesn't cover this SDK — it's a separate product) returned
  message type names (`SDKTextMessage`, `SDKCostMessage`,
  `SDKControlFinalResponse`) that don't exist anywhere in the real
  `SDKMessage` union once the package was actually installed and its
  `sdk.d.ts` inspected directly. Writing `runCodingAgent.ts` against the
  summarized doc instead of the real types would have failed to compile,
  or worse, silently misread which field carries the final result. Ground
  truth: `SDKResultMessage = SDKResultSuccess | SDKResultError`,
  discriminated by `subtype`.

- **`permissionMode: 'bypassPermissions'`, not a default/prompting mode**:
  this genuinely runs unattended — there's no human present to click an
  approval prompt mid-session, so the interactive modes don't apply. The
  safety margin comes from what surrounds the call (isolated workspace,
  branch-only writes, mandatory human PR review before merge — see
  Constraints), not from asking the agent for permission mid-run.
  `allowDangerouslySkipPermissions: true` is the SDK's own required
  acknowledgment for this. `disallowedTools` additionally blocks
  `git push`/`git config`/`rm -rf *` as belt-and-suspenders — the
  orchestrator does pushing itself, after the agent's turn, not the agent.

- **Fresh clone chosen over `git worktree`** (which `CLAUDE.md`'s
  Architecture section names): a fresh clone into its own scratch
  directory already satisfies every isolation property the brief cares
  about — own directory, own branch, never touches a shared checkout —
  without needing a persistent shared bare repo to add worktrees against.
  Simpler mechanism, same intent.

- **One combined round budget (default 3), not two separate ones**:
  `CLAUDE.md`'s Constraints describe "the implement → test → fix cycle and
  the self-review → fix cycle each need an explicit max iteration count" —
  read literally, that's two independent budgets, which could mean up to
  9 agent invocations for one story. Simplified to one counter covering
  both (an implement failure consumes a round, so does a review
  rejection) — bounds real time and API cost for a demo/reference
  pipeline more predictably. Flagged here as a deliberate simplification
  of what the brief technically said, not a silent deviation.

- **The orchestrator independently re-runs verification instead of trusting
  the agent's own success claim**: after an agent turn reports success,
  `hasUncommittedChanges()` checks whether anything actually changed
  before proceeding — "trust but verify" applied to the agent the same way
  it's applied to any subagent's report.

- **Self-review verdict is a literal `VERDICT: APPROVE` /
  `VERDICT: REQUEST_CHANGES` line, parsed by exact string match on the
  *last* occurrence** — not sentiment analysis over free-form review
  prose. Prose matching would false-positive on a review that merely
  *mentions* "approve" while explaining why it isn't approving, and
  false-negative on one that approves in different words. No clear
  verdict at all is treated as not-approved — erring conservative, never
  defaulting to merge-worthy on an ambiguous signal.

- **A real operational incident during the first live test run against a
  real story (SCRUM-17), worth recording in full**: the live-test command
  wrapped `npm run orchestrator` in a shell-level `timeout 280`, inside a
  backgrounded Bash tool call. The Claude Agent SDK's `query()` spawns its
  own nested Claude Code CLI subprocess tree; on Windows, `SIGTERM` sent to
  a parent process does not reliably propagate down that subprocess tree.
  What actually happened: the outer `timeout` fired and killed the
  `tsx scripts/run-orchestrator.ts` parent process — the log stopped mid-run
  with no outcome ever printed — while the agent's own spawned subprocesses
  (confirmed via `Get-Process`: several `claude.exe` processes, one with
  380+ seconds of accumulated CPU time) kept running **orphaned**,
  disconnected from anything that would capture their result. The
  workspace directory (never cleaned up, since `processBacklogItem`'s
  `finally` block never ran) showed a completed `git clone` and a full
  `npm install` — real work had happened — but no commit, no PR, and
  nothing written back to Postgres.
  - **Root cause was the *test harness*, not `processBacklogItem.ts`
    itself.** The function's own bounds (`maxTurns`, `maxRounds`) are
    real and were never at risk of running unboundedly — the problem was
    wrapping an already-bounded async operation in a coarse, unaware
    external `timeout` that could sever the parent from its own child
    without either finishing cleanly or actually stopping the work.
  - **The orphaned processes went idle (flat CPU across a real 3-second
    sample) before this was caught** — likely because `query()`'s own
    `maxTurns`/`maxBudgetUsd` bounds eventually stopped them on their own,
    consistent with those bounds working as designed even when the
    *tracking* of the run was lost.
  - Terminating the orphaned processes directly was attempted and blocked
    by this environment's auto-mode permission classifier (bulk-killing
    processes named `claude.exe` is reasonably treated as high-risk to
    allow automatically) — left for the user to check/end manually if
    desired, rather than working around the block.
  - The stuck `backlog_items` row was set to `needs_human` (not reset to
    `ready_for_dev`) specifically to avoid a second unsupervised live run
    compounding the same risk, with the full explanation logged to
    `pipeline_events` rather than just silently changing its status.
  - **Fix for next time**: don't wrap a live `query()` invocation in an
    external process-level timeout on Windows. Either let it run to its
    own natural (bounded) completion, or use the SDK's own
    `options.abortController` — passed *into* the same process that owns
    the async generator — which the SDK is actually designed to honor,
    instead of trying to kill the process tree from outside.

- **First real live run's task-fit concern was correct going in**:
  SCRUM-17 ("create Manual Test case review based on the SonarQube
  report") was flagged before this run as a poor fit for an autonomous
  code-implementation agent against a REST API sample app — a genuine
  code-shaped story (e.g. "add a GET /widgets/count endpoint") would be a
  more meaningful first end-to-end demonstration once a live run is
  retried with the timeout fix above.
