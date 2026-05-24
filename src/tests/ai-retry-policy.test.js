import { describe, expect, it } from "vitest";
import { chooseRetryDecision } from "../lib/ai/retry-policy.js";

describe("ai retry policy", () => {
  it("retries transient errors with bounded delay", () => {
    const decision = chooseRetryDecision({
      error: new Error("503 service unavailable"),
      attemptCount: 1,
      maxAttempts: 6,
      firstAttemptAt: Date.now() - 1000,
      providerChain: ["workers-ai", "runner"],
      mode: "bounded",
    });

    expect(decision.retry).toBe(true);
    expect(decision.errorClass).toBe("transient_transport");
    expect(decision.nextRetryDelayMs).toBeGreaterThan(0);
    expect(decision.providerSwitchHint?.to).toBe("runner");
  });

  it("does not retry user-actionable permission errors", () => {
    const decision = chooseRetryDecision({
      error: new Error("forbidden: missing permission"),
      attemptCount: 1,
      maxAttempts: 6,
      firstAttemptAt: Date.now() - 1000,
      mode: "bounded",
    });

    expect(decision.retry).toBe(false);
    expect(decision.reason).toBe("user_action_required");
    expect(decision.errorClass).toBe("user_actionable");
  });

  it("stops retrying after max attempts", () => {
    const decision = chooseRetryDecision({
      error: new Error("timeout"),
      attemptCount: 6,
      maxAttempts: 6,
      firstAttemptAt: Date.now() - 1000,
      mode: "bounded",
    });

    expect(decision.retry).toBe(false);
    expect(decision.reason).toBe("retry_exhausted");
  });
});
