// Slack notifications (Phase 9) on key pipeline events: PR opened,
// needs_human, deploy success/failure, CI failure. A no-op without
// SLACK_WEBHOOK_URL configured (dev/CI never has one), and a failed post
// is logged, never thrown — a Slack outage must never be what breaks the
// actual pipeline it's just reporting on.

import { logger } from "./logger";

export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      logger.warn("slack_notify_failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("slack_notify_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
