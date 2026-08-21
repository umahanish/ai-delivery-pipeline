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
