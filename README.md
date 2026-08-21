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

This repo currently contains the **build brief and design docs only**.
Open this folder in Claude Code and point it at `CLAUDE.md` — that file is
written as a self-contained instruction set for Claude Code to execute the
full build autonomously, phase by phase.

```bash
cd ai-delivery-pipeline
claude
> Read CLAUDE.md and start building, beginning with Phase 1.
```

## Docs

- `CLAUDE.md` — the build brief, including the constraints that were
  explicitly decided before any code was written (read this first)
- `docs/DECISIONS.md` — judgment calls made while building, logged as
  they happen
