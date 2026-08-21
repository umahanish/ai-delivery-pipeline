// Thin GitHub REST API wrapper — this project only ever opens PRs (unlike
// the sibling devops-knowledge-mcp project's GitHub connector, which syncs
// existing repos/commits/PRs), so it's a much smaller surface. Same Bearer
// auth pattern as that connector.

export interface GitHubClientConfig {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export interface CreatePullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface CreatedPullRequest {
  number: number;
  url: string;
}

/** The slice of GitHubClient the orchestrator actually depends on — lets tests pass a fake instead of the concrete class, same pattern as JiraIssueCreator. */
export interface PullRequestOpener {
  createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequest>;
}

export class GitHubClient implements PullRequestOpener {
  constructor(private readonly config: GitHubClientConfig) {}

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequest> {
    const res = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new GitHubApiError(`GitHub API ${res.status} creating PR: ${body}`, res.status);
    }

    const data = (await res.json()) as { number: number; html_url: string };
    return { number: data.number, url: data.html_url };
  }
}
