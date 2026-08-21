// Thin JIRA Cloud REST API v3 wrapper — this project only ever creates
// issues (unlike the sibling project's JIRA connector, which syncs
// existing ones), so it's a much smaller surface than a full connector.

import { textToAdf } from "./adf";

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  /**
   * Defaults to "Task". Not every JIRA site has a "Story" issue type —
   * team-managed/simplified projects often don't (verified firsthand
   * against a real instance while building the sibling project's JIRA
   * tracking) — so this is configurable rather than hardcoded to a value
   * that may not exist on a given project.
   */
  issueType?: string;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export interface CreateIssueInput {
  summary: string;
  /** Plain text — converted to ADF internally. Combine description + acceptance criteria into one string before calling this; JiraClient doesn't know about that domain concept, see src/lib/createBacklogItem.ts. */
  description: string;
}

export interface CreatedIssue {
  key: string;
  url: string;
}

/** The slice of JiraClient that src/lib/createBacklogItem.ts actually depends on — lets tests pass a fake instead of the concrete class. */
export interface JiraIssueCreator {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
}

export class JiraClient implements JiraIssueCreator {
  private readonly baseUrl: string;

  constructor(private readonly config: JiraClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const res = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        fields: {
          project: { key: this.config.projectKey },
          summary: input.summary,
          description: textToAdf(input.description),
          issuetype: { name: this.config.issueType ?? "Task" },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new JiraApiError(`JIRA API ${res.status} creating issue: ${body}`, res.status);
    }

    const data = (await res.json()) as { key: string };
    return { key: data.key, url: `${this.baseUrl}/browse/${data.key}` };
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    return { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" };
  }
}
