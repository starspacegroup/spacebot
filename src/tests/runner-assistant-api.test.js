import { afterEach, describe, expect, it, vi } from 'vitest';

const validateRunnerToken = vi.fn();
const getLatestAIContextSnapshotForUser = vi.fn();
const generateChatResponse = vi.fn();
const isAIEnabled = vi.fn();
const resolveRuntimeModelConfig = vi.fn();

vi.mock('$lib/db/local-runners.js', () => ({
  validateRunnerToken,
}));

vi.mock('$lib/db/ai-orchestration.js', () => ({
  getLatestAIContextSnapshotForUser,
}));

vi.mock('$lib/ai/chat.js', () => ({
  generateChatResponse,
  isAIEnabled,
}));

vi.mock('$lib/server/workers-ai-models.js', () => ({
  resolveRuntimeModelConfig,
}));

afterEach(() => {
  validateRunnerToken.mockReset();
  getLatestAIContextSnapshotForUser.mockReset();
  generateChatResponse.mockReset();
  isAIEnabled.mockReset();
  resolveRuntimeModelConfig.mockReset();
});

describe('runner assistant API', () => {
  it('uses payload guild context when provided', async () => {
    validateRunnerToken.mockResolvedValue({ valid: true, userId: 'user-1', tokenId: 3 });
    getLatestAIContextSnapshotForUser.mockResolvedValue(null);
    isAIEnabled.mockReturnValue(true);
    resolveRuntimeModelConfig.mockResolvedValue({
      primaryModelId: '@cf/meta/llama',
      candidateModelIds: ['@cf/meta/llama'],
      routingStrategy: 'single',
    });
    generateChatResponse.mockResolvedValue({ success: true, response: 'done', toolsUsed: ['get_commands'] });

    const { POST } = await import('../routes/api/runner/assistant/+server.js');

    const selectedGuild = { id: 'guild-1', name: 'Alpha' };
    const request = new Request('http://localhost/api/runner/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sbr_test',
      },
      body: JSON.stringify({
        message: 'list my commands',
        userName: 'Davis',
        managedGuilds: [selectedGuild],
        selectedGuild,
      }),
    });

    const response = await POST({
      request,
      platform: { env: { DB: {}, CLOUDFLARE_AI_TOKEN: 'token' } },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.contextSource).toBe('payload');
    expect(generateChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        userName: 'Davis',
        managedGuilds: [selectedGuild],
        selectedGuild,
        selectedGuildId: 'guild-1',
        selectedGuildName: 'Alpha',
      }),
      expect.any(Object),
    );
  });

  it('falls back to the latest saved snapshot when payload context is absent', async () => {
    validateRunnerToken.mockResolvedValue({ valid: true, userId: 'user-1', tokenId: 3 });
    getLatestAIContextSnapshotForUser.mockResolvedValue({
      userName: 'Saved User',
      managedGuilds: [{ id: 'guild-9', name: 'Saved Guild' }],
      selectedGuild: { id: 'guild-9', name: 'Saved Guild' },
      metadata: { isSuperAdmin: true },
    });
    isAIEnabled.mockReturnValue(true);
    resolveRuntimeModelConfig.mockResolvedValue({
      primaryModelId: '@cf/meta/llama',
      candidateModelIds: ['@cf/meta/llama'],
      routingStrategy: 'single',
    });
    generateChatResponse.mockResolvedValue({ success: true, response: 'snapshot', toolsUsed: [] });

    const { POST } = await import('../routes/api/runner/assistant/+server.js');

    const request = new Request('http://localhost/api/runner/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sbr_test',
      },
      body: JSON.stringify({ message: 'what server am i on?' }),
    });

    const response = await POST({
      request,
      platform: { env: { DB: {}, CLOUDFLARE_AI_TOKEN: 'token' } },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contextSource).toBe('snapshot');
    expect(generateChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'Saved User',
        managedGuilds: [{ id: 'guild-9', name: 'Saved Guild' }],
        selectedGuild: { id: 'guild-9', name: 'Saved Guild' },
        isSuperAdmin: true,
      }),
      expect.any(Object),
    );
  });
});