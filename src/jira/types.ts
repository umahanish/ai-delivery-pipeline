// Minimal Atlassian Document Format node — same shape as the sibling
// devops-knowledge-mcp project's JIRA connector uses for *reading*
// descriptions. This project only ever writes one, so it doesn't need
// the full node vocabulary, just enough to build simple paragraphs.
export interface JiraAdfNode {
  type: string;
  version?: number;
  text?: string;
  content?: JiraAdfNode[];
}
