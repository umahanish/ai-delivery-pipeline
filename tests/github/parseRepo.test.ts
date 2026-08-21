import { describe, expect, it } from "vitest";
import { parseGitHubRepo } from "../../src/github/parseRepo";

describe("parseGitHubRepo", () => {
  it("parses a full https URL", () => {
    expect(parseGitHubRepo("https://github.com/umahanish/delivery-pipeline-sample-app")).toEqual({
      owner: "umahanish",
      repo: "delivery-pipeline-sample-app",
    });
  });

  it("parses a full URL with a .git suffix and trailing slash", () => {
    expect(parseGitHubRepo("https://github.com/umahanish/delivery-pipeline-sample-app.git/")).toEqual({
      owner: "umahanish",
      repo: "delivery-pipeline-sample-app",
    });
  });

  it("parses the short org/repo form", () => {
    expect(parseGitHubRepo("acme/widgets")).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("parses an ssh-style URL", () => {
    expect(parseGitHubRepo("git@github.com:acme/widgets.git")).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("throws a clear error for something unparseable", () => {
    expect(() => parseGitHubRepo("not a repo at all")).toThrow(/Could not parse/);
  });
});
