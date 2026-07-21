import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	isIntegrationActionType,
	resolveConfigValue,
	resolveActionConfig,
	executeIntegrationAction,
} from '../lib/integrations/actions.js';
import { getGuildContributedActions } from '../lib/db/integrations.js';

/**
 * Minimal fake D1 that returns `rows` from .all() (used by
 * getEnabledGuildIntegrations) and rows[0] from .first().
 */
function fakeDb(rows: any[]) {
	const stmt = {
		bind() {
			return stmt;
		},
		async all() {
			return { results: rows };
		},
		async first() {
			return rows[0] ?? null;
		},
		async run() {
			return {};
		},
	};
	return { prepare: () => stmt };
}

/** A guild_integrations JOIN row as getEnabledGuildIntegrations returns it. */
function agapeverseRow(overrides: any = {}) {
	return {
		id: 7,
		slug: 'agapeverse',
		name: 'AgapeVerse',
		icon: '📜',
		status: 'online',
		manifest_json: JSON.stringify({
			slug: 'agapeverse',
			actions: [
				{
					key: 'agapeverse.generate_poem',
					name: 'Generate Poem',
					configSchema: { theme: { type: 'text' } },
					returns: ['poem', 'title'],
				},
			],
			webhooks: { action_handler: 'https://agapeverse.app/api/spacebot/action' },
		}),
		guild_config: '{}',
		...overrides,
	};
}

describe('isIntegrationActionType', () => {
	it('treats dotted keys as integration actions', () => {
		expect(isIntegrationActionType('agapeverse.generate_poem')).toBe(true);
	});
	it('rejects built-in ALL_CAPS action types', () => {
		expect(isIntegrationActionType('SEND_MESSAGE')).toBe(false);
		expect(isIntegrationActionType('NONE')).toBe(false);
		expect(isIntegrationActionType(undefined)).toBe(false);
	});
});

describe('resolveConfigValue', () => {
	const event = { options: { theme: 'the sea' } };

	it('resolves "option:<name>" refs from event.options', () => {
		expect(resolveConfigValue('option:theme', event)).toBe('the sea');
	});
	it('returns empty string for a missing option ref', () => {
		expect(resolveConfigValue('option:missing', event)).toBe('');
	});
	it('passes literal strings through', () => {
		expect(resolveConfigValue('free', event)).toBe('free');
	});
	it('resolves { source: "option" } objects', () => {
		expect(resolveConfigValue({ source: 'option', option: 'theme' }, event)).toBe('the sea');
	});
	it('resolves { source: "static" } objects', () => {
		expect(resolveConfigValue({ source: 'static', value: 'sonnet' }, event)).toBe('sonnet');
	});
});

describe('resolveActionConfig', () => {
	it('resolves each entry against the event', () => {
		const event = { options: { theme: 'hope' } };
		const resolved = resolveActionConfig({ theme: 'option:theme', style: 'free' }, event);
		expect(resolved).toEqual({ theme: 'hope', style: 'free' });
	});
});

describe('getGuildContributedActions (configSchema normalization)', () => {
	it('aliases string→text and select choices→options so the builder renders them', async () => {
		const row = agapeverseRow({
			manifest_json: JSON.stringify({
				slug: 'agapeverse',
				actions: [
					{
						key: 'agapeverse.generate_poem',
						name: 'Generate Poem',
						configSchema: {
							theme: { type: 'string', label: 'Theme' },
							style: { type: 'select', label: 'Style', choices: ['haiku', 'free'] },
						},
					},
				],
			}),
		});
		const actions: any = await getGuildContributedActions(fakeDb([row]), '123');
		const schema = actions['agapeverse.generate_poem'].configSchema;
		expect(schema.theme.type).toBe('text');
		expect(schema.style.options).toEqual(['haiku', 'free']);
		expect(actions['agapeverse.generate_poem'].integration.slug).toBe('agapeverse');
	});
});

describe('executeIntegrationAction', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('proxies to the action handler and exposes returned fields as {action.*}', async () => {
		(fetch as any).mockResolvedValue({
			ok: true,
			json: async () => ({ result: { poem: 'Roses are red', title: 'Roses' } }),
		});

		const context: any = {};
		const res = await executeIntegrationAction({
			db: fakeDb([agapeverseRow()]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: { theme: 'option:theme' },
			event: {
				guild_id: '123',
				actor_id: '99',
				actor_name: 'dave',
				channel_id: '5',
				options: { theme: 'roses' },
			},
			context,
		});

		expect(res.success).toBe(true);
		expect(res.result).toEqual({ poem: 'Roses are red', title: 'Roses' });
		expect(context.action).toEqual({ poem: 'Roses are red', title: 'Roses' });

		// The resolved config (theme: roses) was sent to the handler.
		const [url, init] = (fetch as any).mock.calls[0];
		expect(url).toBe('https://agapeverse.app/api/spacebot/action');
		const body = JSON.parse(init.body);
		expect(body.action_key).toBe('agapeverse.generate_poem');
		expect(body.config).toEqual({ theme: 'roses' });
		expect(init.headers['X-SpaceBot-Integration']).toBe('agapeverse');
	});

	it('returns a direct response when the handler sends content/embeds', async () => {
		(fetch as any).mockResolvedValue({
			ok: true,
			json: async () => ({ content: 'A poem for you' }),
		});
		const res = await executeIntegrationAction({
			db: fakeDb([agapeverseRow()]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: {},
			event: { guild_id: '123', options: {} },
			context: {},
		});
		expect(res.success).toBe(true);
		expect(res.response).toEqual({ content: 'A poem for you', embeds: undefined });
	});

	it('forwards the handler-chosen `ephemeral` flag on the direct response', async () => {
		(fetch as any).mockResolvedValue({
			ok: true,
			json: async () => ({ embeds: [{ title: 'Ode' }], ephemeral: false }),
		});
		const res = await executeIntegrationAction({
			db: fakeDb([agapeverseRow()]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: {},
			event: { guild_id: '123', options: {} },
			context: {},
		});
		expect(res.response).toEqual({
			content: undefined,
			embeds: [{ title: 'Ode' }],
			ephemeral: false,
		});
	});

	it('fails when the action is not from an enabled integration', async () => {
		const res = await executeIntegrationAction({
			db: fakeDb([]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: {},
			event: { guild_id: '123', options: {} },
			context: {},
		});
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/not provided by an enabled integration/);
	});

	it('fails when the integration is offline', async () => {
		const res = await executeIntegrationAction({
			db: fakeDb([agapeverseRow({ status: 'offline' })]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: {},
			event: { guild_id: '123', options: {} },
			context: {},
		});
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/offline/);
	});

	it('fails gracefully when the handler errors', async () => {
		(fetch as any).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
		const res = await executeIntegrationAction({
			db: fakeDb([agapeverseRow()]),
			guildId: '123',
			actionType: 'agapeverse.generate_poem',
			actionConfig: {},
			event: { guild_id: '123', options: {} },
			context: {},
		});
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/failed to run/);
	});
});
