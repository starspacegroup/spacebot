import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqlite-d1.js';
import {
	addIncidentUpdate,
	createIncident,
	getStatusSnapshot,
	recordStatus,
} from '../lib/db/status.js';

const SCHEMA =
	readFileSync('migrations/0031_gateway_benchmarks.sql', 'utf8') +
	readFileSync('migrations/0100_status_page.sql', 'utf8');

const T0 = new Date('2026-11-17T12:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const sql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

let db: any;
const heartbeat = (when: Date, status = 'connected', ms: number | null = 40) =>
	db.exec(
		`INSERT INTO gateway_benchmarks (heartbeat_latency_ms, status, recorded_at) VALUES (${ms ?? 'NULL'}, '${status}', '${sql(when)}')`
	);

/** A minute of checks: the bot reports in, the website is fine. */
async function minute(min: number, opts: { bot?: boolean; status?: string; website?: any } = {}) {
	if (opts.bot !== false) heartbeat(at(min), opts.status ?? 'connected');
	return recordStatus(db, { website: opts.website ?? { ok: true, ms: 120 } }, at(min));
}

beforeEach(() => {
	db = createSqliteD1(SCHEMA);
});

describe('recording checks', () => {
	it('starts everything operational and counts the day', async () => {
		await minute(0);
		const snap = await getStatusSnapshot(db, at(0));
		expect(snap.overall).toBe('operational');
		expect(snap.components.map((c) => c.status)).toEqual([
			'operational',
			'operational',
			'operational',
			'operational',
		]);
		expect(snap.headline).toBe('All systems operational');
		expect(snap.stale).toBe(false);
		const today = snap.components[0].days.at(-1)!;
		expect(today.level).toBe('operational');
		expect(snap.components[0].days).toHaveLength(90);
	});

	it('does not show a one-minute blip', async () => {
		await minute(0);
		await minute(1, { bot: false }); // no heartbeat this minute (and an old one would still be fresh)
		heartbeat(at(2));
		await minute(2);
		const snap = await getStatusSnapshot(db, at(2));
		expect(snap.overall).toBe('operational');
		expect(snap.openIncidents).toHaveLength(0);
	});

	it('opens an incident when the bot stops reporting, and closes it when it is back', async () => {
		for (let m = 0; m < 3; m++) await minute(m);
		// the host dies: no more heartbeats; by minute 6 the last one (minute 2) is stale (> 150 s)
		for (let m = 3; m <= 8; m++) await minute(m, { bot: false });
		let snap = await getStatusSnapshot(db, at(8));
		const host = snap.components.find((c) => c.id === 'bot_host')!;
		expect(host.status).toBe('down');
		expect(snap.overall).toBe('down');
		expect(snap.openIncidents).toHaveLength(2); // host and Discord connection
		const inc = snap.openIncidents.find((i) => i.components.includes('bot_host'))!;
		expect(inc.auto).toBe(true);
		expect(inc.impact).toBe('major');
		expect(inc.title).toMatch(/bot is offline/);
		expect(inc.updates).toHaveLength(1);
		expect(inc.updates[0].byPerson).toBe(false);
		// one incident per component, not one per bad minute
		await minute(9, { bot: false });
		expect((await getStatusSnapshot(db, at(9))).openIncidents).toHaveLength(2);

		// back
		await minute(10);
		await minute(11);
		snap = await getStatusSnapshot(db, at(11));
		expect(snap.overall).toBe('operational');
		expect(snap.openIncidents).toHaveLength(0);
		const done = snap.recentIncidents.find((i) => i.id === inc.id)!;
		expect(done.status).toBe('resolved');
		expect(done.resolvedAt).not.toBeNull();
		expect(done.updates[0].status).toBe('resolved'); // newest first
		expect(done.updates).toHaveLength(2);
	});

	it('dates an incident to the first bad check, not the confirmation', async () => {
		await minute(0);
		await minute(1, { bot: false });
		for (let m = 2; m <= 8; m++) await minute(m, { bot: false });
		const snap = await getStatusSnapshot(db, at(8));
		const inc = snap.openIncidents.find((i) => i.components.includes('bot_host'))!;
		// the heartbeat from minute 0 goes stale (> 150 s) at minute 3, so the first bad check is minute 3
		expect(inc.startedAt).toBe(sql(at(3)));
	});

	it('says the host is fine when it reports but is not connected to Discord', async () => {
		await minute(0);
		await minute(1, { status: 'reconnecting' });
		await minute(2, { status: 'reconnecting' });
		const snap = await getStatusSnapshot(db, at(2));
		const by = Object.fromEntries(snap.components.map((c) => [c.id, c.status]));
		expect(by.bot_host).toBe('operational');
		expect(by.discord).toBe('down');
		expect(snap.openIncidents).toHaveLength(1);
		expect(snap.openIncidents[0].components).toEqual(['discord']);
	});

	it('an outside probe that fails marks the website down after two checks', async () => {
		await minute(0);
		await minute(1, { website: { ok: false, ms: null } });
		await minute(2, { website: { ok: false, ms: null } });
		const snap = await getStatusSnapshot(db, at(2));
		expect(snap.components.find((c) => c.id === 'website')!.status).toBe('down');
		expect(snap.openIncidents[0].title).toBe('Website and dashboard is unavailable');
	});

	it('escalates one incident from slow to down rather than opening a second', async () => {
		await minute(0);
		const slow = { ok: true, ms: 5000 };
		await minute(1, { website: slow });
		await minute(2, { website: slow });
		let snap = await getStatusSnapshot(db, at(2));
		expect(snap.openIncidents).toHaveLength(1);
		expect(snap.openIncidents[0].impact).toBe('minor');
		const bad = { ok: false, ms: null };
		await minute(3, { website: bad });
		await minute(4, { website: bad });
		snap = await getStatusSnapshot(db, at(4));
		expect(snap.openIncidents).toHaveLength(1);
		expect(snap.openIncidents[0].impact).toBe('major');
		expect(snap.openIncidents[0].updates.length).toBe(2);
	});

	it('counts down minutes into the day and cuts the uptime', async () => {
		await minute(0);
		for (let m = 1; m <= 8; m++) await minute(m, { website: { ok: false, ms: null } });
		const snap = await getStatusSnapshot(db, at(8));
		const web = snap.components.find((c) => c.id === 'website')!;
		expect(web.uptimePercent).toBeLessThan(100);
		expect(web.days.at(-1)!.level).toBe('down'); // 7 confirmed-down checks is at least 5
	});
});

describe('staleness', () => {
	it('says checks are delayed instead of claiming all is well', async () => {
		await minute(0);
		const later = await getStatusSnapshot(db, at(30));
		expect(later.stale).toBe(true);
		expect(later.headline).toBe('Status checks are delayed');
	});

	it('is stale before any check has ever run', async () => {
		const snap = await getStatusSnapshot(db, at(0));
		expect(snap.stale).toBe(true);
	});
});

describe('incidents from a person', () => {
	it('creates, updates and resolves one', async () => {
		await minute(0);
		const made = await createIncident(
			db,
			{
				title: '  Planned move of the bot host  ',
				impact: 'maintenance',
				components: ['bot_host', 'nope'],
				message: 'Moving to a new server.',
				by: '1',
			},
			at(1)
		);
		expect(made.ok).toBe(true);
		let snap = await getStatusSnapshot(db, at(1));
		expect(snap.openIncidents[0]).toMatchObject({
			title: 'Planned move of the bot host',
			impact: 'maintenance',
			status: 'investigating',
			components: ['bot_host'],
			auto: false,
		});
		expect(snap.openIncidents[0].updates[0]).toMatchObject({
			body: 'Moving to a new server.',
			byPerson: true,
		});

		await addIncidentUpdate(
			db,
			{
				incidentId: (made as any).id,
				status: 'monitoring',
				message: 'Done, watching.',
				by: '1',
			},
			at(5)
		);
		snap = await getStatusSnapshot(db, at(5));
		expect(snap.openIncidents[0].status).toBe('monitoring');
		expect(snap.openIncidents[0].updates).toHaveLength(2);

		await addIncidentUpdate(
			db,
			{ incidentId: (made as any).id, status: 'resolved', message: 'All good.', by: '1' },
			at(9)
		);
		snap = await getStatusSnapshot(db, at(9));
		expect(snap.openIncidents).toHaveLength(0);
		expect(snap.recentIncidents[0].resolvedAt).toBe(sql(at(9)));
	});

	it('rejects an empty title or update, and an unknown incident', async () => {
		expect((await createIncident(db, { title: '   ' })).ok).toBe(false);
		expect(
			(await addIncidentUpdate(db, { incidentId: 99, status: 'resolved', message: 'x' })).ok
		).toBe(false);
		const made: any = await createIncident(db, { title: 'x' });
		expect(
			(
				await addIncidentUpdate(db, {
					incidentId: made.id,
					status: 'resolved',
					message: '  ',
				})
			).ok
		).toBe(false);
	});

	it('falls back to safe values for junk input and caps the length', async () => {
		const made: any = await createIncident(db, {
			title: 'T'.repeat(500),
			impact: 'apocalypse',
			status: 'whatever',
			message: 'M\u0000'.repeat(3000),
		});
		const snap = await getStatusSnapshot(db);
		const inc = snap.openIncidents.find((i) => i.id === made.id)!;
		expect(inc.title.length).toBe(120);
		expect(inc.impact).toBe('minor');
		expect(inc.status).toBe('investigating');
		expect(inc.updates[0].body.length).toBeLessThanOrEqual(2000);
		expect(inc.updates[0].body).not.toContain('\u0000');
	});

	it('a human incident does not stop the checks from opening their own', async () => {
		await createIncident(db, { title: 'Manual', components: ['website'] });
		await minute(0);
		const bad = { ok: false, ms: null };
		await minute(1, { website: bad });
		await minute(2, { website: bad });
		const snap = await getStatusSnapshot(db, at(2));
		expect(snap.openIncidents).toHaveLength(2);
	});

	it('does not close a person’s incident when the checks recover', async () => {
		const made: any = await createIncident(
			db,
			{ title: 'Manual', components: ['website'] },
			at(0)
		);
		await minute(0);
		const bad = { ok: false, ms: null };
		await minute(1, { website: bad });
		await minute(2, { website: bad });
		await minute(3);
		await minute(4);
		const snap = await getStatusSnapshot(db, at(4));
		expect(snap.openIncidents.map((i) => i.id)).toEqual([made.id]);
	});
});

describe('a bot that reports every 30 minutes', () => {
	// Production sets benchmark_interval_seconds to 1800, so a quiet 20 minutes is normal.
	beforeEach(() => {
		db.exec(`CREATE TABLE IF NOT EXISTS global_settings (key TEXT PRIMARY KEY, value TEXT)`);
		db.exec(
			`INSERT INTO global_settings (key, value) VALUES ('benchmark_interval_seconds', '1800')`
		);
	});

	it('is not called down between reports', async () => {
		heartbeat(at(0));
		for (let m = 0; m <= 25; m++)
			await recordStatus(db, { website: { ok: true, ms: 120 } }, at(m));
		const snap = await getStatusSnapshot(db, at(25));
		expect(snap.components.find((c) => c.id === 'bot_host')!.status).toBe('operational');
		expect(snap.components.find((c) => c.id === 'discord')!.status).toBe('operational');
		expect(snap.openIncidents).toHaveLength(0);
	});

	it('is called down once two reports have been missed', async () => {
		heartbeat(at(0));
		for (let m = 0; m <= 75; m++)
			await recordStatus(db, { website: { ok: true, ms: 120 } }, at(m));
		const snap = await getStatusSnapshot(db, at(75));
		expect(snap.components.find((c) => c.id === 'bot_host')!.status).toBe('down');
		expect(snap.openIncidents.length).toBeGreaterThan(0);
	});
});
