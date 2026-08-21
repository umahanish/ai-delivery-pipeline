import { describe, expect, it } from "vitest";
import { buildFixPrompt, buildImplementPrompt, buildSelfReviewPrompt, type StorySpec } from "../../src/agent/prompts";

const story: StorySpec = {
  title: "Add a /health endpoint",
  description: "Return { status: 'ok' }",
  acceptanceCriteria: "GET /health returns 200",
  testCommand: "npm test",
};

describe("buildImplementPrompt", () => {
  it("includes title, description, acceptance criteria, and the test command", () => {
    const prompt = buildImplementPrompt(story);
    expect(prompt).toContain(story.title);
    expect(prompt).toContain(story.description);
    expect(prompt).toContain(story.acceptanceCriteria!);
    expect(prompt).toContain("npm test");
  });

  it("tells the agent not to push or touch git config", () => {
    const prompt = buildImplementPrompt(story);
    expect(prompt).toContain("git push");
  });

  it("omits the acceptance criteria section when none is given", () => {
    const prompt = buildImplementPrompt({ ...story, acceptanceCriteria: null });
    expect(prompt).not.toContain("Acceptance criteria:");
  });
});

describe("buildFixPrompt", () => {
  it("includes the previous attempt's output", () => {
    const prompt = buildFixPrompt(story, "TypeError: cannot read property 'x'");
    expect(prompt).toContain("TypeError: cannot read property 'x'");
    expect(prompt).toContain(story.title); // still includes the original spec
  });
});

describe("buildSelfReviewPrompt", () => {
  it("includes the diff and asks for a literal VERDICT line", () => {
    const diff = "+ added a line\n- removed a line";
    const prompt = buildSelfReviewPrompt(story, diff);
    expect(prompt).toContain(diff);
    expect(prompt).toContain("VERDICT: APPROVE");
    expect(prompt).toContain("VERDICT: REQUEST_CHANGES");
  });

  it("keeps blank-line separators intact even when acceptance criteria is absent", () => {
    // Regression check: an earlier draft used .filter(line => line !== "")
    // which stripped every deliberate blank-line separator, not just the
    // conditional acceptance-criteria one.
    const prompt = buildSelfReviewPrompt({ ...story, acceptanceCriteria: null }, "diff");
    expect(prompt).toContain("\n\n");
  });
});
