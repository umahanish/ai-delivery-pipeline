import { describe, expect, it } from "vitest";
import { textToAdf } from "../../src/jira/adf";

describe("textToAdf", () => {
  it("wraps a single line as one paragraph", () => {
    expect(textToAdf("Fix the widget")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Fix the widget" }] }],
    });
  });

  it("splits on blank lines into multiple paragraphs", () => {
    const result = textToAdf("First paragraph.\n\nSecond paragraph.");
    expect(result.content).toHaveLength(2);
    expect(result.content?.[0]?.content?.[0]?.text).toBe("First paragraph.");
    expect(result.content?.[1]?.content?.[0]?.text).toBe("Second paragraph.");
  });

  it("does not split on a single newline within a paragraph", () => {
    const result = textToAdf("Line one\nLine two");
    expect(result.content).toHaveLength(1);
  });

  it("produces an empty paragraph for empty input rather than throwing", () => {
    expect(textToAdf("")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [] }],
    });
  });
});
