import { afterEach, describe, expect, it, vi } from 'vitest';

const getCachedWorkersAICatalog = vi.fn();
const getModelSelection = vi.fn();
const isCatalogStale = vi.fn();
const saveModelSelection = vi.fn();
const syncWorkersAICatalog = vi.fn();

vi.mock('$lib/server/workers-ai-models.js', () => ({
  getCachedWorkersAICatalog,
  getModelSelection,
  isCatalogStale,
  saveModelSelection,
  syncWorkersAICatalog,
}));

vi.mock('$lib/ai/chat.js', () => ({
  DEFAULT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
}));

afterEach(() => {
  getCachedWorkersAICatalog.mockReset();
  getModelSelection.mockReset();
  isCatalogStale.mockReset();
  saveModelSelection.mockReset();
  syncWorkersAICatalog.mockReset();
});

interface CreateEventOptions {
  method?: string;
  url?: string;
  body?: unknown;
  userId?: string;
  adminIds?: string;
}

function createEvent({
  method = 'GET',
  url = 'http://localhost/api/superadmin/workers-ai/models',
  body,
  userId,
  adminIds = 'super-1,super-2',
}: CreateEventOptions = {}): any {
  return {
    request: new Request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    cookies: {
      get(name) {
        return name === 'discord_user_id' ? userId : undefined;
      },
    },
    platform: {
      env: {
        ADMIN_USER_IDS: adminIds,
        DB: {},
      },
    },
    url: new URL(url),
  };
}

describe('superadmin workers ai models API', () => {
  it('returns forbidden when discord_user_id cookie is missing', async () => {
    const { GET } = await import('../routes/api/superadmin/workers-ai/models/+server.js');

    const response = await GET(createEvent({ userId: undefined }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns cached catalog without auto-sync when stale', async () => {
    getCachedWorkersAICatalog.mockResolvedValue({
      models: [{ id: '@cf/foo/old-model' }],
      syncedAt: 'old',
    });
    isCatalogStale.mockImplementation((syncedAt) => syncedAt === 'old');
    getModelSelection.mockResolvedValue({
      selectedModelIds: ['@cf/foo/old-model'],
      primaryModelId: '@cf/foo/old-model',
      routingStrategy: 'fallback',
    });

    const { GET } = await import('../routes/api/superadmin/workers-ai/models/+server.js');

    const response = await GET(createEvent({ userId: 'super-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe('database');
    expect(body.stale).toBe(true);
    expect(body.models).toEqual([{ id: '@cf/foo/old-model' }]);
    expect(syncWorkersAICatalog).not.toHaveBeenCalled();
  });

  it('syncs from cloudflare when force=1 is set', async () => {
    getCachedWorkersAICatalog.mockResolvedValue({
      models: [{ id: '@cf/foo/old-model' }],
      syncedAt: 'old',
    });
    isCatalogStale.mockImplementation((syncedAt) => syncedAt === 'old');
    syncWorkersAICatalog.mockResolvedValue({
      models: [{ id: '@cf/foo/new-model' }],
      syncedAt: 'fresh',
    });
    getModelSelection.mockResolvedValue({
      selectedModelIds: ['@cf/foo/new-model'],
      primaryModelId: '@cf/foo/new-model',
      routingStrategy: 'fallback',
    });

    const { GET } = await import('../routes/api/superadmin/workers-ai/models/+server.js');

    const response = await GET(createEvent({
      userId: 'super-1',
      url: 'http://localhost/api/superadmin/workers-ai/models?force=1',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe('cloudflare');
    expect(body.stale).toBe(false);
    expect(body.models).toEqual([{ id: '@cf/foo/new-model' }]);
    expect(syncWorkersAICatalog).toHaveBeenCalledTimes(1);
  });

  it('allows PATCH auth via cookies object even without cookie header parsing', async () => {
    saveModelSelection.mockResolvedValue({ success: true });
    getModelSelection.mockResolvedValue({
      selectedModelIds: ['@cf/google/gemma-3-7b-it-lora'],
      primaryModelId: '@cf/google/gemma-3-7b-it-lora',
      routingStrategy: 'fallback',
    });

    const { PATCH } = await import('../routes/api/superadmin/workers-ai/models/+server.js');

    const response = await PATCH(
      createEvent({
        method: 'PATCH',
        userId: 'super-1',
        body: {
          selectedModelIds: ['@cf/google/gemma-3-7b-it-lora'],
          primaryModelId: '@cf/google/gemma-3-7b-it-lora',
          routingStrategy: 'fallback',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(saveModelSelection).toHaveBeenCalledTimes(1);
  });
});
