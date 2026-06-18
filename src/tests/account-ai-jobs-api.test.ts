import { afterEach, describe, expect, it, vi } from "vitest";

const listAIJobsForUser = vi.fn();

vi.mock("$lib/db/ai-orchestration.js", () => ({
  listAIJobsForUser,
}));

afterEach(() => {
  listAIJobsForUser.mockReset();
});

describe("account ai-jobs API", () => {
  it("returns authenticated user jobs", async () => {
    listAIJobsForUser.mockResolvedValue([
      {
        id: 1,
        correlation_id: "aij_1",
        source: "gateway_dm",
        status: "pending",
        request_text: "hello",
        max_attempts: 6,
        attempt_count: 0,
        next_retry_at: null,
        last_error: null,
        created_at: "2026-01-01T00:00:00.000Z",
        started_at: null,
        completed_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const { GET } = await import("../routes/api/account/ai-jobs/+server.js");

    const response = await GET({
      cookies: {
        get(key) {
          return key === "discord_user_id" ? "user-1" : null;
        },
      },
      platform: { env: { DB: {} } },
      url: new URL("http://localhost/api/account/ai-jobs?limit=10"),
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].correlation_id).toBe("aij_1");
    expect(listAIJobsForUser).toHaveBeenCalledWith({}, "user-1", {
      limit: 10,
      offset: 0,
      status: null,
    });
  });
});
