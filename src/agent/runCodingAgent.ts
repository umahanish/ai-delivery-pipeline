// Thin wrapper over @anthropic-ai/claude-agent-sdk's query(). This is the
// one seam Phase 4's tests mock (per CLAUDE.md Conventions: "no real API
// calls in npm test") — everything upstream of this file (the retry loop,
// self-review pass) depends on the AgentRunner function type, not on the
// SDK directly.
//
// Field names below were verified against the installed package's actual
// .d.ts, not assumed from the SDK's own doc site — a WebFetch of the
// public docs while building this named message types
// (SDKTextMessage, SDKCostMessage, SDKControlFinalResponse) that don't
// exist in the real type union. See docs/DECISIONS.md.

import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export interface RunCodingAgentInput {
  cwd: string;
  prompt: string;
  maxTurns: number;
  maxBudgetUsd?: number;
}

export interface AgentRunResult {
  success: boolean;
  /** Final assistant text on success; joined error messages otherwise. */
  resultText: string;
  totalCostUsd: number;
  numTurns: number;
  /** 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries' */
  subtype: string;
}

export type AgentRunner = (input: RunCodingAgentInput) => Promise<AgentRunResult>;

export const runCodingAgent: AgentRunner = async (input) => {
  let finalResult: SDKResultMessage | undefined;

  for await (const message of query({
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      maxTurns: input.maxTurns,
      maxBudgetUsd: input.maxBudgetUsd,
      // Genuinely unattended (no human present to click an approval
      // prompt) — the safety margin here comes from the isolated
      // workspace + branch-only writes + mandatory human PR review
      // upstream and downstream of this call, not from prompting the
      // agent for permission mid-run. allowDangerouslySkipPermissions is
      // the SDK's own required opt-in acknowledgment for this mode.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
      // Belt-and-suspenders on top of bypassPermissions: even with
      // permission checks off, don't hand the agent tools it has no
      // legitimate reason to use inside its own scratch clone — pushing
      // and remote config changes are the orchestrator's job, done after
      // the agent's turn, not the agent's own.
      disallowedTools: ["Bash(git push*)", "Bash(git config*)", "Bash(rm -rf *)"],
    },
  })) {
    if (message.type === "result") {
      finalResult = message;
    }
  }

  if (!finalResult) {
    throw new Error("Agent query produced no result message (stream ended without one)");
  }

  if (finalResult.subtype === "success") {
    return {
      success: !finalResult.is_error,
      resultText: finalResult.result,
      totalCostUsd: finalResult.total_cost_usd,
      numTurns: finalResult.num_turns,
      subtype: finalResult.subtype,
    };
  }

  return {
    success: false,
    resultText: finalResult.errors.join("; ") || `Agent stopped: ${finalResult.subtype}`,
    totalCostUsd: finalResult.total_cost_usd,
    numTurns: finalResult.num_turns,
    subtype: finalResult.subtype,
  };
};
