import { JiraClient } from "./client";

export function createJiraClientFromEnv(): JiraClient {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;

  if (!baseUrl || !email || !apiToken || !projectKey) {
    throw new Error(
      "JIRA is not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_PROJECT_KEY (see .env.example)",
    );
  }

  return new JiraClient({ baseUrl, email, apiToken, projectKey, issueType: process.env.JIRA_ISSUE_TYPE });
}
