import Link from "next/link";
import { getPipelineMetrics, listRecentEvents } from "../../db/metrics";
import { getPool } from "../../db/pool";

// Same reasoning as the backlog list (src/app/page.tsx): reads straight
// from Postgres on every request rather than caching a snapshot.
export const dynamic = "force-dynamic";

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function formatHours(hours: number | null): string {
  return hours === null ? "—" : `${hours.toFixed(1)}h`;
}

export default async function MetricsPage() {
  const pool = getPool();
  const [metrics, recentEvents] = await Promise.all([getPipelineMetrics(pool), listRecentEvents(pool, 25)]);

  return (
    <main>
      <div className="header">
        <h1>Pipeline metrics</h1>
        <Link href="/" className="nav-link">
          ← Back to backlog
        </Link>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="value">{metrics.totalSubmitted}</div>
          <div className="label">Items submitted</div>
        </div>
        <div className="metric-card">
          <div className="value">{metrics.needsHumanCount}</div>
          <div className="label">Needs human</div>
        </div>
        <div className="metric-card">
          <div className="value">{formatHours(metrics.avgTimeToPrHours)}</div>
          <div className="label">Avg time to PR</div>
        </div>
        <div className="metric-card">
          <div className="value">{formatPercent(metrics.ciPassRate)}</div>
          <div className="label">CI pass rate</div>
        </div>
        <div className="metric-card">
          <div className="value">{formatPercent(metrics.deploySuccessRate)}</div>
          <div className="label">Deploy success rate</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>By status</h2>
      <div className="metrics-grid" style={{ marginBottom: 32 }}>
        {Object.entries(metrics.byStatus).length === 0 ? (
          <p className="empty">No backlog items yet.</p>
        ) : (
          Object.entries(metrics.byStatus).map(([status, count]) => (
            <div className="metric-card" key={status}>
              <div className="value">{count}</div>
              <div className="label">{status.replaceAll("_", " ")}</div>
            </div>
          ))
        )}
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent activity</h2>
      {recentEvents.length === 0 ? (
        <p className="empty">No pipeline events yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Event</th>
              <th>Detail</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.map((event, i) => (
              <tr key={`${event.backlogItemId}-${event.occurredAt}-${i}`}>
                <td>{event.jiraKey ?? event.title}</td>
                <td>{event.eventType.replaceAll("_", " ")}</td>
                <td>{event.detail ?? "—"}</td>
                <td>{new Date(event.occurredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
