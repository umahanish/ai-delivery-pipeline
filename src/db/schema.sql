-- Knowledge store schema — current state.
--
-- This file is a convenience snapshot (handy for `psql -f` when seeding a
-- throwaway/test database). The source of truth for how the schema evolves
-- is src/db/migrations/ — this file should always match after the last
-- migration in that folder.

-- gen_random_uuid() is built into Postgres core since v13, no extension needed.

-- One row per backlog item, from submission through deploy. Phase 3 (this
-- build) only ever sets status up through 'ready_for_dev' and populates
-- jira_key/jira_url — pr_number/pr_url/deploy_status are written by later
-- phases (the orchestrator, the deploy workflow) once they exist.
CREATE TABLE backlog_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title               text NOT NULL,
    description         text NOT NULL,
    acceptance_criteria text,
    priority            text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    target_repo         text NOT NULL,
    status              text NOT NULL DEFAULT 'submitted' CHECK (status IN (
                            'submitted',      -- row + JIRA story both created
                            'jira_failed',    -- row created, JIRA story creation failed — see pipeline_events for why
                            'ready_for_dev',  -- PM explicitly marked it ready; Phase 4's orchestrator picks these up
                            'in_dev',
                            'pr_open',
                            'needs_human',    -- agent exhausted its retry budget without converging
                            'merged',
                            'deployed',
                            'failed'
                        )),
    jira_key            text,
    jira_url            text,
    pr_number           integer,
    pr_url              text,
    deploy_status       text CHECK (deploy_status IN ('pending', 'deployed', 'failed')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_backlog_items_status ON backlog_items (status);

-- Audit trail: every state transition and notable event for a backlog
-- item, so the UI's status view (Phase 7) can show a timeline without
-- re-deriving it from JIRA/GitHub API calls on every page load.
CREATE TABLE pipeline_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id  uuid NOT NULL REFERENCES backlog_items (id) ON DELETE CASCADE,
    event_type       text NOT NULL,
    detail           text,
    occurred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_events_backlog_item_id ON pipeline_events (backlog_item_id);
