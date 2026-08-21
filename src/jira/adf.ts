import type { JiraAdfNode } from "./types";

/**
 * Plain text -> a minimal ADF document, one paragraph per blank-line-
 * separated block. The inverse of the sibling project's ADF-to-text
 * extractor — needed here because JIRA's v3 create-issue API requires the
 * `description` field to be ADF, not a plain string.
 */
export function textToAdf(text: string): JiraAdfNode {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return { type: "doc", version: 1, content: [{ type: "paragraph", content: [] }] };
  }

  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    })),
  };
}
