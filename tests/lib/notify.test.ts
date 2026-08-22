import { afterEach, describe, expect, it, vi } from "vitest";
import { notifySlack } from "../../src/lib/notify";

const ORIGINAL_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_WEBHOOK === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = ORIGINAL_WEBHOOK;
});

describe("notifySlack", () => {
  it("does nothing when SLACK_WEBHOOK_URL isn't set", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await notifySlack("hello");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the text as JSON to the configured webhook", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T0/B0/fake";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await notifySlack("PR opened");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.com/services/T0/B0/fake");
    expect(JSON.parse(init!.body as string)).toEqual({ text: "PR opened" });
  });

  it("swallows a non-OK response instead of throwing", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T0/B0/fake";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("invalid_payload", { status: 400 })));

    await expect(notifySlack("PR opened")).resolves.toBeUndefined();
  });

  it("swallows a network error instead of throwing", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T0/B0/fake";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network exploded")));

    await expect(notifySlack("PR opened")).resolves.toBeUndefined();
  });
});
