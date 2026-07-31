import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Applying an integration command template records which template it came from,
 * so the integrations page can link back to what it produced instead of leaving
 * the admin to remember whether they'd clicked Add before.
 */

const createCommand = vi.fn();
const getCommandByName = vi.fn();
const getEnabledGuildIntegrations = vi.fn();
const verifyGuildAdmin = vi.fn();
const syncGuildCommands = vi.fn();

vi.mock('$lib/db/commands.js', () => ({
	createCommand,
	getCommandByName,
	ACTION_TYPES: { SEND_MESSAGE: {} },
}));
vi.mock('$lib/db/integrations.js', () => ({ getEnabledGuildIntegrations }));
vi.mock('$lib/discord/guilds.js', () => ({ verifyGuildAdmin }));
vi.mock('$lib/discord/commands.js', () => ({ syncGuildCommands }));

const TEMPLATE = {
	key: 'verse',
	name: 'verse',
	description: 'Generate a heartfelt poem for someone',
	action_type: 'agapeverse.generate_poem',
	action_config: {},
};

function integrationRow() {
	return {
		id: 7,
		slug: 'agapeverse',
		manifest: {
			slug: 'agapeverse',
			actions: [{ key: 'agapeverse.generate_poem', name: 'Generate Poem' }],
			command_templates: [TEMPLATE],
		},
	};
}

function requestEvent(body: any = { slug: 'agapeverse', template_key: 'verse' }) {
	return {
		params: { guildId: '1298613896277393430' },
		request: new Request('https://spacebot.starspace.group/x', {
			method: 'POST',
			body: JSON.stringify(body),
		}),
		cookies: { get: () => 'token' } as any,
		platform: { env: { DB: {} } },
	};
}

beforeEach(() => {
	verifyGuildAdmin.mockResolvedValue({ authorized: true });
	getEnabledGuildIntegrations.mockResolvedValue([integrationRow()]);
	getCommandByName.mockResolvedValue(null);
	createCommand.mockResolvedValue({ success: true, id: 42 });
	syncGuildCommands.mockResolvedValue(undefined);
	// created_by resolution is best-effort; keep it from hitting the network.
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'user-1' }) })
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('apply-integration-template', () => {
	it('stamps the created command with its source template', async () => {
		const { POST }: any =
			await import('../routes/api/commands/[guildId]/apply-integration-template/+server.js');

		const response = await POST(requestEvent());
		expect(response.status).toBe(201);

		const created = createCommand.mock.calls[0][1];
		expect(created.source_integration_slug).toBe('agapeverse');
		expect(created.source_template_key).toBe('verse');
	});

	it('returns the id and disabled state the client needs to render a link', async () => {
		const { POST }: any =
			await import('../routes/api/commands/[guildId]/apply-integration-template/+server.js');

		const body = await (await POST(requestEvent())).json();

		expect(body).toMatchObject({
			success: true,
			id: 42,
			name: 'verse',
			enabled: false,
			slug: 'agapeverse',
			template_key: 'verse',
		});
	});

	it('stamps the same template on a suffixed re-apply', async () => {
		// Re-applying makes a fresh copy under a free name -- provenance has to
		// follow the copy, or the second one goes missing from the template's list.
		getCommandByName.mockResolvedValueOnce({ id: 1, name: 'verse' }).mockResolvedValue(null);

		const { POST }: any =
			await import('../routes/api/commands/[guildId]/apply-integration-template/+server.js');
		const body = await (await POST(requestEvent())).json();

		expect(body.name).toBe('verse-2');
		const created = createCommand.mock.calls[0][1];
		expect(created.source_template_key).toBe('verse');
	});
});

describe('getTemplateAppliedCommands', () => {
	function fakeDb(rows: any[]) {
		const stmt = {
			bind() {
				return stmt;
			},
			async all() {
				return { results: rows };
			},
		};
		return { prepare: () => stmt };
	}

	it('groups commands by "<slug>:<template_key>"', async () => {
		const { getTemplateAppliedCommands }: any = await vi.importActual('../lib/db/commands.js');

		const result = await getTemplateAppliedCommands(
			fakeDb([
				{
					id: 1,
					name: 'verse',
					enabled: 0,
					source_integration_slug: 'agapeverse',
					source_template_key: 'verse',
				},
				{
					id: 2,
					name: 'verse-2',
					enabled: 1,
					source_integration_slug: 'agapeverse',
					source_template_key: 'verse',
				},
				{
					id: 3,
					name: 'issue',
					enabled: 1,
					source_integration_slug: 'github',
					source_template_key: 'new-issue',
				},
			]),
			'1298613896277393430'
		);

		expect(result['agapeverse:verse']).toEqual([
			{ id: 1, name: 'verse', enabled: false },
			{ id: 2, name: 'verse-2', enabled: true },
		]);
		expect(result['github:new-issue']).toEqual([{ id: 3, name: 'issue', enabled: true }]);
	});

	it('returns an empty map without a db or guild', async () => {
		const { getTemplateAppliedCommands }: any = await vi.importActual('../lib/db/commands.js');

		await expect(getTemplateAppliedCommands(null, 'g')).resolves.toEqual({});
		await expect(getTemplateAppliedCommands(fakeDb([]), '')).resolves.toEqual({});
	});
});
