import { afterEach, describe, expect, it, vi } from "vitest";

const claimAIJobForExecution = vi.fn();
const appendAIJobEvent = vi.fn();
const completeAIJob = vi.fn();
const failAIJobTerminal = vi.fn();
const getAIJobById = vi.fn();
const scheduleAIJobRetry = vi.fn();
const generateChatResponse = vi.fn();
const chooseRetryDecision = vi.fn();
const getRunnerInstances = vi.fn();
const createRunnerJob = vi.fn();
// Mirrors the real policy: no valid guild → "no_guild_context" (personal job,
// ownership-authorized); a valid guild here is treated as DENIED ("guild_not_enabled").
const evaluateLocalRunnerAssistAccess = vi.fn(async (_db: unknown, { guildId }: { guildId?: string }) => {
  const valid = /^\d{17,20}$/.test(String(guildId || ""));
  return valid
    ? { allowed: false, reason: "guild_not_enabled" }
    : { allowed: false, reason: "no_guild_context" };
});

vi.mock("$lib/db/ai-orchestration.js", () => ({
  appendAIJobEvent,
  claimAIJobForExecution,
  completeAIJob,
  failAIJobTerminal,
  getAIJobById,
  scheduleAIJobRetry,
}));

vi.mock("$lib/ai/chat.js", () => ({
  generateChatResponse,
}));

vi.mock("$lib/ai/retry-policy.js", () => ({
  chooseRetryDecision,
}));

vi.mock("$lib/db/local-runners.js", () => ({
  getRunnerInstances,
  createRunnerJob,
}));

vi.mock("$lib/local-runner-assist-policy.js", () => ({
  evaluateLocalRunnerAssistAccess,
}));

afterEach(() => {
  claimAIJobForExecution.mockReset();
  appendAIJobEvent.mockReset();
  completeAIJob.mockReset();
  failAIJobTerminal.mockReset();
  getAIJobById.mockReset();
  scheduleAIJobRetry.mockReset();
  generateChatResponse.mockReset();
  chooseRetryDecision.mockReset();
  getRunnerInstances.mockReset();
  createRunnerJob.mockReset();
  evaluateLocalRunnerAssistAccess.mockClear();
  global.fetch = undefined;
});

describe("ai execute route runner fallback", () => {
  it("dispatches to runner when retry decision suggests runner switch", async () => {
    claimAIJobForExecution.mockResolvedValue({
      success: true,
      job: {
        id: 5,
        correlation_id: "aij_5",
        user_id: "user-1",
        user_name: "Davis",
        request_text: "do thing",
        history_json: [],
        managed_guilds_json: [],
        selected_guild_json: null,
        metadata_json: {},
        attempt_count: 1,
        max_attempts: 6,
      },
    });

    generateChatResponse.mockRejectedValue(new Error("503 unavailable"));

    getAIJobById.mockResolvedValue({
      id: 5,
      correlation_id: "aij_5",
      user_id: "user-1",
      user_name: "Davis",
      request_text: "do thing",
      history_json: [],
      provider_chain_json: ["workers-ai", "runner"],
      attempt_count: 1,
      max_attempts: 6,
      created_at: new Date().toISOString(),
    });

    chooseRetryDecision.mockReturnValue({
      retry: true,
      reason: "bounded_retry",
      errorClass: "transient_transport",
      nextRetryDelayMs: 1000,
      providerSwitchHint: { from: "workers-ai", to: "runner" },
    });

    getRunnerInstances.mockResolvedValue([
      { id: 9, runner_token_id: 88, display_name: "Dirac", hostname: "dirac-host", is_online: true },
    ]);

    createRunnerJob.mockResolvedValue({ success: true, jobId: 321 });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "dm-channel" }),
      text: async () => "",
    });

    const { POST } = await import("../routes/api/ai/jobs/execute/+server.js");

    const request = new Request("http://localhost/api/ai/jobs/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bot test-token",
      },
      body: JSON.stringify({ jobId: 5 }),
    });

    const response = await POST({
      request,
      platform: {
        env: {
          DB: {},
          DISCORD_BOT_TOKEN: "test-token",
        },
      },
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runnerFallback).toBe(true);
    expect(body.runnerJobId).toBe(321);
    expect(completeAIJob).toHaveBeenCalled();
    expect(scheduleAIJobRetry).not.toHaveBeenCalled();
  });

  it("does NOT dispatch to a runner when the guild policy denies, even if the AI assessor requests a runner switch", async () => {
    const guildJob = {
      id: 7,
      correlation_id: "aij_7",
      user_id: "user-1",
      user_name: "Davis",
      request_text: "do thing",
      history_json: [],
      managed_guilds_json: [],
      selected_guild_json: null,
      metadata_json: {},
      attempt_count: 1,
      max_attempts: 6,
      // Guild-scoped job → must satisfy the guild runner-assist policy (mocked DENY).
      guild_id: "111111111111111111",
    };
    claimAIJobForExecution.mockResolvedValue({ success: true, job: guildJob });
    generateChatResponse.mockRejectedValue(new Error("503 unavailable"));
    getAIJobById.mockResolvedValue({
      ...guildJob,
      provider_chain_json: ["workers-ai", "runner"],
      created_at: new Date().toISOString(),
    });
    chooseRetryDecision.mockReturnValue({
      retry: true,
      reason: "bounded_retry",
      errorClass: "transient_transport",
      nextRetryDelayMs: 1000,
      providerSwitchHint: { from: "workers-ai", to: "runner" },
    });
    getRunnerInstances.mockResolvedValue([
      { id: 9, runner_token_id: 88, display_name: "Dirac", hostname: "dirac-host", is_online: true },
    ]);
    createRunnerJob.mockResolvedValue({ success: true, jobId: 321 });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "dm-channel" }), text: async () => "" });

    const { POST } = await import("../routes/api/ai/jobs/execute/+server.js");
    const request = new Request("http://localhost/api/ai/jobs/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bot test-token" },
      body: JSON.stringify({ jobId: 7 }),
    });

    const response = await POST({
      request,
      platform: { env: { DB: {}, DISCORD_BOT_TOKEN: "test-token" } },
    } as any);
    const body = await response.json();

    // The AI's providerSwitchHint=runner must NOT bypass the guild authorization gate.
    expect(evaluateLocalRunnerAssistAccess).toHaveBeenCalled();
    expect(createRunnerJob).not.toHaveBeenCalled();
    expect(body.runnerFallback).not.toBe(true);
    expect(scheduleAIJobRetry).toHaveBeenCalled();
  });
});
