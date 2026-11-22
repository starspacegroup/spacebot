import { describe, expect, it } from 'vitest';
import { buildStatusEmbed } from '../lib/status/discord.js';
import { BUILT_IN_COMMAND_DEFAULTS, ALWAYS_ENABLED_BUILT_INS } from '../lib/db/commands.js';
import { commands } from '../lib/discord/commands.js';

const comp = (id: string, name: string, status: any, uptimePercent: number | null = 100) => ({
	id,
	name,
	description: '',
	status,
	since: null,
	detail: null,
	latencyMs: null,
	uptimePercent,
	days: [],
});
const snap = (over: any = {}) =>
	({
		generatedAt: '2026-11-17 12:00:00',
		overall: 'operational',
		headline: 'All systems operational',
		stale: false,
		lastChecked: '2026-11-17 11:58:00',
		components: [comp('website', 'Website and dashboard', 'operational', 99.98)],
		openIncidents: [],
		recentIncidents: [],
		...over,
	}) as any;
const now = new Date('2026-11-17T12:00:00Z');

describe('/status embed', () => {
	it('shows the headline, each component and how long ago it checked', () => {
		const e = buildStatusEmbed(snap(), now);
		expect(e.title).toBe('All systems operational');
		expect(e.color).toBe(0x57f287);
		expect(e.fields![0].name).toContain('Website and dashboard');
		expect(e.fields![0].value).toContain('99.98%');
		expect(e.footer!.text).toContain('Last checked 2 minutes ago');
		expect(e.url).toBe('https://spacebot.starspace.group/status');
	});

	it('is red when something is down and lists open incidents', () => {
		const e = buildStatusEmbed(
			snap({
				overall: 'down',
				headline: 'Some systems are down',
				components: [comp('bot_host', 'Bot host', 'down', null)],
				openIncidents: [{ title: 'Bot host is not reporting' }],
			}),
			now
		);
		expect(e.color).toBe(0xed4245);
		expect(e.fields![0].value).toBe('Down');
		expect(e.fields!.at(-1)!.value).toContain('Bot host is not reporting');
	});

	it('never claims all is well without a recent check or any data', () => {
		const stale = buildStatusEmbed(snap({ stale: true }), now);
		expect(stale.title).not.toMatch(/operational/i);
		expect(stale.color).toBe(0x95a5a6);
		const none = buildStatusEmbed(null, now);
		expect(none.description).toMatch(/could not be read/);
	});
});

describe('/status command', () => {
	it('is a built-in that works in DMs, and a server cannot turn it off', () => {
		const def = BUILT_IN_COMMAND_DEFAULTS.find((c) => c.name === 'status');
		expect(def?.dm_permission).toBe(true);
		expect(ALWAYS_ENABLED_BUILT_INS).toContain('status');
		expect(commands.some((c) => c.name === 'status')).toBe(true);
	});
});
