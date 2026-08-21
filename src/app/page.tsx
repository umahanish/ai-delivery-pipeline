import Link from "next/link";
import { markReadyAction } from "./actions";
import { listBacklogItems } from "../db/backlogItems";
import { getPool } from "../db/pool";

// Reads straight from Postgres on every request — this list is meant to
// reflect exactly what's in the DB after a submission or a status change,
// not a cached/stale snapshot.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const items = await listBacklogItems(getPool());
  const createdItem = created ? items.find((item) => item.id === created) : undefined;

  return (
    <main>
      <div className="header">
        <h1>Backlog</h1>
        <Link href="/new" className="button">
          + New backlog item
        </Link>
      </div>

      {createdItem ? (
        <p className="banner">
          "{createdItem.title}" submitted
          {createdItem.jiraKey ? (
            <>
              {" "}
              — JIRA story{" "}
              <a href={createdItem.jiraUrl ?? undefined} target="_blank" rel="noreferrer">
                {createdItem.jiraKey}
              </a>{" "}
              created.
            </>
          ) : (
            " — JIRA story creation failed, see the row below."
          )}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="empty">
          No backlog items yet. <Link href="/new">Submit the first one</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Priority</th>
              <th>Target repo</th>
              <th>Status</th>
              <th>JIRA</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>
                  <span className={`badge priority-${item.priority}`}>{item.priority}</span>
                </td>
                <td>{item.targetRepo}</td>
                <td>
                  <span className={`badge status-${item.status}`}>{item.status.replaceAll("_", " ")}</span>
                </td>
                <td>
                  {item.jiraUrl ? (
                    <a href={item.jiraUrl} target="_blank" rel="noreferrer">
                      {item.jiraKey}
                    </a>
                  ) : item.status === "jira_failed" ? (
                    "failed"
                  ) : (
                    "—"
                  )}
                </td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>
                  {item.status === "submitted" && item.jiraKey ? (
                    <form action={markReadyAction.bind(null, item.id)}>
                      <button type="submit">Mark ready for dev</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
