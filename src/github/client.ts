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

export interface PullRequestMergeState {
  merged: boolean;
  mergeCommitSha: string | null;
}

/** Phase 6's reconciliation step (see src/orchestrator/deployStatus.ts) depends on just this slice. */
export interface PullRequestChecker {
  getPullRequestMergeState(prNumber: number): Promise<PullRequestMergeState>;
}

export type WorkflowRunStatus = "queued" | "in_progress" | "completed";

export interface WorkflowRun {
  status: WorkflowRunStatus;
  conclusion: string | null;
  htmlUrl: string;
}

/** Also part of Phase 6's reconciliation dependency slice. */
export interface DeployWorkflowChecker {
  /** Most recent run of workflowFileName (e.g. "deploy.yml") for the given commit SHA, or null if none has started yet. */
  getWorkflowRunForCommit(workflowFileName: string, headSha: string): Promise<WorkflowRun | null>;
}

export class GitHubClient implements PullRequestOpener, PullRequestChecker, DeployWorkflowChecker {
  constructor(private readonly config: GitHubClientConfig) {}

  private async request(path: string): Promise<unknown> {
    const res = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubApiError(`GitHub API ${res.status} on GET ${path}: ${body}`, res.status);
    }
    return res.json();
  }

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

  async getPullRequestMergeState(prNumber: number): Promise<PullRequestMergeState> {
    const data = (await this.request(`/pulls/${prNumber}`)) as { merged: boolean; merge_commit_sha: string | null };
    return { merged: data.merged, mergeCommitSha: data.merge_commit_sha };
  }

  async getWorkflowRunForCommit(workflowFileName: string, headSha: string): Promise<WorkflowRun | null> {
    const data = (await this.request(
      `/actions/workflows/${encodeURIComponent(workflowFileName)}/runs?head_sha=${encodeURIComponent(headSha)}&per_page=1`,
    )) as { workflow_runs: { status: WorkflowRunStatus; conclusion: string | null; html_url: string }[] };
    const run = data.workflow_runs[0];
    return run ? { status: run.status, conclusion: run.conclusion, htmlUrl: run.html_url } : null;
  }
}
