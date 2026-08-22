# Security model

Written as an explicit threat model, not a checklist to satisfy — every
control below exists because of a specific thing it's meant to stop, and
every gap is named as a gap, not glossed over. See `docs/DECISIONS.md`
for the reasoning and live-verification behind each one as it was built.

## Identity: who can even open the door

**Threat**: anyone who finds the URL submits backlog items, triggers the
coding agent, or reads what's in the pipeline.

**Control**: real authentication (GitHub OAuth via NextAuth.js/Auth.js
v5) in front of every route — `src/middleware.ts` is the single
enforcement point, not something each page remembers to check. A valid
GitHub account gets you to the OAuth consent screen; it does **not** get
you into the app. `src/auth.ts`'s `signIn` callback checks the
`authorized_users` table and refuses the session outright if the GitHub
login isn't already there — no open self-signup, by design (a core Zero
Trust principle: a new identity is untrusted by default, not trusted
until proven otherwise).

**Onboarding**: `npm run authorize-user -- <github-login> <maintainer|viewer>`.
There's no admin UI for this yet — a deliberate, named gap (see "Known
gaps" below), not an oversight.

**Why GitHub OAuth and not a password**: "don't roll your own auth" is
itself a Zero Trust-adjacent principle — password storage, reset flows,
and hashing are a whole class of mistakes this sidesteps entirely. GitHub
is also already this project's central identity: it's who opens every PR
the coding agent produces.

## Authorization: what a signed-in identity can do

**Threat**: a signed-in-but-unprivileged account triggers mutations —
submitting items, marking them ready for dev (which starts the coding
agent against a real repo).

**Control**: two roles, `maintainer` and `viewer`, carried in the session
JWT after being looked up once at sign-in. Enforced **three times**, not
once, deliberately:

1. `src/middleware.ts` — blocks unauthenticated requests entirely.
2. `src/app/actions.ts` (`requireMaintainer()`) — every mutating Server
   Action re-checks role server-side. Server Actions can in principle be
   invoked directly (not only through a page middleware protected), so
   this isn't redundant with #1.
3. `src/app/api/backlog-items/route.ts` — the REST `POST` endpoint checks
   independently again, since it's a separate code path from the Server
   Actions.

The UI (`src/app/page.tsx`, `src/app/new/page.tsx`) also hides
maintainer-only controls from viewers — purely UX, not a security
boundary; a viewer whose browser somehow still showed the button would
still be refused server-side.

## The AI agent's own blast radius

**Threat**: the coding agent (Claude Agent SDK, invoked with
`bypassPermissions` since nobody is present to click an approval prompt)
does something outside the scope of "implement this one story."

**Controls**, all pre-existing from Phase 4, restated here as an explicit
threat model rather than left implicit in `runCodingAgent.ts`'s comments:

- **Isolated workspace**: a fresh clone into its own `mkdtemp` scratch
  directory per run, never a shared checkout. A run that goes wrong
  affects only that directory, which is deleted afterward regardless of
  outcome (`finally { await workspace.cleanup(); }`).
- **Tool allowlist**: `tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]`
  — no web access, no MCP servers, nothing beyond what implementing code
  in a repo requires.
- **Explicit tool denials on top of the allowlist**: `disallowedTools:
  ["Bash(git push*)", "Bash(git config*)", "Bash(rm -rf *)"]` — pushing
  and remote config changes are the orchestrator's job (done after the
  agent's turn, with a real credential the agent itself never sees), not
  the agent's. Belt-and-suspenders even though `bypassPermissions` is on.
- **Bounded retries**: a combined round budget (implement-failure +
  review-rejection), never unbounded. Exhausting it lands the item on
  `needs_human`, not a silent infinite loop.
- **The isolation boundary is the real safety margin, not agent
  "good behavior"**: the design explicitly does not rely on prompting
  the agent to ask permission mid-run (`bypassPermissions` is the whole
  point) — it relies on there being nothing reachable worth protecting
  inside the sandbox it's given.

**Prompt injection consideration**: a backlog item's title, description,
and acceptance criteria — written by whoever has `maintainer` access —
become part of the prompt the coding agent receives
(`src/agent/prompts.ts`). Since only allowlisted `maintainer` accounts
can write that text, this is a smaller threat surface than a public
input field would be, but it is **not zero**: a `maintainer` account with
bad intent (or a compromised one) could try to instruct the agent to do
something outside the intended scope through the story text itself. The
tool allowlist/denylist above is what actually bounds this, not prompt
wording — treat any prompt-level instruction ("only implement what's
asked") as a hint to the model, not a security control.

## Credentials

**Threat**: a leaked or over-broad token does more damage than the task
that needed it.

- `GITHUB_TOKEN` should be a fine-grained PAT scoped to
  `delivery-pipeline-sample-app` only, not classic `repo` scope across
  every repo the account can touch. (Known gap: the token currently in
  use for local development predates this guidance — see "Known gaps.")
- Every secret lives in `.env` (gitignored, never committed) or as
  GitHub Actions secrets on the specific repo that needs them — see
  `.env.example` for the full inventory and where each one actually
  lives.
- `delivery-pipeline-sample-app`'s CI runs a secret-scanning job
  (gitleaks) alongside the existing Trivy dependency scan, as a required
  status check — a leaked credential committed by mistake fails the PR,
  it doesn't quietly merge.

## Transport & request hardening

- Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) applied
  via Next.js middleware/config — see `src/middleware.ts` /
  `next.config.ts`.
- Rate limiting on the API routes — see `src/lib/rateLimit.ts`.
- Input validation via zod at every mutation boundary (already existed
  pre-Phase-8; restated here as part of the same threat model rather
  than treated as unrelated).

## Observability (Phase 9)

Security and observability overlap more than they're usually given credit
for — an attacker probing this app, or a pipeline silently stuck, both
show up first as "something in the log stream looks wrong," not as a
dedicated alert someone had to think to write in advance.

- Every `pipeline_events` write is also a structured JSON log line
  (`src/lib/logger.ts`), correlated by backlog item id — including auth
  denials (`middleware.ts`) and rate-limit blocks
  (`actions.ts`/the REST route), not just pipeline stage transitions.
- Sentry captures unexpected exceptions in both the Next.js app and the
  two orchestrator scripts — see `instrumentation.ts` and
  `src/lib/sentryNode.ts`. A crash that reaches Sentry is, by
  construction, one this app already degrades gracefully from (every
  catch site that calls `Sentry.captureException` also marks the backlog
  item `needs_human` rather than leaving it stuck — see
  `src/orchestrator/processBacklogItem.ts`), so Sentry is a *notification*
  channel here, not the only thing standing between a bug and data loss.
- `/api/health` is deliberately unauthenticated (excluded from
  `middleware.ts`'s matcher) — an uptime monitor can't present a session
  cookie. It reveals only "the DB is reachable or it isn't," nothing
  about backlog contents.
- Slack notifications (`src/lib/notify.ts`) never throw and are a silent
  no-op without `SLACK_WEBHOOK_URL` — a notification-channel outage must
  never become a pipeline outage.

## Known gaps (named, not hidden)

- **No admin UI for `authorized_users`** — CLI only
  (`npm run authorize-user`). Fine for a small course/demo team; a real
  multi-team deployment would want this in the UI with its own audit
  trail.
- **`GITHUB_TOKEN` in local `.env` was issued before this pass's
  credential-hardening guidance** — scoping it down to a fine-grained,
  single-repo PAT is a follow-up action for whoever runs this template,
  not something retroactively rotated as part of this change.
- **The REST API's "external/scripted use" claim is now narrower than
  before**: session-cookie auth works for a browser; a genuine
  machine-to-machine caller (a CI job, say) would need a separate
  API-key scheme, which doesn't exist yet. See
  `src/app/api/backlog-items/route.ts`'s own comment.
- **Rate limiting is in-memory, single-instance** — correct for how this
  demo actually runs (one Next.js process), explicitly *not* what a
  multi-instance production deployment should use (that needs a shared
  store like Redis/Upstash). Noted in `src/lib/rateLimit.ts` itself.
- **Sentry's live error capture is unverified** — the init code, the
  build-succeeds-without-a-DSN path, and the no-op-when-unset behavior
  are all confirmed; an actual event landing in the Sentry dashboard
  isn't, since that requires a sentry.io login this environment doesn't
  have. Whoever runs this template should trigger a real error once and
  confirm it shows up before relying on this for anything.
- **`ai-delivery-pipeline`'s own `/api/health` has no external monitor
  pointed at it** — it's local-only (`AUTH_URL=http://localhost:3000`),
  so `.github/workflows/uptime.yml` targets the sample app's already-
  deployed `/health` instead. If this UI is ever deployed somewhere
  reachable, point a second scheduled check at its own `/api/health` too.
