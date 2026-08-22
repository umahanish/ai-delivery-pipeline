import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimitsForTests } from "../../src/lib/rateLimit";

afterEach(() => {
  resetRateLimitsForTests();
});

describe("checkRateLimit", () => {
  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("key1", 5, 60_000).allowed).toBe(true);
    }
  });

  it("blocks the request once the limit is exceeded within the window", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("key2", 5, 60_000);
    const result = checkRateLimit("key2", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks each key independently", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("keyA", 5, 60_000);
    expect(checkRateLimit("keyA", 5, 60_000).allowed).toBe(false);
    expect(checkRateLimit("keyB", 5, 60_000).allowed).toBe(true);
  });

  it("resets once the window elapses", async () => {
    // Real short window + real short wait, rather than mocking Date/timers
    // -- checkRateLimit is a plain Date.now() consumer, nothing about it
    // needs fake-timer machinery to test correctly.
    for (let i = 0; i < 3; i++) checkRateLimit("keyC", 3, 30);
    expect(checkRateLimit("keyC", 3, 30).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(checkRateLimit("keyC", 3, 30).allowed).toBe(true);
  });
});
