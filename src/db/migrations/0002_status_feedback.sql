-- Migration 0002: Phase 7 status feedback.
--
-- CLAUDE.md's Phase 7 wants the UI to show PR status (open / changes
-- requested / approved / merged) and CI check results per item, pulled
-- from backlog_items -- not by the UI polling GitHub live on every page
-- load. These two columns are what a local reconciliation pass (see
-- src/orchestrator/deployStatus.ts's checkPrOpenItem) writes into, the
-- same way deploy_status already works.

ALTER TABLE backlog_items
    ADD COLUMN pr_review_status text CHECK (pr_review_status IN ('pending', 'approved', 'changes_requested')),
    ADD COLUMN ci_status         text CHECK (ci_status IN ('pending', 'passing', 'failing'));
