import { afterEach, describe, expect, it, vi } from 'vitest';

const validateRunnerToken = vi.fn();
const getAllGuildMetadata = vi.fn();
const getGuildMetadataBatch = vi.fn();
const getLatestAIContextSnapshotForUser = vi.fn();

vi.mock('$lib/db/local-runners.js', () => ({
	validateRunnerToken,
}));

vi.mock('$lib/db/guild-metadata.js', () => ({
	getAllGuildMetadata,
	getGuildMetadataBatch,
}));

vi.mock('$lib/db/ai-orchestration.js', () => ({
	getLatestAIContextSnapshotForUser,
}));

function makeRequest(token?: string) {
	return new Request('https://spacebot.starspace.group/api/runner/guilds', {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
}

afterEach(() => {
	validateRunnerToken.mockReset();
	getAllGuildMetadata.mockReset();
	getGuildMetadataBatch.mockReset();
	getLatestAIContextSnapshotForUser.mockReset();
});

describe('GET /api/runner/guilds', () => {
	it('rejects an invalid or missing runner token', async () => {
		const { GET }: any = await import('../routes/api/runner/guilds/+server.js');
		validateRunnerToken.mockResolvedValue({ valid: false, error: 'Token not found' });

		const response = await GET({
			request: makeRequest('sbr_bad'),
			platform: { env: { DB: {}, ADMIN_USER_IDS: 'owner-1' } },
		});

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBe('Token not found');
	});

	it('returns every guild for a superadmin', async () => {
		const { GET }: any = await import('../routes/api/runner/guilds/+server.js');
		validateRunnerToken.mockResolvedValue({ valid: true, userId: 'owner-1' });
		getAllGuildMetadata.mockResolvedValue([{ guild_id: 'g1', name: 'Guild One' }]);

		const response = await GET({
			request: makeRequest('sbr_good'),
			platform: { env: { DB: {}, ADMIN_USER_IDS: 'owner-1' } },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.scope).toBe('all');
		expect(body.guilds).toEqual([{ guild_id: 'g1', name: 'Guild One' }]);
		expect(getLatestAIContextSnapshotForUser).not.toHaveBeenCalled();
	});

	it('scopes non-superadmin users to their managed-guilds snapshot', async () => {
		const { GET }: any = await import('../routes/api/runner/guilds/+server.js');
		validateRunnerToken.mockResolvedValue({ valid: true, userId: 'regular-user' });
		getLatestAIContextSnapshotForUser.mockResolvedValue({
			managedGuilds: [{ id: 'g2', name: 'Managed Guild', isOwner: true, isAdmin: true }],
		});
		getGuildMetadataBatch.mockResolvedValue(
			new Map([
				['g2', { guild_id: 'g2', name: 'Managed Guild', approximate_member_count: 42 }],
			])
		);

		const response = await GET({
			request: makeRequest('sbr_good'),
			platform: { env: { DB: {}, ADMIN_USER_IDS: 'owner-1' } },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.scope).toBe('managed');
		expect(body.guilds).toEqual([
			{
				guild_id: 'g2',
				name: 'Managed Guild',
				approximate_member_count: 42,
				isOwner: true,
				isAdmin: true,
			},
		]);
		expect(getAllGuildMetadata).not.toHaveBeenCalled();
	});
});
