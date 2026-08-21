-- Migration 0001: initial schema.
--
-- Applied and tracked by scripts/migrate.ts. src/db/schema.sql is a
-- snapshot that mirrors this file.

CREATE TABLE backlog_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title               text NOT NULL,
    description         text NOT NULL,
    acceptance_criteria text,
    priority            text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    target_repo         text NOT NULL,
    status              text NOT NULL DEFAULT 'submitted' CHECK (status IN (
                            'submitted', 'jira_failed', 'ready_for_dev', 'in_dev',
                            'pr_open', 'needs_human', 'merged', 'deployed', 'failed'
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

CREATE TABLE pipeline_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id  uuid NOT NULL REFERENCES backlog_items (id) ON DELETE CASCADE,
    event_type       text NOT NULL,
    detail           text,
    occurred_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_events_backlog_item_id ON pipeline_events (backlog_item_id);
