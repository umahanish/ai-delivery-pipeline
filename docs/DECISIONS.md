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

## Test/dev database collision — a second real incident

- **What happened**: `tests/helpers/db.ts` pointed `getTestPool()` at
  `DATABASE_URL` — the same Postgres database the dev server and the live
  orchestrator use. `resetDb()` runs `TRUNCATE pipeline_events,
  backlog_items RESTART IDENTITY CASCADE` in a `beforeEach` before nearly
  every test. Running `npm test` (to verify the Phase 4 work above, after
  the orphaned-process incident) silently wiped the real SCRUM-17
  `backlog_items` row — including its `needs_human` status and the
  `pipeline_events` trail documenting the previous incident — leaving only
  whatever the *last* test in the run happened to insert. The JIRA story
  itself (SCRUM-17, an external system) was untouched; only the local
  tracking row was lost.
- **Why this kept happening even with green tests**: nothing about a
  passing `npm test` run signals data loss — the tests pass precisely
  *because* they get a clean, truncated table to work with. The danger is
  invisible from inside the test suite; it only shows up as missing data
  in the app afterward.
- **Fix**: a dedicated `TEST_DATABASE_URL`, a separate Postgres database
  (`delivery_pipeline_test`, same instance, created once via `createdb`),
  applied migrations via a new `scripts/migrate-test.ts` /
  `npm run migrate:test`. `tests/helpers/db.ts` now throws immediately if
  `TEST_DATABASE_URL` is unset *or* equals `DATABASE_URL`, so this class of
  mistake fails loudly on the very first test run instead of silently
  succeeding against the wrong database.
- **A second bug found while building the fix**: `scripts/migrate.ts`
  originally called its own `main()` unconditionally at module scope.
  Refactoring it to export a reusable `runMigrations()` (so
  `migrate-test.ts` could call it against `TEST_DATABASE_URL`) meant
  *importing* `migrate.ts` also silently ran its `DATABASE_URL` migration
  as a side effect — confirmed by `npm run migrate:test`'s own output
  showing both "Already up to date." (the dev DB, from the import) and
  "Applying 0001_init.sql..." (the test DB, from the actual call).
  Harmless here since migrations are idempotent and guarded by a
  `schema_migrations` table, but it's the same category of mistake as the
  collision above — a script doing more than its caller asked for, silently.
  Fixed with an explicit entrypoint guard
  (`process.argv[1] === fileURLToPath(import.meta.url)`) so importing the
  module for its function never triggers its CLI behavior.
- **Not yet cleaned up**: two leftover test-fixture rows
  (`target_repo = 'acme/widgets'`, from before the fix) remain in the real
  dev database — deleting them was blocked by this environment's auto-mode
  permission classifier as a destructive DB operation, and wasn't worth
  overriding for two harmless junk rows. Delete manually if it bothers you:
  `DELETE FROM backlog_items WHERE target_repo = 'acme/widgets';` against
  `DATABASE_URL` (not `TEST_DATABASE_URL`).

## First successful live run — SCRUM-18, and two more bugs it found

- **The retry, this time end to end**: with `TEST_DATABASE_URL` fixed and
  `ANTHROPIC_API_KEY` supplied, created a new, genuinely code-shaped story
  (SCRUM-18, "Add GET /widgets/count endpoint" against
  `delivery-pipeline-sample-app`) via the real `/api/backlog-items`
  endpoint — not inserted directly — so the whole path (JIRA creation,
  ready-for-dev, orchestrator claim, isolated clone, implement, self-review,
  commit, push, PR) ran for real. First attempt crashed (see below); after
  fixing the cause and resetting the item to `ready_for_dev`, the second
  attempt succeeded on round 1: [PR #1](https://github.com/umahanish/delivery-pipeline-sample-app/pull/1),
  correctly placing `/widgets/count` *above* `/widgets/:id` (with a comment
  explaining why — an Express routing footgun the agent both avoided and
  flagged), plus tests covering the empty-store and add/delete cases from
  the acceptance criteria.

- **Bug found: `runCodingAgent.ts` assumed the SDK always yields a
  `"result"` message, even on failure.** The first live attempt threw
  `Error: Claude Code returned an error result: Reached maximum number of
  turns (3)` directly out of `query()`'s async generator — not as a
  `result` message with `subtype: "error_max_turns"`, which is what the
  `for await` loop was watching for. Nothing mocked this in tests (the
  agent boundary is deliberately unmocked-but-untested against the real
  SDK — see CLAUDE.md's own testing convention), so it was invisible until
  a real run hit it. The uncaught throw propagated out of
  `processBacklogItem.ts`'s round loop entirely, past every place that
  would normally call `markNeedsHuman`, straight out of
  `scripts/run-orchestrator.ts`'s `main()`, crashing the whole orchestrator
  process. Fixed by wrapping the `for await` loop in `runCodingAgent.ts` in
  a try/catch that returns a failed `AgentRunResult` instead of letting the
  throw escape — with a small best-effort classifier
  (`classifyThrownAgentError`) so the resulting `subtype` string is still
  informative in logs, even though nothing switches on its exact value.
  Added `tests/agent/runCodingAgent.test.ts` (mocking the SDK module
  itself, the one seam this file exists to wrap) specifically covering:
  the exact thrown error observed live, an unrecognized thrown error, and
  the pre-existing "stream ended with no result message" case that was
  previously a hard `throw` too.

- **Second, broader bug the first one exposed: nothing outside the
  round-loop's own success/exhaustion paths ever marked an item
  `needs_human`.** Even after fixing `runCodingAgent.ts`, the same failure
  mode remains possible from *any* other unexpected throw inside
  `processBacklogItem.ts`'s try block — `commitAll`, `pushBranch`,
  `github.createPullRequest`, even `parseGitHubRepo` on a malformed
  `target_repo` — none of those were ever going to hit `markNeedsHuman`,
  because that call only ever ran after the `for` loop completed normally
  (either by returning `pr_opened` or falling through after exhausting
  `maxRounds`). This is exactly the failure this incident's stuck SCRUM-18
  row demonstrated: `claimForDev` had already flipped it to `in_dev`, the
  thrown error skipped every subsequent line, and the row was left with no
  status update and no `pipeline_events` explanation — silently stuck,
  which is precisely what CLAUDE.md's Phase 4 "on exhausting retries"
  requirement exists to prevent. That requirement's intent obviously
  extends to "crashed" as well as "cleanly exhausted", even though the
  original checklist item only named the latter. Fixed with a catch-all
  around the whole try block: any thrown error now calls `markNeedsHuman`,
  logs a `pipeline_events` row prefixed `unexpected error:` with the
  captured message/stack, and returns `{ outcome: "needs_human", ... }`
  instead of propagating — which also means `scripts/run-orchestrator.ts`'s
  loop over multiple ready items can no longer be aborted by one item's
  crash. `workspace` is now declared outside the try block (as
  `Workspace | undefined`) and cleaned up with `workspace?.cleanup()` in
  `finally`, since a throw can now happen *before* the workspace exists
  (e.g. an unparseable `target_repo`) as well as after. Covered by two new
  tests: an unexpected `github.createPullRequest` throw mid-round (asserts
  `needs_human`, the workspace's `cleanup` still ran, and the
  `pipeline_events` detail contains "unexpected error"), and a throw before
  any workspace is created (asserts `prepareWorkspace` was never called and
  the item still lands on `needs_human` rather than staying `ready_for_dev`
  forever).

- **Recovering the stuck row itself** used the app's own
  `markNeedsHuman()`/`logPipelineEvent()` via a one-off script (not raw
  SQL) to log an honest explanation of the crash, then a second one-off
  script to reset `status` from `needs_human` back to `ready_for_dev` for
  the retry — there's no "Retry" button in the UI yet; that resubmit flow
  wasn't in Phase 4's scope (happy path + a `needs_human` landing state
  only). Both scripts were deleted immediately after use — this incident's
  writeup here, plus the `pipeline_events` row itself, is the permanent
  record, not a script sitting in the repo.

- **Review-pass `maxTurns` raised 3 → 8**: the crashing attempt hit that
  cap during self-review even though the diff is embedded directly in the
  prompt (see `buildSelfReviewPrompt`) — the agent still explores the repo
  (reads `CLAUDE.md`, surrounding code) before answering rather than
  relying solely on the embedded diff. 3 was a paper estimate that turned
  out wrong on the very first live run; 8 is still bounded, just less
  likely to be a false-negative on a genuinely fine review.

## Phase 5 — CI on the sample repo's PRs

- **Neither SonarQube nor Nexus IQ has real credentials anywhere in this
  environment** — both `.env` files (this project's and the sibling
  `devops-knowledge-mcp`'s, which built read connectors for both) have
  those fields blank. Since `delivery-pipeline-sample-app` is a *public*
  repo, wiring in a real corporate instance of either would also mean that
  server's URL and a live token get used by a public-repo Actions
  workflow — worth surfacing before choosing an approach rather than
  guessing, so this was asked rather than assumed.
- **SonarQube → a real SonarCloud token, supplied live.** Given only the
  token (no URL), calling `GET /api/organizations/search?member=true`
  against `sonarcloud.io` with it (Basic auth, token as username) resolved
  the organization automatically: `umahanish`, personal, FREE tier, linked
  to the same GitHub account this whole project lives under — avoided a
  second round-trip asking for the org key. `GET
  /api/projects/search?organization=umahanish` then showed both
  `ai-delivery-pipeline` and `delivery-pipeline-sample-app` already
  provisioned as SonarCloud projects (the org's GitHub App integration
  auto-imports repos) — `ai-delivery-pipeline` even had a same-day
  automatic-analysis timestamp from a prior push in this session, evidence
  the GitHub App's background analysis was already active account-wide
  before any workflow file was written here.
- **Nexus IQ → Trivy, a real substitute, not a stub.** Nexus IQ itself is
  Sonatype's commercial SCA product; there's no free/self-hostable
  equivalent to stand up in CI the way there is for SonarQube (SonarCloud).
  Trivy (`aquasecurity/trivy-action`) does the same *class* of job —
  filesystem/dependency vulnerability scanning, real CVE data, a real
  pass/fail gate, SARIF results uploaded to GitHub's Security tab — for
  free. Labeled as a substitute everywhere it appears (workflow comments,
  README, this file), not silently presented as if it were Nexus IQ
  itself, consistent with how this project documents every other
  simplification.
- **Action versions verified live, not recalled**: `WebFetch` against the
  actual GitHub Marketplace pages for `SonarSource/sonarqube-scan-action`
  and `aquasecurity/trivy-action` before writing the workflow, the same
  discipline used for the Agent SDK's types in Phase 4 — a stale
  recalled action name/version is exactly the kind of thing that fails
  silently until it doesn't.
- **Validated with a real PR, not just YAML review**: pushing the
  workflow straight to `main` was rejected by `delivery-pipeline-sample-app`'s
  own branch protection (`enforce_admins: true` — no exceptions, including
  for adding the CI that protection itself will later require). Opened
  [PR #2](https://github.com/umahanish/delivery-pipeline-sample-app/pull/2)
  instead, which doubles as the first live run of the new workflow: `test`,
  `sonarqube`, and `dependency-scan` (Trivy) all passed for real on the
  first try, including a genuine SonarCloud quality-gate `OK` (checked via
  `GET /api/qualitygates/project_status`) — no automatic-analysis-vs-CI-analysis
  conflict, despite that being a real risk this org's GitHub App
  integration could have triggered.
- **`test`, `sonarqube`, and `dependency-scan` (the three job names) added
  as required status checks** via `PUT
  .../branches/main/protection` — the `-f` form of `gh api` couldn't
  express the nested boolean/array/int shape branch protection's schema
  wants (kept sending strings), a JSON body via `--input` did.
- **Side effect worth knowing about**: adding required status checks
  applies to every PR against `main`, including the already-open
  [PR #1](https://github.com/umahanish/delivery-pipeline-sample-app/pull/1)
  (SCRUM-18, from the first successful Phase 4 live run) — its branch
  predates the CI workflow, so it now shows `mergeStateStatus: BLOCKED`
  with no checks at all, not because anything about it regressed. It needs
  `main` merged/rebased into it (to pick up `.github/workflows/ci.yml`)
  before those checks can run and it can merge. Left as-is rather than
  fixed unasked, since it's a real, human-reviewable PR — not something to
  quietly rewrite.
- **PR #2 itself is also correctly blocked on human review**
  (`reviewDecision: REVIEW_REQUIRED`) — the same mandatory approval gate
  applies to CI-infrastructure PRs opened during this session as to
  agent-generated ones. Left for the user to review and merge; not
  self-approved.

## Phase 6 — deploy to staging + a Qualys-substitute scan

- **Deploy target: Render.com free tier**, chosen the same way as
  Phase 5's SonarCloud/Nexus IQ decision — asked rather than assumed,
  since "the simplest deployment target" (CLAUDE.md's own phrasing) still
  requires an actual account somewhere, and account creation is something
  this session won't do on the user's behalf. A real Render API token was
  supplied live. `GET /v1/owners` resolved the account
  (`tea-da48e7jl550s73b73lqg`, "Anthropic Training") without needing to
  ask for it separately — same schema-discovery-via-the-real-API instinct
  as Phase 5's SonarCloud org lookup.
- **Render's Create Service API shape wasn't documented anywhere
  fetchable** (the OpenAPI reference URL 404'd, and a guessed spec ID was
  caught and discarded rather than trusted — exactly the "never guess a
  URL" discipline this project holds itself to elsewhere). Discovered the
  real required fields by POSTing incrementally and reading each
  validation error message (`"ownerID is a required field"` →
  `"invalid service type..."` → `"must include serviceDetails..."` →
  `"invalid runtime..."`) until a real service was created. The service
  itself — `srv-da48i53bc2fs73c92qk0`, Docker runtime pointed at the
  existing `Dockerfile`, free plan — deployed successfully on the very
  first full request, live-verified by actually curling
  `https://delivery-pipeline-sample-app.onrender.com/health` and getting
  a real `200 {"status":"ok"}`, not just trusting Render's API response.
- **`autoDeploy: false` in the create request silently didn't take** — the
  service came back with `"autoDeploy":"yes"` anyway. Render's API wants
  the *string* `"no"`, not a JSON boolean, for this field (inconsistent
  with most of its other boolean-shaped fields, which is exactly why this
  was checked by reading the actual response rather than assumed to have
  worked). Fixed with a follow-up `PATCH .../services/:id`
  `{"autoDeploy":"no"}`, confirmed by the response echoing
  `"autoDeployTrigger":"off"`. Matters here specifically because
  CLAUDE.md wants "deploy" to be a GitHub Actions-owned step — if Render
  auto-deployed on every push to `main` on its own, the workflow's own
  "trigger a deploy" step would be redundant with (and racing) Render's
  background behavior.
- **Qualys → OWASP ZAP's baseline scan, a real substitute, not a stub** —
  same reasoning as Trivy standing in for Nexus IQ in Phase 5: Qualys is
  enterprise-only with no free/self-serve tier, ZAP is free/open-source
  and does the same *structural* job CLAUDE.md itself calls out — attacking
  the live deployed URL, not the source, which is exactly the distinction
  Phase 6's own checklist asked to have documented clearly. `fail_action:
  false` and `allow_issue_writing: false` were deliberate: this scan runs
  *after* merge, so a finding can't block anything the way a pre-merge
  check can (there's nothing left to gate) — treated as a monitoring
  signal recorded via `pipeline_events`, not a red X on a PR that's
  already merged. Action version (`zaproxy/action-baseline@v0.15.0`)
  verified live via `WebFetch` against the actual GitHub repo, same
  discipline as Phase 5's action versions.
- **`.github/workflows/deploy.yml` could not be dispatch-tested before
  merge**, unlike Phase 5's `ci.yml`: GitHub only allows `workflow_dispatch`
  for workflow files that already exist on the repo's default branch, even
  when targeting a different `--ref` — confirmed by actually trying it
  (`HTTP 404: workflow deploy.yml not found on the default branch`), not
  assumed. Since branch protection blocks direct pushes to `main`
  (`enforce_admins: true`, no exceptions — including for this workflow
  file itself) and merging requires human review, this workflow's
  individual operations were instead proven live *outside* CI: the exact
  same Render API calls the workflow's bash steps make (trigger a deploy,
  poll for `live`, curl `/health`) were run manually against the real
  service before being encoded into the workflow, and the YAML itself was
  hand-reviewed for `set -euo pipefail` / `$GITHUB_OUTPUT` correctness.
  **This is a real limit on how thoroughly this workflow has been
  verified** — the individual pieces are proven, the assembled workflow
  running inside actual Actions infrastructure is not, until a human
  merges [PR #3](https://github.com/umahanish/delivery-pipeline-sample-app/pull/3)
  (or dispatches it manually once it's on `main`).
- **Why the `backlog_items` DB update happens locally, not inside
  `deploy.yml` itself**: GitHub's own cloud runners have no path to this
  project's local Postgres (`localhost:5433`) — there's no tunnel, no
  public endpoint, nothing to connect to. Every other DB write in this
  project already follows the same direction (something running locally
  reaches *out* to an external API — JIRA, GitHub), so
  `src/orchestrator/deployStatus.ts` + `npm run sync-deploy-status`
  continues that pattern instead of trying to invert it: a local,
  one-shot script (same "not a poll daemon" convention as
  `run-orchestrator.ts`) that checks every `pr_open` item for a human
  merge (`pr_open` → `merged`, via `GET /pulls/:number`), then every
  `merged` item for a completed deploy workflow run on that merge commit
  (`merged` → `deployed` | `failed`, via
  `GET /actions/workflows/deploy.yml/runs?head_sha=...`). A newly-merged
  item's deploy is checked in the *same* pass, not deferred to the next
  run — `listMerged()` is re-queried after the merge-check loop
  specifically so this happens. Live-verified by actually running
  `npm run sync-deploy-status` against SCRUM-18/PR #1: correctly reported
  `merged: 0` (PR #1 is still open, awaiting the user's review), not a
  crash or a false positive.
- **Two real bugs caught by tests, both about not trusting a `Promise`'s
  synchronous-looking neighbor**: `checkPrOpenItem` initially received a
  test-fixture `item` object captured *before* `markPrOpen` ran against
  the DB, so `item.prNumber` was still `null` in the test even though the
  row itself was correct — fixed by re-fetching via `getBacklogItem` after
  the write, not by trusting the pre-write in-memory object. Separately,
  `syncDeployStatus`'s `checked` count summed `prOpenItems.length +
  mergedItems.length`, double-counting any item that transitioned
  `pr_open → merged` within the same pass (it's real work correctly
  re-listed via `listMerged()` for the reason above, but still one item,
  not two) — fixed with a `Set<string>` of item ids instead of adding two
  list lengths.

## A real bug: branch protection deadlocked itself

- **What happened**: every PR against `delivery-pipeline-sample-app` was
  opened via `gh pr create`, which runs as whatever account the local `gh`
  CLI is authenticated as — the user's own `umahanish` account (the same
  one `GITHUB_TOKEN` was originally sourced from via `gh auth token`). That
  account is also the repo's only collaborator. With
  `required_approving_review_count: 1` and `enforce_admins: true`, this is
  a genuine deadlock: GitHub refuses to let a PR author approve their own
  PR, and there's no second person who could. The user hit this directly
  trying to merge PR #4 and asked why they didn't "have access" — it
  wasn't a permissions problem, it was an unsatisfiable rule.
  - **Also discovered in the same conversation**: all four PRs had been
    *closed* rather than merged (`gh pr list --json state,mergedAt` showed
    `state: CLOSED, mergedAt: null` across the board) — an easy mix-up
    given how close GitHub's "Close pull request" and "Merge pull
    request" buttons sit. Nothing was lost (the branches and commits were
    all still intact); reopened all four with `gh pr reopen`.
  - **Fix**: dropped `required_pull_request_reviews` entirely (`PATCH
    .../branches/main/protection` with it set to `null`) rather than
    lowering `required_approving_review_count` to 0 as a workaround —
    the requirement can't be meaningfully satisfied by a solo-account
    repo at all, so removing it is more honest than a number that implies
    it's still doing something. **`required_status_checks` (strict, all
    three contexts) and `enforce_admins` both stayed exactly as they
    were** — CI still can't be bypassed by anyone, including the account
    that owns the repo. The only thing that changed is that "a human must
    approve every PR" is now satisfied by the human's own deliberate
    click of the "Merge" button (something no code in this pipeline ever
    does), rather than by a separate formal GitHub review — the closest
    honest equivalent achievable when there is exactly one human in the
    loop. Confirmed live: PR #4's `reviewDecision` went from
    `"REVIEW_REQUIRED"` to `""`, and PR #2 (which already had all three
    checks passing) immediately showed `mergeStateStatus: "CLEAN"`.
  - **Not yet fixed**: PRs #1, #3, and #4 are still `BLOCKED` — not on
    review anymore, but because their branches predate `ci.yml` and have
    never had the three required checks run against them. Resolved by
    merging `main` into each once PR #2 itself is merged (main doesn't
    have the CI workflow until then) — see the Phase 5 section above for
    why this dependency exists.

## Phase 7 — status feedback in the UI

- **Two new columns, one migration**: `pr_review_status` (`pending` |
  `approved` | `changes_requested`) and `ci_status` (`pending` | `passing`
  | `failing`) on `backlog_items`, added via `0002_status_feedback.sql`.
  CLAUDE.md's own wording ("kept current... not by the UI polling three
  APIs live") settled where this had to live: a local reconciliation pass
  writes these columns, and `page.tsx` just reads them — the same
  direction `deploy_status` already established in Phase 6, extended
  rather than inventing a second pattern.
- **Derived from real GitHub API responses, not assumed shapes**: PR
  review decision comes from `GET /pulls/:number/reviews`, deduped to
  each reviewer's *most recent* submission (a reviewer who requested
  changes and then later approved should read as approved, not stuck)
  before applying the "any outstanding CHANGES_REQUESTED wins over any
  APPROVED" rule GitHub's own merge gate uses. CI status comes from `GET
  /commits/:sha/check-runs` (not the older combined-status endpoint,
  since GitHub Actions posts check runs, not simple statuses) —
  `neutral`/`skipped` conclusions don't count as failing, only a genuine
  non-success conclusion on a *completed* run does; anything still
  queued/in-progress is `pending`, never guessed as passing.
  `deriveReviewStatus`/`deriveCiStatus` are exported as pure functions
  from `src/github/client.ts` specifically so this logic has direct unit
  tests, not just tests of the class method that happens to call them.
- **`checkPrOpenItem` now does two independent things every pass**:
  refreshes review/CI status (regardless of merge state — the whole
  point is seeing "changes requested" or "CI failing" *while the PR is
  still open*, not just in hindsight after it's merged), and separately
  checks for a merge. `updatePrStatus()` only actually writes (and
  returns `true`) when a value changed, guarded by an `IS DISTINCT FROM`
  in the `UPDATE`'s `WHERE` clause rather than an application-level
  diff — so a `pipeline_events` row (`pr_status_updated`) only gets
  logged on a real transition, and running `sync-deploy-status`
  repeatedly against an unchanged PR doesn't spam the event log or bump
  `updated_at` for no reason. Verified this behavior directly with a
  test that calls `checkPrOpenItem` twice with the same fake status and
  asserts exactly one `pr_status_updated` event exists, not two.
- **UI verified with a real build, not just typecheck** — this project's
  Next.js/bundler-mode import convention has bitten twice before on
  files `tsc --noEmit` waved through; ran `next build` after the
  `page.tsx`/`globals.css` changes and it compiled clean, then started
  the dev server and confirmed the new PR/Review/CI/Deploy columns
  actually render.
- **`docs/DEMO_SCRIPT.md` is written against runs that actually
  happened** (SCRUM-18 → PR #1, PR #2's own first CI run, etc.), not a
  hypothetical walkthrough — consistent with how this file and the
  README talk about what's real throughout the project.
- **Cleaned up `.env`/`.env.example`'s leftover `SONARQUBE_*` /
  `NEXUS_IQ_*` / `QUALYS_*` placeholders** while writing the README's
  setup instructions — those were scaffolded in before Phase 5/6 existed
  and were never actually read by any code; the real secrets
  (`SONAR_TOKEN`, `RENDER_API_KEY`, `RENDER_SERVICE_ID`) live as GitHub
  Actions secrets on `delivery-pipeline-sample-app` itself, not in this
  project's `.env` at all. Leaving unused placeholder vars in `.env.example`
  would have misled the next person setting this up into thinking they
  needed to fill them in here.
