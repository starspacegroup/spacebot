import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import { GET as getStatus } from '../routes/api/status/+server.js';
import { POST as record } from '../routes/api/status/record/+server.js';
import { actions } from '../routes/admin/superadmin/status/+page.server.js';

const SCHEMA =
	readFileSync('migrations/0031_gateway_benchmarks.sql', 'utf8') +
	readFileSync('migrations/0100_status_page.sql', 'utf8');

let db: any;
const platform = () => ({ env: { DB: db, CRON_SECRET: 'cron-secret', ADMIN_USER_IDS: '42' } });

function post(body: unknown, auth?: string) {
	return record({
		request: new Request('https://spacebot.test/api/status/record', {
			method: 'POST',
			headers: auth ? { Authorization: auth, 'content-type': 'application/json' } : {},
			body: JSON.stringify(body),
		}),
		platform: platform(),
	} as any);
}

beforeEach(() => {
	db = createSqliteD1(SCHEMA);
});

describe('POST /api/status/record', () => {
	it('refuses a request without the cron secret', async () => {
		expect((await post({ website: { ok: true, ms: 10 } })).status).toBe(401);
		expect((await post({}, 'Bearer nope')).status).toBe(401);
		expect((await db.prepare('SELECT COUNT(*) n FROM status_components').first()).n).toBe(0);
	});

	it('records a round with the secret, and survives a missing or junk body', async () => {
		const ok = await post(
			{ website: { ok: true, ms: 120, httpStatus: 200 } },
			'Bearer cron-secret'
		);
		expect(ok.status).toBe(200);
		expect((await post(null, 'Bearer cron-secret')).status).toBe(200);
		expect(
			(await post({ website: { ok: 'yes', ms: 'slow' } }, 'Bearer cron-secret')).status
		).toBe(200);
		const rows = (await db.prepare('SELECT id FROM status_components').all()).results;
		expect(rows).toHaveLength(4);
	});
});

describe('GET /api/status', () => {
	it('is public, shareable, and leaves out internal latency', async () => {
		await post({ website: { ok: true, ms: 120 } }, 'Bearer cron-secret');
		const res = await getStatus({ platform: platform() } as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		expect(res.headers.get('cache-control')).toContain('max-age=30');
		const body: any = await res.json();
		expect(body.components.map((c: any) => c.id)).toEqual([
			'website',
			'database',
			'bot_host',
			'discord',
		]);
		for (const c of body.components) expect('latencyMs' in c).toBe(false);
		expect(JSON.stringify(body)).not.toMatch(/created_by|cron-secret/);
	});

	it('answers 503, never a green page, when there is no database', async () => {
		const res = await getStatus({ platform: { env: {} } } as any);
		expect(res.status).toBe(503);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});
});

function formEvent(fields: Record<string, string | string[]>, userId?: string) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) form.append(k, x);
	return {
		request: { formData: async () => form },
		cookies: { get: (n: string) => (n === 'discord_user_id' ? userId : undefined) },
		platform: platform(),
	} as any;
}

describe('superadmin incident actions', () => {
	it('refuse anyone who is not a superadmin, and write nothing', async () => {
		for (const who of [undefined, '7']) {
			const r: any = await actions.create(formEvent({ title: 'Hacked' }, who));
			expect(r.status).toBe(403);
			const u: any = await actions.update(
				formEvent({ incident_id: '1', message: 'x', status: 'resolved' }, who)
			);
			expect(u.status).toBe(403);
		}
		expect((await db.prepare('SELECT COUNT(*) n FROM status_incidents').first()).n).toBe(0);
	});

	it('let a superadmin post an incident and an update, and record who did', async () => {
		const made: any = await actions.create(
			formEvent(
				{
					title: 'Moving the bot',
					impact: 'maintenance',
					status: 'investigating',
					components: ['bot_host'],
					message: 'Short break.',
				},
				'42'
			)
		);
		expect(made).toEqual({ created: true });
		const row = await db.prepare('SELECT id, created_by FROM status_incidents').first();
		expect(row.created_by).toBe('42');
		const upd: any = await actions.update(
			formEvent({ incident_id: String(row.id), status: 'resolved', message: 'Done.' }, '42')
		);
		expect(upd).toEqual({ updated: row.id });
	});

	it('say what is wrong with a bad post', async () => {
		const r: any = await actions.create(formEvent({ title: '  ' }, '42'));
		expect(r.status).toBe(400);
		expect(r.data.error).toMatch(/title/i);
	});
});
