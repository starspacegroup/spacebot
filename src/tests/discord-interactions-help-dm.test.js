import { describe, expect, it, vi } from "vitest";

vi.mock("discord-interactions", () => ({
  InteractionResponseType: {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  },
  InteractionType: {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
  },
  verifyKey: vi.fn(() => true),
}));

describe("discord interactions DM help", () => {
  it("returns the built-in help embed in DMs", async () => {
    const { POST } = await import("../routes/api/discord/interactions/+server.js");

    const request = new Request("http://localhost/api/discord/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature-ed25519": "test-signature",
        "x-signature-timestamp": "1234567890",
      },
      body: JSON.stringify({
        type: 2,
        data: { name: "help" },
        token: "interaction-token",
        application_id: "app-1",
        channel_id: "dm-1",
        user: {
          id: "user-1",
          username: "davis",
        },
      }),
    });

    const response = await POST({
      request,
      platform: {
        env: {
          DISCORD_PUBLIC_KEY: "00",
        },
      },
    });

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.type).toBe(4);
    expect(payload.data?.embeds?.[0]?.title).toBe("🚀 SpaceBot Help");
  });
});
