import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	extractNamespacedVariableKeys,
	collectTemplateText,
	getIntegrationVariables,
	augmentContextWithIntegrationVariables,
	_clearVariablesCache,
} from '../lib/integrations/variables.js';
import { getGuildContributedVariables } from '../lib/db/integrations.js';
import { validateManifest } from '../lib/integrations/registry.js';

/**
 * Minimal fake D1 that returns `rows` from .all() (used by
 * getEnabledGuildIntegrations) — same shape as integration-actions.test.ts.
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

/** A guild_integrations JOIN row with declared template variables. */
function agapeverseRow(overrides: any = {}) {
	return {
		id: 7,
		slug: 'agapeverse',
		name: 'AgapeVerse',
		icon: '📜',
		status: 'online',
		manifest_json: JSON.stringify({
			slug: 'agapeverse',
			variables: [
				{
					key: 'agapeverse.account_url',
					label: 'Account link',
					description: "Link to the user's AgapeVerse account page",
					scope: 'user',
				},
				{
					key: 'agapeverse.display_name',
					label: 'Display name',
					scope: 'user',
				},
				{
					key: 'agapeverse.member_count',
					label: 'Member count',
					description: 'Total AgapeVerse members',
					scope: 'global',
				},
			],
			webhooks: { variables_handler: 'https://agapeverse.app/api/spacebot/variables' },
		}),
		guild_config: '{}',
		...overrides,
	};
}

function okFetch(values: Record<string, string>) {
	return vi.fn(async () => ({
		ok: true,
		json: async () => ({ values }),
	})) as any;
}

beforeEach(() => {
	_clearVariablesCache();
});

describe('extractNamespacedVariableKeys', () => {
	it('finds slug-dotted placeholders', () => {
		const keys = extractNamespacedVariableKeys(
			'Hi {user.name}, manage your account at {agapeverse.manage_url} ({agapeverse.display_name})'
		);
		expect(keys.has('agapeverse.manage_url')).toBe(true);
		expect(keys.has('agapeverse.display_name')).toBe(true);
		// Built-in roots match the shape too — filtering happens against declared keys.
		expect(keys.has('user.name')).toBe(true);
	});

	it('ignores non-template braces and empty text', () => {
		expect(extractNamespacedVariableKeys('no vars here').size).toBe(0);
		expect(extractNamespacedVariableKeys('').size).toBe(0);
		expect(extractNamespacedVariableKeys('{UPPER.thing} {no-dot}').size).toBe(0);
	});
});

describe('collectTemplateText', () => {
	it('joins strings and stringified objects', () => {
		const text = collectTemplateText(
			'hello {agapeverse.account_url}',
			{ description: 'embed with {agapeverse.display_name}' },
			null,
			undefined
		);
		expect(text).toContain('{agapeverse.account_url}');
		expect(text).toContain('{agapeverse.display_name}');
	});
});

describe('getIntegrationVariables', () => {
	it('reads variables from manifest_json', () => {
		const row = agapeverseRow();
		const parsed = { ...row, manifest_json: JSON.parse(row.manifest_json) };
		expect(getIntegrationVariables(parsed)).toHaveLength(3);
	});
	it('returns [] when none declared', () => {
		expect(getIntegrationVariables({ manifest_json: { slug: 'x' } })).toEqual([]);
	});
});

describe('validateManifest variables', () => {
	const base = { name: 'AgapeVerse', slug: 'agapeverse' };

	it('accepts namespaced variables with valid scopes', () => {
		const res = validateManifest({
			...base,
			variables: [
				{ key: 'agapeverse.account_url', scope: 'user' },
				{ key: 'agapeverse.member_count', scope: 'global' },
				{ key: 'agapeverse.plain' },
			],
		});
		expect(res.ok).toBe(true);
	});

	it('rejects un-namespaced keys', () => {
		const res = validateManifest({ ...base, variables: [{ key: 'account_url' }] });
		expect(res.ok).toBe(false);
		expect(res.error).toContain('namespaced');
	});

	it('rejects invalid scope', () => {
		const res = validateManifest({
			...base,
			variables: [{ key: 'agapeverse.x', scope: 'guild' }],
		});
		expect(res.ok).toBe(false);
		expect(res.error).toContain('scope');
	});

	it('rejects non-array variables', () => {
		const res = validateManifest({ ...base, variables: {} });
		expect(res.ok).toBe(false);
	});
});

describe('getGuildContributedVariables', () => {
	it('returns a flat key→description map', async () => {
		const db = fakeDb([agapeverseRow()]);
		const vars = await getGuildContributedVariables(db, 'guild-1');
		expect(vars['agapeverse.account_url']).toContain('Account link');
		expect(vars['agapeverse.account_url']).toContain('account page');
		expect(vars['agapeverse.display_name']).toBe('Display name');
		expect(Object.keys(vars)).toHaveLength(3);
	});

	it('returns {} with no db or no enabled integrations', async () => {
		expect(await getGuildContributedVariables(null, 'g')).toEqual({});
		expect(await getGuildContributedVariables(fakeDb([]), 'g')).toEqual({});
	});
});

describe('augmentContextWithIntegrationVariables', () => {
	it('batch-resolves referenced declared keys and merges values', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = okFetch({
			'agapeverse.account_url': 'https://agapeverse.app/u/123',
			'agapeverse.display_name': 'David',
		});
		const context: any = { user: { id: 'u1', name: 'davis' } };

		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: 'Welcome {agapeverse.display_name}! Account: {agapeverse.account_url}',
			context,
			fetchImpl,
		});

		expect(context.agapeverse.account_url).toBe('https://agapeverse.app/u/123');
		expect(context.agapeverse.display_name).toBe('David');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
		expect(body.type).toBe('variables');
		expect(body.discord_user_id).toBe('u1');
		expect(body.keys.sort()).toEqual(['agapeverse.account_url', 'agapeverse.display_name']);
		// Only referenced keys are requested — member_count wasn't in the template.
		expect(body.keys).not.toContain('agapeverse.member_count');
	});

	it('does not call the handler when no declared keys are referenced', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = okFetch({});
		const context: any = { user: { id: 'u1' } };
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: 'Hello {user.name}, nothing integration-y here',
			context,
			fetchImpl,
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(context.agapeverse).toBeUndefined();
	});

	it('merges empty strings when the handler fails', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = vi.fn(async () => {
			throw new Error('boom');
		}) as any;
		const context: any = {};
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: '{agapeverse.account_url}',
			context,
			fetchImpl,
		});
		expect(context.agapeverse.account_url).toBe('');
	});

	it('merges empty strings when variables_handler is missing', async () => {
		const row = agapeverseRow();
		const manifest = JSON.parse(row.manifest_json);
		delete manifest.webhooks.variables_handler;
		row.manifest_json = JSON.stringify(manifest);
		const db = fakeDb([row]);
		const fetchImpl = okFetch({});
		const context: any = {};
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: '{agapeverse.display_name}',
			context,
			fetchImpl,
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(context.agapeverse.display_name).toBe('');
	});

	it('resolves only global-scope variables without a user id', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = okFetch({ 'agapeverse.member_count': '4200' });
		const context: any = {};
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: null,
			text: '{agapeverse.member_count} members — yours: {agapeverse.account_url}',
			context,
			fetchImpl,
		});
		expect(context.agapeverse.member_count).toBe('4200');
		expect(context.agapeverse.account_url).toBe(''); // user-scoped, no user
		const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
		expect(body.keys).toEqual(['agapeverse.member_count']);
	});

	it('caches values per (integration, guild, user)', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = okFetch({ 'agapeverse.display_name': 'David' });
		const mk = () => ({});
		const args = (context: any) => ({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: '{agapeverse.display_name}',
			context,
			fetchImpl,
		});
		const c1: any = mk();
		await augmentContextWithIntegrationVariables(args(c1));
		const c2: any = mk();
		await augmentContextWithIntegrationVariables(args(c2));
		expect(c1.agapeverse.display_name).toBe('David');
		expect(c2.agapeverse.display_name).toBe('David');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('is idempotent — keys already on the context are not re-fetched', async () => {
		const db = fakeDb([agapeverseRow()]);
		const fetchImpl = okFetch({ 'agapeverse.display_name': 'David' });
		const context: any = { agapeverse: { display_name: 'Already Here' } };
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: '{agapeverse.display_name}',
			context,
			fetchImpl,
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(context.agapeverse.display_name).toBe('Already Here');
	});

	it('never clobbers built-in context roots', async () => {
		// A malicious/buggy manifest declaring "agapeverse.user.id"-style keys can't
		// overwrite non-object built-ins; and slug-rooted merges stay under the slug.
		const row = agapeverseRow();
		const manifest = JSON.parse(row.manifest_json);
		manifest.variables.push({ key: 'agapeverse.deep.nested_value', scope: 'user' });
		row.manifest_json = JSON.stringify(manifest);
		const db = fakeDb([row]);
		const fetchImpl = okFetch({ 'agapeverse.deep.nested_value': 'x' });
		const context: any = { user: { id: 'u1' } };
		await augmentContextWithIntegrationVariables({
			db,
			guildId: 'g1',
			userId: 'u1',
			text: '{agapeverse.deep.nested_value}',
			context,
			fetchImpl,
		});
		expect(context.agapeverse.deep.nested_value).toBe('x');
		expect(context.user.id).toBe('u1');
	});
});
