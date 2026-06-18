import { afterEach, describe, expect, it, vi } from "vitest";
import { isAIEnabled, isOllamaSelected, generateChatResponse } from "../lib/ai/chat.js";

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = undefined as unknown as typeof fetch;
});

describe("Ollama provider selection (dev-only app AI)", () => {
  it("isOllamaSelected is true only when AI_PROVIDER=ollama", () => {
    expect(isOllamaSelected({ AI_PROVIDER: "ollama" })).toBe(true);
    expect(isOllamaSelected({ AI_PROVIDER: "OLLAMA" })).toBe(true);
    expect(isOllamaSelected({ AI_PROVIDER: "workers-ai" })).toBe(false);
    expect(isOllamaSelected({})).toBe(false);
  });

  it("isAIEnabled is true for Ollama selection OR Cloudflare creds, false otherwise", () => {
    expect(isAIEnabled({ AI_PROVIDER: "ollama" })).toBe(true);
    expect(isAIEnabled({ CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_AI_TOKEN: "tok" })).toBe(true);
    expect(isAIEnabled({})).toBe(false);
  });

  it("generateChatResponse routes to local Ollama at :11434 and returns its text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "Hello from gemma3:4b" } }),
      text: async () => "",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateChatResponse(
      { message: "hi", userName: "Tester", history: [], managedGuilds: [] },
      { AI_PROVIDER: "ollama", OLLAMA_MODEL: "gemma3:4b" },
    );

    expect(result.success).toBe(true);
    expect(result.response).toBe("Hello from gemma3:4b");

    // Verify it hit the local Ollama chat endpoint with the configured model.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("localhost:11434/api/chat");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gemma3:4b");
    // Workers AI was never contacted.
    expect(String(url)).not.toContain("cloudflare");
  });

  it("does NOT take the Ollama path in production (no AI_PROVIDER) — Workers AI gate is intact", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    // No AI_PROVIDER and no Cloudflare creds → the existing not-configured guard fires,
    // proving the Ollama branch is gated and prod behavior is unchanged.
    const result = await generateChatResponse(
      { message: "hi", userName: "Tester", history: [], managedGuilds: [] },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
