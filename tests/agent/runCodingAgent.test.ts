// Mocks the SDK boundary itself (the one seam this file exists to wrap —
// see runCodingAgent.ts's own header comment) specifically to cover the
// behavior a live run surfaced that no other test caught: query() can
// throw instead of yielding a "result" message. See docs/DECISIONS.md.
import { describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

const { runCodingAgent } = await import("../../src/agent/runCodingAgent");

function fakeStream(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
  };
}

describe("runCodingAgent", () => {
  it("returns the result message on success", async () => {
    queryMock.mockReturnValue(
      fakeStream([
        { type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.01, num_turns: 2 },
      ]),
    );

    const result = await runCodingAgent({ cwd: "/fake", prompt: "do it", maxTurns: 5 });
    expect(result).toEqual({ success: true, resultText: "done", totalCostUsd: 0.01, numTurns: 2, subtype: "success" });
  });

  it("returns a failed result for an error subtype message rather than throwing", async () => {
    queryMock.mockReturnValue(
      fakeStream([
        { type: "result", subtype: "error_max_turns", is_error: true, errors: ["gave up"], total_cost_usd: 0.02, num_turns: 5 },
      ]),
    );

    const result = await runCodingAgent({ cwd: "/fake", prompt: "do it", maxTurns: 5 });
    expect(result.success).toBe(false);
    expect(result.subtype).toBe("error_max_turns");
  });

  it("returns a failed result instead of throwing when query() itself throws (observed on a live run)", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        throw new Error("Claude Code returned an error result: Reached maximum number of turns (3)");
      },
    });

    const result = await runCodingAgent({ cwd: "/fake", prompt: "review it", maxTurns: 3 });
    expect(result.success).toBe(false);
    expect(result.subtype).toBe("error_max_turns");
    expect(result.resultText).toContain("maximum number of turns");
  });

  it("classifies an unrecognized thrown error as error_thrown rather than crashing", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        throw new Error("something else went wrong");
      },
    });

    const result = await runCodingAgent({ cwd: "/fake", prompt: "do it", maxTurns: 5 });
    expect(result.success).toBe(false);
    expect(result.subtype).toBe("error_thrown");
  });

  it("returns a failed result if the stream ends with no result message at all", async () => {
    queryMock.mockReturnValue(fakeStream([{ type: "assistant", text: "..." }]));

    const result = await runCodingAgent({ cwd: "/fake", prompt: "do it", maxTurns: 5 });
    expect(result.success).toBe(false);
    expect(result.subtype).toBe("error_no_result");
  });
});
