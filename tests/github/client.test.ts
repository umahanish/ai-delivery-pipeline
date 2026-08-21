import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError, GitHubClient } from "../../src/github/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubClient.createPullRequest", () => {
  it("posts to /repos/:owner/:repo/pulls with Bearer auth", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ number: 42, html_url: "https://github.com/acme/widgets/pull/42" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "secret", owner: "acme", repo: "widgets" });
    const result = await client.createPullRequest({
      title: "PROJ-1 Add health endpoint",
      body: "Automated PR",
      head: "story/proj-1",
      base: "main",
    });

    expect(result).toEqual({ number: 42, url: "https://github.com/acme/widgets/pull/42" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/acme/widgets/pulls");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");

    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ title: "PROJ-1 Add health endpoint", body: "Automated PR", head: "story/proj-1", base: "main" });
  });

  it("throws GitHubApiError with the response body on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("validation failed", { status: 422 })));

    const client = new GitHubClient({ token: "t", owner: "acme", repo: "widgets" });
    await expect(client.createPullRequest({ title: "x", body: "y", head: "h", base: "main" })).rejects.toThrow(GitHubApiError);
  });
});

describe("GitHubClient.getPullRequestMergeState", () => {
  it("GETs /pulls/:number with Bearer auth and maps merged/merge_commit_sha", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ merged: true, merge_commit_sha: "abc123" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "secret", owner: "acme", repo: "widgets" });
    const result = await client.getPullRequestMergeState(7);

    expect(result).toEqual({ merged: true, mergeCommitSha: "abc123" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/acme/widgets/pulls/7");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("reports merged: false for an open PR", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ merged: false, merge_commit_sha: null })));

    const client = new GitHubClient({ token: "t", owner: "acme", repo: "widgets" });
    expect(await client.getPullRequestMergeState(7)).toEqual({ merged: false, mergeCommitSha: null });
  });

  it("throws GitHubApiError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("not found", { status: 404 })));

    const client = new GitHubClient({ token: "t", owner: "acme", repo: "widgets" });
    await expect(client.getPullRequestMergeState(999)).rejects.toThrow(GitHubApiError);
  });
});

describe("GitHubClient.getWorkflowRunForCommit", () => {
  it("GETs workflow runs filtered by head_sha and maps the first result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        workflow_runs: [{ status: "completed", conclusion: "success", html_url: "https://github.com/acme/widgets/actions/runs/1" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "secret", owner: "acme", repo: "widgets" });
    const result = await client.getWorkflowRunForCommit("deploy.yml", "abc123");

    expect(result).toEqual({ status: "completed", conclusion: "success", htmlUrl: "https://github.com/acme/widgets/actions/runs/1" });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/acme/widgets/actions/workflows/deploy.yml/runs?head_sha=abc123&per_page=1");
  });

  it("returns null when no run has started yet for that commit", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ workflow_runs: [] })));

    const client = new GitHubClient({ token: "t", owner: "acme", repo: "widgets" });
    expect(await client.getWorkflowRunForCommit("deploy.yml", "nope")).toBeNull();
  });
});
