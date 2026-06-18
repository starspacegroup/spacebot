import { afterEach, describe, expect, it, vi } from "vitest";

const createAIJob = vi.fn();
const appendAIJobEvent = vi.fn();

vi.mock("$lib/db/ai-orchestration.js", () => ({
  createAIJob,
  appendAIJobEvent,
}));

afterEach(() => {
  createAIJob.mockReset();
  appendAIJobEvent.mockReset();
});

describe("gateway dm-autopilot API", () => {
  it("queues a job and enqueues queue message when binding is present", async () => {
    createAIJob.mockResolvedValue({
      success: true,
      jobId: 42,
      correlationId: "aij_123",
      status: "pending",
    });

    const queueSend = vi.fn().mockResolvedValue(undefined);
    const { POST } = await import("../routes/api/gateway/dm-autopilot/+server.js");

    const request = new Request("http://localhost/api/gateway/dm-autopilot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bot test-token",
      },
      body: JSON.stringify({
        userId: "user-1",
        userName: "Davis",
        content: "hello",
      }),
    });

    const response = await POST({
      request,
      platform: {
        env: {
          DB: {},
          DISCORD_BOT_TOKEN: "test-token",
          AI_AUTOPILOT_QUEUE: { send: queueSend },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBe(true);
    expect(body.queueAccepted).toBe(true);
    expect(body.jobId).toBe(42);

    expect(createAIJob).toHaveBeenCalledTimes(1);
    expect(queueSend).toHaveBeenCalledWith({
      type: "ai_job_created",
      jobId: 42,
      correlationId: "aij_123",
    });
  });
});
