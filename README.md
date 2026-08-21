# AI Delivery Pipeline

A reference pipeline: a Product Owner / PM / Scrum Master submits a
backlog item through a small web UI, and everything downstream happens
automatically up to an open pull request — JIRA story creation, an
isolated coding-agent run, a self-review pass, CI (tests + SonarQube +
Nexus IQ), and a staging deploy with a Qualys scan once a human approves
the PR. A human approval gate on every PR is a fixed part of the design,
not a configurable option — see `CLAUDE.md`.

Companion project to [`devops-knowledge-mcp`](../devops-knowledge-mcp) —
reuses some of its patterns (JIRA auth, connector-testing conventions) but
is a separate system with its own repo and lifecycle.

## Status

**Built so far: Phase 1 (foundations) + Phase 3 (backlog UI → JIRA).**
Submitting a backlog item through the web UI creates a real JIRA story.
Phase 2 (a dedicated sample target repo for the agent to work against) and
Phase 4+ (the actual coding agent, CI, deploy) are not started — see
`CLAUDE.md` for the full roadmap and `docs/DECISIONS.md` for the
reasoning behind every choice made so far, including two real bugs caught
by live-testing this rather than trusting green tests alone.

## Setup

**Prerequisites:** Docker, Node.js 20+.

```bash
git clone <this repo>
cd ai-delivery-pipeline
npm install
cp .env.example .env

docker compose up -d postgres   # Postgres on :5433 (not 5432 — see docker-compose.yml)
npm run migrate                 # applies src/db/migrations/
npm test                        # 22 tests
```

### JIRA setup (required for the UI to actually create stories)

Fill in `.env`:

```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=          # Account Settings -> Security -> API tokens
JIRA_PROJECT_KEY=SCRUM   # the project new stories are created in
JIRA_ISSUE_TYPE=Task     # not every JIRA site has a "Story" issue type — check yours
```

Without these set, the UI still works and still saves every submission —
it just marks the item `jira_failed` instead of creating a story (visible
in the list view), rather than losing the submission. See
`src/lib/createBacklogItem.ts`'s docstring.

### Run it

```bash
npm run dev
```

Open http://localhost:3000 — submit a backlog item at `/new`, watch it
appear on the list with its JIRA key (or a `jira_failed` badge if JIRA
isn't configured), and use "Mark ready for dev" once a story exists.
There's also a REST API at `/api/backlog-items` (`GET` to list, `POST` to
create) for external/scripted use.

## Project layout

```
src/
  db/            schema.sql, migrations/, pool.ts, backlogItems.ts (data access)
  jira/          client.ts (create-issue only, not a full connector), adf.ts (text -> Atlassian Document Format), fromEnv.ts
  lib/           createBacklogItem.ts — the one place "insert row, then create JIRA story" logic lives
  app/           Next.js App Router: page.tsx (list), new/page.tsx (form), actions.ts (Server Actions), api/backlog-items/route.ts (REST)
scripts/         migrate.ts
docs/
  DECISIONS.md   every judgment call, including bugs found while building
```

## Development

```bash
npm run typecheck   # tsc --noEmit, strict mode
npm test             # vitest — tests/db and tests/lib need Postgres running
npm run build         # next build — the real check that everything actually resolves; see docs/DECISIONS.md on why typecheck alone wasn't enough
```
