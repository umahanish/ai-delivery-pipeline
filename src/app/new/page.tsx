"use client";

import { useActionState } from "react";
import Link from "next/link";
import { submitBacklogItemAction, type SubmitBacklogItemState } from "../actions";

const initialState: SubmitBacklogItemState = {};

export default function NewBacklogItemPage() {
  const [state, formAction, pending] = useActionState(submitBacklogItemAction, initialState);

  return (
    <main>
      <div className="header">
        <h1>New backlog item</h1>
        <Link href="/" className="button secondary">
          Back to backlog
        </Link>
      </div>

      <form action={formAction} className="item-form">
        <label>
          Title
          <input name="title" required maxLength={200} placeholder="Add rate limiting to the API gateway" />
        </label>

        <label>
          Description
          <textarea name="description" required rows={5} placeholder="What should change, and why?" />
        </label>

        <label>
          Acceptance criteria (optional)
          <textarea name="acceptanceCriteria" rows={4} placeholder="One per line — what does &quot;done&quot; look like?" />
        </label>

        <label>
          Priority
          <select name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label>
          Target repo
          <input name="targetRepo" required placeholder="org/repo" />
        </label>

        {state.error ? <p className="error">{state.error}</p> : null}

        <button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit — creates a JIRA story automatically"}
        </button>
      </form>
    </main>
  );
}
