import { afterEach, describe, expect, it, vi } from "vitest";
import { JiraApiError, JiraClient } from "../../src/jira/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JiraClient.createIssue", () => {
  it("posts to /rest/api/3/issue with Basic auth and an ADF description", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ key: "PROJ-42" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new JiraClient({
      baseUrl: "https://acme.atlassian.net",
      email: "pm@acme.com",
      apiToken: "secret",
      projectKey: "PROJ",
    });

    const result = await client.createIssue({ summary: "Add rate limiting", description: "Details here." });

    expect(result).toEqual({ key: "PROJ-42", url: "https://acme.atlassian.net/browse/PROJ-42" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("pm@acme.com:secret").toString("base64")}`);

    const body = JSON.parse(init!.body as string);
    expect(body.fields.project).toEqual({ key: "PROJ" });
    expect(body.fields.summary).toBe("Add rate limiting");
    expect(body.fields.issuetype).toEqual({ name: "Task" }); // default
    expect(body.fields.description.type).toBe("doc"); // ADF, not a plain string
  });

  it("uses a configured issueType instead of the Task default", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ key: "PROJ-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new JiraClient({
      baseUrl: "https://acme.atlassian.net",
      email: "e",
      apiToken: "t",
      projectKey: "PROJ",
      issueType: "Story",
    });
    await client.createIssue({ summary: "x", description: "y" });

    const body = JSON.parse((fetchMock.mock.calls[0]![1]!.body as string));
    expect(body.fields.issuetype).toEqual({ name: "Story" });
  });

  it("throws JiraApiError with the response body on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("issuetype: invalid", { status: 400 })),
    );

    const client = new JiraClient({ baseUrl: "https://acme.atlassian.net", email: "e", apiToken: "t", projectKey: "PROJ" });

    await expect(client.createIssue({ summary: "x", description: "y" })).rejects.toThrow(JiraApiError);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ key: "PROJ-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new JiraClient({ baseUrl: "https://acme.atlassian.net/", email: "e", apiToken: "t", projectKey: "PROJ" });
    const result = await client.createIssue({ summary: "x", description: "y" });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://acme.atlassian.net/rest/api/3/issue");
    expect(result.url).toBe("https://acme.atlassian.net/browse/PROJ-1");
  });
});
