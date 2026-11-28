import { describe, expect, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const GUILD = '100000000000000001';
const OTHER = '200000000000000002';

// ---- in-memory stand-in for the inbound_webhooks table ----
type Row = Record<string, any>;
let rows: Row[] = [];
let plan: Row = { plan: 'free' };
const logEvent = vi.fn(async () => ({ success: true }));
const processAutomations = vi.fn(async () => ({ executed: 2, errors: 0 }));

vi.mock('../lib/db/logger.js', () => ({
	log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
	logEvent: (...a: any[]) => (logEvent as any)(...a),
}));
vi.mock('../lib/db/server-plans.js', async (orig) => ({
	...(await orig<any>()),
	getServerPlan: async () => plan,
}));
vi.mock('../lib/automation/engine.js', async (orig) => ({
	...(await orig<any>()),
	processAutomations: (...a: any[]) => (processAutomations as any)(...a),
}));
vi.mock('../lib/discord/rest-client.js', () => ({ createDiscordRestClient: () => ({}) }));
vi.mock('../lib/db/server-stats.js', () => ({ getLatestServerStats: async () => null }));
vi.mock('../lib/db/guild-metadata.js', () => ({
	getGuildMetadata: async () => ({ name: 'Test' }),
}));

let nextId = 1;
const db = {
	prepare(sql: string) {
		return {
			bind(...a: any[]) {
				const run = async () => {
					if (sql.startsWith('INSERT INTO inbound_webhooks')) {
						const [
							guild_id,
							public_id,
							name,
							description,
							secret_hash,
							secret_prefix,
							created_by,
						] = a;
						if (rows.some((r) => r.guild_id === guild_id && r.name === name)) {
							throw new Error('UNIQUE constraint failed');
						}
						rows.push({
							id: nextId++,
							guild_id,
							public_id,
							name,
							description,
							secret_hash,
							secret_prefix,
							created_by,
							enabled: 1,
							receive_count: 0,
							rate_window_start: 0,
							rate_window_count: 0,
							last_received_at: null,
							last_status: null,
							created_at: 'x',
							updated_at: 'x',
						});
					} else if (sql.includes('SET secret_hash')) {
						const r = rows.find((x) => x.id === a[2] && x.guild_id === a[3]);
						if (r) Object.assign(r, { secret_hash: a[0], secret_prefix: a[1] });
					} else if (sql.includes('SET enabled')) {
						const r = rows.find((x) => x.id === a[1] && x.guild_id === a[2]);
						if (r) r.enabled = a[0];
					} else if (sql.includes('SET last_received_at')) {
						const r = rows.find((x) => x.id === a[3]);
						if (r) {
							r.receive_count++;
							Object.assign(r, {
								last_status: a[0],
								rate_window_start: a[1],
								rate_window_count: a[2],
							});
						}
					} else if (sql.includes('SET last_status')) {
						const r = rows.find((x) => x.id === a[1]);
						if (r) r.last_status = a[0];
					} else if (sql.startsWith('DELETE')) {
						rows = rows.filter((x) => !(x.id === a[0] && x.guild_id === a[1]));
					}
					return {};
				};
				return {
					run,
					all: async () => ({ results: rows.filter((r) => r.guild_id === a[0]) }),
					first: async () => {
						if (sql.includes('FROM inbound_webhooks WHERE public_id')) {
							return rows.find((r) => r.public_id === a[0]) || null;
						}
						return (
							rows.find(
								(r) =>
									r.guild_id === a[0] && (r.public_id === a[1] || r.id === a[2])
							) || null
						);
					},
				};
			},
		};
	},
};
const platform = { env: { DB: db } };

import {
	createInboundWebhook,
	deleteInboundWebhook,
	listInboundWebhooks,
	rotateInboundWebhookSecret,
	setInboundWebhookEnabled,
} from '../lib/db/inbound-webhooks.js';
import {
	decideWebhook,
	nextWebhookWindow,
	RATE_PER_WINDOW,
	MAX_BODY_BYTES,
} from '../lib/server/webhook-gate.js';
import { buildWebhookVariables, defuseMentions, safeTree } from '../lib/server/webhook-payload.js';
import { processTemplate, buildContext } from '../lib/automation/engine.js';
import { POST as receive } from '../routes/api/hooks/[publicId]/+server.js';
import { GET as listV1, POST as createV1 } from '../routes/api/v1/webhooks/+server.js';
import { POST as mcp } from '../routes/api/v1/mcp/+server.js';

let scopes: string[] = [];
vi.mock('../lib/api-auth.js', () => ({
	authenticateApiKey: async () => ({ authenticated: true, guildId: GUILD, scopes, keyId: 7 }),
	hasScope: (auth: any, s: string) => auth.scopes.includes(s),
}));

beforeEach(() => {
	rows = [];
	nextId = 1;
	plan = { plan: 'free' };
	scopes = [];
	vi.clearAllMocks();
});

const post = (
	publicId: string,
	secret: string | null,
	body: string,
	extra: Record<string, string> = {}
) =>
	receive({
		request: new Request('http://x/api/hooks/' + publicId, {
			method: 'POST',
			body,
			headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...extra },
		}),
		params: { publicId },
		platform,
	} as any);

async function makeHook(name = 'deploys') {
	const r: any = await createInboundWebhook(db, GUILD, { name, created_by: 'u' });
	expect(r.ok).toBe(true);
	return {
		publicId: r.webhook.public_id as string,
		secret: r.secret as string,
		id: r.webhook.id as number,
	};
}

describe('the gate (proved core, via the wrapper)', () => {
	const ok = {
		found: true,
		enabled: true,
		secretMatches: true,
		bodyBytes: 10,
		windowStart: 0,
		windowCount: 0,
		nowSec: 1000,
	};

	it('accepts a good call and refuses each way', () => {
		expect(decideWebhook(ok)).toBe('accept');
		expect(decideWebhook({ ...ok, found: false })).toBe('unauthorized');
		expect(decideWebhook({ ...ok, enabled: false })).toBe('unauthorized');
		expect(decideWebhook({ ...ok, secretMatches: false })).toBe('unauthorized');
		expect(decideWebhook({ ...ok, bodyBytes: MAX_BODY_BYTES + 1 })).toBe('too_large');
		const start = nextWebhookWindow(0, 0, 1000).start;
		expect(decideWebhook({ ...ok, windowStart: start, windowCount: RATE_PER_WINDOW })).toBe(
			'rate_limited'
		);
		expect(
			decideWebhook({ ...ok, windowStart: start - 60, windowCount: RATE_PER_WINDOW })
		).toBe('accept');
	});

	it('property: accept implies every condition; refusal for a bad secret ignores size and count', () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.boolean(),
				fc.boolean(),
				fc.nat(200000),
				fc.nat(5000),
				fc.nat(200),
				fc.nat(10_000_000),
				(found, enabled, secretMatches, bodyBytes, windowStart, windowCount, nowSec) => {
					const v = decideWebhook({
						found,
						enabled,
						secretMatches,
						bodyBytes,
						windowStart,
						windowCount,
						nowSec,
					});
					if (v === 'accept') {
						expect(
							found && enabled && secretMatches && bodyBytes <= MAX_BODY_BYTES
						).toBe(true);
					}
					if (!(found && enabled && secretMatches)) expect(v).toBe('unauthorized');
				}
			)
		);
	});
});

describe('payload variables', () => {
	it('defuses every kind of ping', () => {
		for (const s of ['@everyone', '@here', '<@123>', '<@&456>', '<@!789>']) {
			const out = defuseMentions(`hi ${s}`);
			expect(out).not.toContain('@everyone');
			expect(out).not.toContain('@here');
			expect(out).not.toMatch(/<@[!&]?\d/);
		}
	});

	it('property: no output string can contain a live mention, and safeTree never throws', () => {
		fc.assert(
			fc.property(fc.jsonValue(), (v) => {
				const vars = buildWebhookVariables('n', JSON.stringify(v), v);
				const dump = JSON.stringify(vars);
				expect(dump).not.toMatch(/@everyone|@here/i);
				expect(dump).not.toMatch(/<@[!&]?\d/);
			})
		);
		expect(() =>
			safeTree(JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2}}'))
		).not.toThrow();
	});

	it('property: arbitrary strings keep no live mention', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const out = defuseMentions(s);
				expect(out).not.toMatch(/@everyone|@here/i);
				expect(out).not.toMatch(/<@/);
			})
		);
	});

	const render = (tpl: string, body: unknown, raw = JSON.stringify(body)) =>
		processTemplate(
			tpl,
			buildContext({
				event_type: 'WEBHOOK_RECEIVED',
				guild_id: GUILD,
				details: {},
				_webhook_vars: buildWebhookVariables('deploys', raw, body),
			})
		);

	it('reads nested paths, arrays, name and body', () => {
		const body = { data: { user: { name: 'ada' } }, items: [{ id: 5 }], ok: true };
		expect(render('{webhook.data.user.name}', body)).toBe('ada');
		expect(render('{webhook.items.0.id}', body)).toBe('5');
		expect(render('{webhook.ok}', body)).toBe('true');
		expect(render('{webhook.name}', body)).toBe('deploys');
		expect(render('{webhook.body}', body)).toContain('"ada"');
	});

	it('renders empty for missing paths, objects, and prototype names', () => {
		const body = { a: { b: 1 } };
		expect(render('[{webhook.nope.deeper}]', body)).toBe('[]');
		expect(render('[{webhook.a}]', body)).toBe('[]');
		expect(render('[{webhook.constructor}]', body)).toBe('[]');
		expect(render('[{webhook.__proto__}]', body)).toBe('[]');
		expect(render('[{webhook.name.constructor}]', body)).toBe('[]');
	});

	it('takes non-JSON text as the body and lets name and body win over JSON keys', () => {
		expect(render('{webhook.body}', undefined, 'plain text')).toBe('plain text');
		expect(render('{webhook.name}', { name: 'evil' })).toBe('deploys');
	});

	it('does not touch other events', () => {
		const ctx = buildContext({ event_type: 'MEMBER_JOIN', guild_id: GUILD });
		expect(processTemplate('{webhook.x}', ctx)).toBe('{webhook.x}');
	});
});

describe('hook management', () => {
	it('creates with a one-time secret stored only as a hash', async () => {
		const { secret, id } = await makeHook();
		expect(secret).toMatch(/^sbw_[0-9a-f]{64}$/);
		expect(JSON.stringify(rows)).not.toContain(secret);
		expect(rows[0].secret_hash).toMatch(/^[0-9a-f]{64}$/);
		const listed = await listInboundWebhooks(db, GUILD);
		expect(JSON.stringify(listed)).not.toContain('secret_hash');
		expect(id).toBe(1);
	});

	it('allows several, refuses a duplicate name, and enforces the plan limit', async () => {
		await makeHook('a');
		await makeHook('b');
		await makeHook('c');
		expect(
			((await createInboundWebhook(db, GUILD, { name: 'D', created_by: 'u' })) as any).status
		).toBe(403);
		plan = { plan: 'pro' };
		expect(
			((await createInboundWebhook(db, GUILD, { name: 'A', created_by: 'u' })) as any).status
		).toBe(409);
		expect((await createInboundWebhook(db, GUILD, { name: 'd', created_by: 'u' })).ok).toBe(
			true
		);
	});

	it('rotate replaces the secret; another guild cannot touch the hook', async () => {
		const { secret, publicId, id } = await makeHook();
		const r: any = await rotateInboundWebhookSecret(db, GUILD, id);
		expect(r.secret).not.toBe(secret);
		expect((await post(publicId, secret, '{}')).status).toBe(401);
		expect((await post(publicId, r.secret, '{}')).status).toBe(202);
		expect(((await rotateInboundWebhookSecret(db, OTHER, id)) as any).status).toBe(404);
		expect(((await setInboundWebhookEnabled(db, OTHER, id, false)) as any).status).toBe(404);
		expect(((await deleteInboundWebhook(db, OTHER, id)) as any).status).toBe(404);
		expect((await deleteInboundWebhook(db, GUILD, id)).ok).toBe(true);
	});
});

describe('POST /api/hooks/:publicId', () => {
	it('accepts a good call, fires automations for the hook’s own guild, and keeps the payload out of the log', async () => {
		const { publicId, secret } = await makeHook();
		const res = await post(publicId, secret, JSON.stringify({ msg: 'hi', token: 'topsecret' }));
		expect(res.status).toBe(202);
		expect((await res.json()).automations_triggered).toBe(2);
		const ev = (processAutomations.mock.calls[0] as any[])[0];
		expect(ev.event_type).toBe('WEBHOOK_RECEIVED');
		expect(ev.guild_id).toBe(GUILD);
		expect(ev._webhook_vars.msg).toBe('hi');
		expect(JSON.stringify((logEvent.mock.calls[0] as any[])[1].details)).not.toContain(
			'topsecret'
		);
		expect(rows[0].receive_count).toBe(1);
		expect(rows[0].last_status).toBe('accepted');
	});

	it('gives one answer for a wrong secret, no secret, a disabled hook and an unknown hook', async () => {
		const { publicId, secret, id } = await makeHook();
		const answers = [
			await post(publicId, 'sbw_wrong', '{}'),
			await post(publicId, null, '{}'),
			await post('0'.repeat(32), secret, '{}'),
			await post('not-a-hook', secret, '{}'),
		];
		await setInboundWebhookEnabled(db, GUILD, id, false);
		answers.push(await post(publicId, secret, '{}'));
		for (const a of answers) {
			expect(a.status).toBe(401);
			expect(await a.json()).toEqual({ error: 'Unauthorized' });
		}
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('refuses a big body without running anything', async () => {
		const { publicId, secret } = await makeHook();
		const res = await post(publicId, secret, 'x'.repeat(MAX_BODY_BYTES + 1));
		expect(res.status).toBe(413);
		expect(processAutomations).not.toHaveBeenCalled();
	});

	it('rate limits a hook at 60 a minute with Retry-After', async () => {
		const { publicId, secret } = await makeHook();
		for (let i = 0; i < RATE_PER_WINDOW; i++) {
			expect((await post(publicId, secret, '{}')).status).toBe(202);
		}
		const res = await post(publicId, secret, '{}');
		expect(res.status).toBe(429);
		expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(processAutomations).toHaveBeenCalledTimes(RATE_PER_WINDOW);
	});

	it('takes non-JSON text', async () => {
		const { publicId, secret } = await makeHook();
		expect((await post(publicId, secret, 'deploy finished')).status).toBe(202);
		expect((processAutomations.mock.calls[0] as any[])[0]._webhook_vars.body).toBe(
			'deploy finished'
		);
	});
});

describe('REST and MCP for owners', () => {
	const callMcp = async (name: string, args: any) =>
		(
			await (
				await mcp({
					request: new Request('http://x/api/v1/mcp', {
						method: 'POST',
						body: JSON.stringify({
							jsonrpc: '2.0',
							id: 1,
							method: 'tools/call',
							params: { name, arguments: args },
						}),
					}),
					platform,
				} as any)
			).json()
		).result;
	const listTools = async () =>
		(
			await (
				await mcp({
					request: new Request('http://x/api/v1/mcp', {
						method: 'POST',
						body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
					}),
					platform,
				} as any)
			).json()
		).result.tools.map((t: any) => t.name);
	const rest = (fn: any, body?: any) =>
		fn({
			request: new Request('http://x/api/v1/webhooks', {
				method: 'POST',
				body: body && JSON.stringify(body),
			}),
			platform,
			url: new URL('http://x/api/v1/webhooks'),
		} as any);

	it('REST: scope gates, create returns the secret once, list never does', async () => {
		scopes = ['webhooks:read'];
		expect((await rest(createV1, { name: 'x' })).status).toBe(403);
		scopes = ['webhooks:write'];
		expect((await rest(listV1)).status).toBe(403);
		const created = await rest(createV1, { name: 'x' });
		expect(created.status).toBe(201);
		const body = await created.json();
		expect(body.secret).toMatch(/^sbw_/);
		expect(body.webhook.url).toMatch(/^http:\/\/x\/api\/hooks\/[0-9a-f]{32}$/);
		scopes = ['webhooks:read'];
		const list = await (await rest(listV1)).json();
		expect(list.webhooks).toHaveLength(1);
		expect(JSON.stringify(list)).not.toContain(body.secret);
		expect(JSON.stringify(list)).not.toContain('secret_hash');
	});

	it('MCP: tools are listed by scope, and writes are logged under the key', async () => {
		scopes = ['webhooks:read'];
		expect(await listTools()).toEqual(['list_inbound_webhooks', 'get_inbound_webhook']);
		scopes = ['webhooks:write'];
		expect(await listTools()).toEqual([
			'create_inbound_webhook',
			'rotate_inbound_webhook_secret',
			'set_inbound_webhook_enabled',
		]);
		const r = await callMcp('create_inbound_webhook', { name: 'm' });
		expect(r.isError).toBeUndefined();
		expect(JSON.parse(r.content[0].text).secret).toMatch(/^sbw_/);
		expect(logEvent).toHaveBeenCalledWith(
			db,
			expect.objectContaining({ event_type: 'API_WEBHOOK_CREATED', actor_id: 'api_key:7' })
		);
	});

	it('MCP: no delete tool, a read-only key cannot write', async () => {
		scopes = ['webhooks:read'];
		const r = await callMcp('create_inbound_webhook', { name: 'm' });
		expect(r.isError).toBe(true);
		expect((await callMcp('delete_inbound_webhook', { id: '1' })).isError).toBe(true);
	});
});
