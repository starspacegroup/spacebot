import { describe, it, expect, vi } from 'vitest';

const setPurge = vi.fn(async () => ({ success: true }));
const saveModels = vi.fn(async () => ({ success: false, error: 'stop here' }));

vi.mock('$lib/server/message-purge-settings.js', () => ({
	getMessagePurgeSettings: vi.fn(async () => ({})),
	setMessagePurgeSettings: (...a: unknown[]) => (setPurge as any)(...a),
	MIN_MAX_BATCHES: 1,
	MAX_MAX_BATCHES: 100,
}));
vi.mock('$lib/server/workers-ai-models.js', () => ({
	getCachedWorkersAICatalog: vi.fn(),
	getModelSelection: vi.fn(),
	isCatalogStale: vi.fn(),
	saveModelSelection: (...a: unknown[]) => (saveModels as any)(...a),
	syncWorkersAICatalog: vi.fn(),
}));
vi.mock('$lib/ai/chat.js', () => ({ DEFAULT_MODEL: 'm' }));

import { PATCH as patchPurge } from '../routes/api/superadmin/settings/message-purge/+server.js';
import { PATCH as patchModels } from '../routes/api/superadmin/workers-ai/models/+server.js';

const platform = { env: { ADMIN_USER_IDS: 'admin1', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', { method: 'PATCH', body }),
		cookies: { get: (n: string) => (n === 'discord_user_id' ? 'admin1' : undefined) },
		platform,
	} as any;
}

describe('superadmin settings request bodies', () => {
	for (const bad of ['', 'not json', 'null', '7', '[]']) {
		it(`message-purge PATCH answers 400 for body ${JSON.stringify(bad)}`, async () => {
			setPurge.mockClear();
			const res = await patchPurge(event(bad));
			expect(res.status).toBe(400);
			expect(setPurge).not.toHaveBeenCalled();
		});

		it(`workers-ai models PATCH answers 400 for body ${JSON.stringify(bad)}`, async () => {
			saveModels.mockClear();
			const res = await patchModels(event(bad));
			expect(res.status).toBe(400);
			expect(saveModels).not.toHaveBeenCalled();
		});
	}

	it('message-purge PATCH passes an object body on', async () => {
		setPurge.mockClear();
		const res = await patchPurge(event('{}'));
		expect(res.status).toBe(200);
		expect(setPurge).toHaveBeenCalledOnce();
	});
});
