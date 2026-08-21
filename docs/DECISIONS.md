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
