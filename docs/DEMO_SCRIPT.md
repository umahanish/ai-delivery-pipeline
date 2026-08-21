# Demo script

Walks through the whole pipeline end to end: submit a backlog item as a
PM, watch it move through every stage, ending at a real PR and a real
staging deploy. Every step below has actually been run for real at least
once — see `docs/DECISIONS.md` for the specific runs this script is based
on (SCRUM-18 → PR #1, PR #2's own first CI run, etc.), not a hypothetical
walkthrough.

Total time: ~10-15 minutes of active steps, plus however long the coding
agent's implement/test/self-review loop takes on your story (a few
minutes for something small).

## 0. Prerequisites

Follow the README's Setup section first: Postgres running, migrations
applied (both databases), `.env` filled in (JIRA, `GITHUB_TOKEN`,
`ANTHROPIC_API_KEY`), `npm run dev` running.

You'll also want `delivery-pipeline-sample-app`'s CI (`ci.yml`) and
deploy (`deploy.yml`) workflows already merged to its `main` — if you're
demoing this fresh, merge those first (see that repo's own PRs from
building this pipeline, or push equivalent workflows if you're pointing
at a different target repo).

## 1. Submit a backlog item (as a PM)

Open `http://localhost:3000/new` and fill out the form:

- **Title**: something small and genuinely code-shaped — e.g. "Add GET
  /widgets/count endpoint". Vague or non-code asks (like "review X and
  write a report") are a poor fit for the coding agent; see the SCRUM-17
  incident in `docs/DECISIONS.md` for why.
- **Description** + **Acceptance criteria**: be specific — the agent's
  self-review pass checks the diff against exactly this text.
- **Target repo**: `https://github.com/<you>/delivery-pipeline-sample-app`
  (or your own fork/target — see the README's "point this at a different
  target repo" section).

Submit. You land back on the list with a new row, `status: submitted`,
and a real JIRA key if JIRA is configured (or a `jira_failed` badge if
not — the row is never lost either way, see `src/lib/createBacklogItem.ts`).

## 2. Mark it ready for dev

Click **"Mark ready for dev"** on the row. `status` moves to
`ready_for_dev`. This is the PM's explicit go-ahead — nothing downstream
starts until this click.

## 3. Run the orchestrator

```bash
npm run orchestrator
```

This claims the item (`status: in_dev`), clones the target repo into an
isolated scratch workspace on a new branch (`story/<jira-key>`), and runs
the Claude Agent SDK through implement → test → self-review, retrying up
to the bounded round limit if a round fails. Watch the terminal output —
it prints which round it's on and the outcome.

On success: a real PR is opened, `status: pr_open`. On exhausting the
retry budget (or an unexpected error — see `docs/DECISIONS.md`'s crash
writeups): `status: needs_human`, with the last agent output logged to
`pipeline_events` so it's never silently stuck.

## 4. Watch CI run on the PR

Open the PR link from the list view (or GitHub directly). Three required
checks run automatically: `test`, `sonarqube` (real SonarCloud analysis),
`dependency-scan` (Trivy, standing in for Nexus IQ). Refresh the backlog
list — the **Review** and **CI** columns update once you run step 6's
sync (or wait for your next orchestrator/sync pass).

## 5. Review and merge the PR (as a human)

This is the one step nothing in this pipeline can do for you, by design.
Read the diff, check the CI results, then merge it yourself on GitHub.
No code path here calls the merge API — see `CLAUDE.md`'s Constraints.

## 6. Sync status back to the pipeline

```bash
npm run sync-deploy-status
```

Run this any time after submitting the PR — it's what keeps the list
view's **Review**, **CI**, and **Deploy** columns current. Run it now
(after merging) and it will:

- Detect the merge (`status: merged`, `deploy_status: pending`)
- Check the deploy workflow for that merge commit — if `deploy.yml` has
  already run, pick up the result immediately in the same pass

If the deploy workflow hasn't finished yet, run it again in a minute or
two — this isn't a poll daemon, it's meant to be run on demand or on a
schedule (see its own header comment).

## 7. Watch the deploy + scan

On GitHub, the target repo's `deploy.yml` workflow triggers automatically
on the merge: deploys to Render, smoke-tests the live URL, then runs an
OWASP ZAP baseline scan against it (standing in for Qualys — see
`docs/DECISIONS.md` for why that's structurally a different kind of check
than the pre-merge CI gates).

## 8. Check the final state

Back on `http://localhost:3000`, the row should now show `status:
deployed` (or `failed`, with the reason in `pipeline_events` if the
deploy workflow's conclusion wasn't `success`) and a **Deploy** badge.
That's the whole loop: PM submission → JIRA → autonomous implementation
→ CI → human approval → staging deploy → post-deploy scan, with every
transition logged to `pipeline_events` for a full audit trail.
