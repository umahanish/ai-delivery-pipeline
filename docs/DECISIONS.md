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
