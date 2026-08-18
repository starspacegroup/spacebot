/**
 * The bot used to have no idea what "now" was.
 *
 * Asked in a DM to "create an event called Ammoura.me Launch/Listening Party on
 * September 11th at 9:11PM", the model had to invent the year (nothing in the
 * prompt said what today was) and had to invent the zone (so it wrote the local
 * wall clock into an ISO string ending in `Z`, putting a 9:11 PM event at
 * 2:11 PM for a user in Arizona). These tests pin both halves of the fix.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
	buildTimeContext,
	discordTimestamp,
	discordTimestampWithRelative,
	formatInTimeZone,
	formatOffsetLabel,
	formatTimeContextForPrompt,
	localWallClockToUTC,
	offsetMinutesAt,
	resolveTimeZone,
} from '../lib/ai/time-context.js';
import { buildSystemPrompt } from '../lib/ai/chat.js';
import { EVENT_TIME_TOOLS, MCPClient } from '../lib/ai/mcp-client.js';

// A fixed instant: 2026-08-14T13:33:00Z is 6:33 AM in Phoenix, 9:33 AM in New York.
const NOW = new Date('2026-08-14T13:33:00.000Z');
const realFetch = globalThis.fetch;

describe('resolveTimeZone', () => {
	it('keeps a configured IANA zone', () => {
		expect(resolveTimeZone('America/Phoenix')).toBe('America/Phoenix');
	});

	it('falls back to UTC when unset or nonsense, rather than throwing mid-chat', () => {
		expect(resolveTimeZone(null)).toBe('UTC');
		expect(resolveTimeZone('')).toBe('UTC');
		expect(resolveTimeZone('Mars/Olympus_Mons')).toBe('UTC');
	});
});

describe('offsetMinutesAt', () => {
	it('reads a fixed-offset zone', () => {
		// Arizona does not observe DST.
		expect(offsetMinutesAt(NOW, 'America/Phoenix')).toBe(-420);
		expect(offsetMinutesAt(new Date('2026-01-14T13:33:00.000Z'), 'America/Phoenix')).toBe(-420);
	});

	it('follows DST', () => {
		expect(offsetMinutesAt(new Date('2026-08-14T13:33:00.000Z'), 'America/New_York')).toBe(
			-240
		);
		expect(offsetMinutesAt(new Date('2026-01-14T13:33:00.000Z'), 'America/New_York')).toBe(
			-300
		);
	});

	it('handles zones east of UTC and half-hour offsets', () => {
		expect(offsetMinutesAt(NOW, 'Asia/Tokyo')).toBe(540);
		expect(offsetMinutesAt(NOW, 'Asia/Kolkata')).toBe(330);
	});
});

describe('formatOffsetLabel', () => {
	it('writes the offset the way a human reads it', () => {
		expect(formatOffsetLabel(-420)).toBe('UTC-07:00');
		expect(formatOffsetLabel(540)).toBe('UTC+09:00');
		expect(formatOffsetLabel(330)).toBe('UTC+05:30');
		expect(formatOffsetLabel(0)).toBe('UTC+00:00');
	});
});

describe('localWallClockToUTC', () => {
	it('converts the screenshot case: 9:11 PM on Sep 11 in Phoenix', () => {
		const utc = localWallClockToUTC(
			{ year: 2026, month: 9, day: 11, hour: 21, minute: 11, second: 0 },
			'America/Phoenix'
		);
		// NOT 2026-09-11T21:11:00Z — that is the bug this replaces.
		expect(utc.toISOString()).toBe('2026-09-12T04:11:00.000Z');
	});

	it('is a no-op for UTC itself', () => {
		const utc = localWallClockToUTC(
			{ year: 2026, month: 9, day: 11, hour: 21, minute: 11, second: 0 },
			'UTC'
		);
		expect(utc.toISOString()).toBe('2026-09-11T21:11:00.000Z');
	});

	it('uses the offset in force on the day, not today', () => {
		// Same wall clock, opposite sides of a DST boundary in New York.
		const summer = localWallClockToUTC(
			{ year: 2026, month: 7, day: 1, hour: 19, minute: 0, second: 0 },
			'America/New_York'
		);
		const winter = localWallClockToUTC(
			{ year: 2026, month: 1, day: 1, hour: 19, minute: 0, second: 0 },
			'America/New_York'
		);
		expect(summer.toISOString()).toBe('2026-07-01T23:00:00.000Z');
		expect(winter.toISOString()).toBe('2026-01-02T00:00:00.000Z');
	});

	it('normalises a day that overflows its month', () => {
		// The "ends after midnight" path adds 1 to the day without clamping.
		const utc = localWallClockToUTC(
			{ year: 2026, month: 8, day: 32, hour: 1, minute: 0, second: 0 },
			'UTC'
		);
		expect(utc.toISOString()).toBe('2026-09-01T01:00:00.000Z');
	});
});

describe('buildTimeContext', () => {
	it("assumes the server's zone when it has one, even if the user's differs", () => {
		const context = buildTimeContext(
			{ userTimezone: 'America/Phoenix', guildTimezone: 'America/New_York' },
			NOW
		);
		expect(context.timeZone).toBe('America/New_York');
		expect(context.source).toBe('guild');
		expect(context.zonesDiffer).toBe(true);
		// Both are still described, even though only one is used.
		expect(context.user?.abbreviation).toBe('MST');
		expect(context.guild?.abbreviation).toBe('EDT');
	});

	it("falls back to the user's own zone when the server has none", () => {
		const context = buildTimeContext({ userTimezone: 'America/Phoenix' }, NOW);
		expect(context.timeZone).toBe('America/Phoenix');
		expect(context.source).toBe('user');
		expect(context.guild).toBeNull();
		expect(context.zonesDiffer).toBe(false);
	});

	it('falls back to UTC when neither is set, and says which it used', () => {
		const context = buildTimeContext({}, NOW);
		expect(context.timeZone).toBe('UTC');
		expect(context.source).toBe('fallback');
		expect(context.user).toBeNull();
		expect(context.guild).toBeNull();
	});

	it('ignores a stored zone the runtime does not recognise', () => {
		const context = buildTimeContext(
			{ userTimezone: 'America/Phoenix', guildTimezone: 'Mars/Olympus_Mons' },
			NOW
		);
		expect(context.timeZone).toBe('America/Phoenix');
		expect(context.source).toBe('user');
	});

	it('does not flag zones as differing when they are the same clock', () => {
		const context = buildTimeContext(
			{ userTimezone: 'America/Phoenix', guildTimezone: 'America/Phoenix' },
			NOW
		);
		expect(context.zonesDiffer).toBe(false);
	});

	it('describes now on the effective clock', () => {
		const context = buildTimeContext({ userTimezone: 'America/Phoenix' }, NOW);
		expect(context.offsetLabel).toBe('UTC-07:00');
		expect(context.todayLocal).toBe('2026-08-14');
		expect(context.nowUTC).toBe('2026-08-14T13:33:00.000Z');
		expect(context.nowLocal).toContain('August 14, 2026');
		expect(context.nowLocal).toContain('6:33 AM');
	});

	it('works out the local date across the date line', () => {
		// 16:00Z is already the 15th in Tokyo — the "today" the model is told
		// must be the user's local one, not UTC's.
		const context = buildTimeContext(
			{ userTimezone: 'Asia/Tokyo' },
			new Date('2026-08-14T16:00:00.000Z')
		);
		expect(context.todayLocal).toBe('2026-08-15');
	});

	it('shows a worked local→UTC conversion the model can copy the shape of', () => {
		const context = buildTimeContext({ userTimezone: 'America/Phoenix' }, NOW);
		expect(context.exampleLocal).toBe('2026-08-14 8:00 PM');
		expect(context.exampleUTC).toBe('2026-08-15T03:00:00.000Z');
	});
});

describe('formatTimeContextForPrompt', () => {
	it('tells the model today, the zone, and how to resolve a bare date', () => {
		const prompt = formatTimeContextForPrompt(
			buildTimeContext({ userTimezone: 'America/Phoenix' }, NOW)
		);
		expect(prompt).toContain('CURRENT DATE AND TIME');
		expect(prompt).toContain('2026-08-14');
		expect(prompt).toContain('America/Phoenix');
		expect(prompt).toContain('UTC-07:00');
		// The two rules that were missing entirely.
		expect(prompt).toMatch(/next.*occurrence on or after 2026-08-14/i);
		expect(prompt).toContain('2026-08-15T03:00:00.000Z');
	});

	it("names both zones but points at the server's when they disagree", () => {
		const prompt = formatTimeContextForPrompt(
			buildTimeContext(
				{ userTimezone: 'America/Phoenix', guildTimezone: 'America/New_York' },
				NOW
			)
		);
		expect(prompt).toContain("This server's timezone:** America/New_York");
		expect(prompt).toContain("The user's own timezone:** America/Phoenix");
		expect(prompt).toContain("Use the server's");
		// No hand-wringing about the difference — the markup localises it anyway.
		expect(prompt).toContain('render on their clock');
	});

	it("says it is falling back to the user's zone when the server has none", () => {
		const prompt = formatTimeContextForPrompt(
			buildTimeContext({ userTimezone: 'America/Phoenix' }, NOW)
		);
		expect(prompt).toContain('the server has not set one');
	});

	it('always demands Discord timestamp markup rather than a formatted date', () => {
		const prompt = formatTimeContextForPrompt(
			buildTimeContext({ guildTimezone: 'America/New_York' }, NOW)
		);
		expect(prompt).toContain('Writing a time back to the user');
		expect(prompt).toContain('<t:1757646660:F>');
		expect(prompt).toContain('startTimeDiscord');
		expect(prompt).toMatch(/Never write a date or time as plain text/);
	});

	it('tells the bot to offer changes, including after creation', () => {
		const prompt = formatTimeContextForPrompt(
			buildTimeContext({ guildTimezone: 'America/New_York' }, NOW)
		);
		expect(prompt).toContain('Always offer to change it');
		expect(prompt).toMatch(/after\*\* it has been created/);
		expect(prompt).toContain('update_scheduled_event');
	});

	it('flags a total absence of zones rather than implying UTC was chosen', () => {
		const prompt = formatTimeContextForPrompt(buildTimeContext({}, NOW));
		expect(prompt).toContain('Timezone: UNKNOWN');
		expect(prompt).toContain('update_user_timezone');
		// The prompt must promise what the tool gate actually enforces.
		expect(prompt).toMatch(/will REFUSE to run/);
		expect(prompt).toMatch(/never ask a second time/i);
	});

	it('only chases a timezone when there is genuinely none', () => {
		for (const known of [{ guildTimezone: 'America/New_York' }, { userTimezone: 'UTC' }]) {
			const prompt = formatTimeContextForPrompt(buildTimeContext(known, NOW));
			expect(prompt).not.toContain('update_user_timezone');
			expect(prompt).not.toContain('REFUSE to run');
		}
	});
});

describe('buildSystemPrompt', () => {
	it('carries the time block, so the model never has to guess the year', () => {
		const prompt = buildSystemPrompt({ userTimezone: 'America/Phoenix', now: NOW });
		expect(prompt).toContain('CURRENT DATE AND TIME');
		expect(prompt).toContain("Today's local date:** 2026-08-14");
	});

	it("uses the guild's zone even when the user has one of their own", () => {
		const prompt = buildSystemPrompt({
			guildTimezone: 'Asia/Tokyo',
			userTimezone: 'America/Phoenix',
			now: NOW,
		});
		expect(prompt).toContain('Interpret dates and times the user gives you as **Asia/Tokyo**');
	});

	it('still builds with no timezone context at all', () => {
		expect(buildSystemPrompt()).toContain('CURRENT DATE AND TIME');
	});

	it('tells the model not to tidy a name it was given', () => {
		const prompt = buildSystemPrompt({ userTimezone: 'UTC', now: NOW });
		expect(prompt).toContain('Ammoura.me Launch/Listening Party');
	});
});

describe('previewScheduledEvent', () => {
	const client = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });

	it('shows the start time in the server zone, not the runtime zone', () => {
		const preview: any = client.previewScheduledEvent(
			'123',
			{
				name: 'Ammoura.me Launch/Listening Party',
				scheduledStartTime: '2026-09-12T04:11:00.000Z',
				entityType: 3,
				location: 'Discord',
			},
			'America/Phoenix'
		);
		expect(preview.valid).toBe(true);
		// The user reads this line to check the bot understood "9:11PM".
		expect(preview.preview.startTime).toContain('September 11, 2026');
		expect(preview.preview.startTime).toContain('9:11 PM');
		expect(preview.preview.startTime).toContain('MST');
		// And the name comes back untouched.
		expect(preview.preview.name).toBe('Ammoura.me Launch/Listening Party');
	});

	it('falls back to UTC and labels it when the server has no zone', () => {
		const preview: any = client.previewScheduledEvent('123', {
			name: 'Game Night',
			scheduledStartTime: '2026-09-12T04:11:00.000Z',
			entityType: 3,
			location: 'Discord',
		});
		expect(preview.preview.startTime).toContain('UTC');
		expect(preview.preview.startTime).toContain('September 12, 2026');
	});

	it('still reports validation errors', () => {
		const preview: any = client.previewScheduledEvent(
			'123',
			{ name: 'No location', scheduledStartTime: '2026-09-12T04:11:00.000Z', entityType: 3 },
			'America/Phoenix'
		);
		expect(preview.valid).toBe(false);
		expect(preview.errors).toContain('Location is required for External Events');
	});
});

describe('parseEventFromText', () => {
	const client = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });

	it('reads the listed times as server-local, not as UTC', () => {
		const event: any = client.parseEventFromText(
			'Ammoura.me Launch/Listening Party\nSep 11, 2026 · 9:11–11:30 PM',
			'America/Phoenix'
		);
		expect(event.name).toBe('Ammoura.me Launch/Listening Party');
		expect(event.scheduledStartTime).toBe('2026-09-12T04:11:00.000Z');
		expect(event.scheduledEndTime).toBe('2026-09-12T06:30:00.000Z');
	});

	it('rolls the local date when the end time crosses midnight', () => {
		const event: any = client.parseEventFromText(
			'Late Show\nSep 11, 2026 · 11:00 PM – 1:00 AM',
			'America/Phoenix'
		);
		expect(event.scheduledStartTime).toBe('2026-09-12T06:00:00.000Z');
		expect(event.scheduledEndTime).toBe('2026-09-12T08:00:00.000Z');
	});

	it('treats times as UTC when no zone is configured', () => {
		const event: any = client.parseEventFromText('Game Night\nSep 11, 2026 · 9:11 PM');
		expect(event.scheduledStartTime).toBe('2026-09-11T21:11:00.000Z');
	});
});

describe('formatInTimeZone', () => {
	it('always attaches the zone, whichever style is asked for', () => {
		expect(formatInTimeZone(NOW, 'America/Phoenix', 'long')).toContain('MST');
		expect(formatInTimeZone(NOW, 'America/Phoenix', 'short')).toContain('MST');
		expect(formatInTimeZone(NOW, 'America/Phoenix', 'time')).toBe('6:33 AM MST');
	});
});

describe('user timezone persistence', () => {
	function clientWithD1(rows: any[]) {
		const client: any = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });
		const queries: Array<{ sql: string; params: any[] }> = [];
		client.executeD1Query = async (sql: string, params: any[] = []) => {
			queries.push({ sql, params });
			return { results: rows, success: true };
		};
		return { client, queries };
	}

	it('reads the zone out of the account preferences blob', async () => {
		const { client } = clientWithD1([
			{ preferences_json: JSON.stringify({ timezone: 'America/Phoenix' }) },
		]);
		expect(await client.getUserTimezone('user-1')).toBe('America/Phoenix');
	});

	it('returns null when the user has never set one', async () => {
		const { client } = clientWithD1([{ preferences_json: JSON.stringify({ runnerUi: {} }) }]);
		expect(await client.getUserTimezone('user-1')).toBeNull();

		const { client: empty } = clientWithD1([]);
		expect(await empty.getUserTimezone('user-1')).toBeNull();
		expect(await empty.getUserTimezone(null)).toBeNull();
	});

	it('survives a lookup failure rather than killing the chat turn', async () => {
		const client: any = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });
		client.executeD1Query = async () => {
			throw new Error('D1 unavailable');
		};
		await expect(client.getUserTimezone('user-1')).resolves.toBeNull();
		await expect(client.getGuildTimezone('guild-1')).resolves.toBeNull();
	});

	it('merges the zone in rather than clobbering other preferences', async () => {
		const { client, queries } = clientWithD1([
			{ preferences_json: JSON.stringify({ runnerUi: { showRevoked: true } }) },
		]);

		const result: any = await client.setUserTimezone('user-1', 'America/Phoenix');
		expect(result.success).toBe(true);

		const write = queries.find((q) => q.sql.includes('INSERT INTO users'));
		expect(JSON.parse(write!.params[2])).toEqual({
			runnerUi: { showRevoked: true },
			timezone: 'America/Phoenix',
		});
	});

	it('rejects an abbreviation or a bare city, and writes nothing', async () => {
		const { client, queries } = clientWithD1([{ preferences_json: '{}' }]);

		// "EST" is a real IANA alias but is rejected on purpose: it does not
		// track DST, so it would be an hour wrong for half the year.
		for (const bad of ['EST', 'MST', 'EST5EDT', 'Arizona', '', 'Mars/Olympus_Mons']) {
			const result: any = await client.setUserTimezone('user-1', bad);
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		}
		expect(queries.filter((q) => q.sql.includes('INSERT INTO users'))).toHaveLength(0);
	});

	it('accepts a Region/City name and a plain UTC', async () => {
		const { client } = clientWithD1([{ preferences_json: '{}' }]);
		for (const good of ['America/Phoenix', 'Europe/London', 'Asia/Kolkata', 'UTC']) {
			const result: any = await client.setUserTimezone('user-1', good);
			expect(result).toMatchObject({ success: true, timezone: good });
		}
	});

	it('creates the account row when a DM-only user has none', async () => {
		// Only OAuth logins create `users` rows. Refusing here would mean the bot
		// asks a DM-only user for their timezone and then forgets it, forever.
		const { client, queries } = clientWithD1([]);
		const result: any = await client.setUserTimezone('user-1', 'America/Phoenix', 'David');
		expect(result).toMatchObject({ success: true, timezone: 'America/Phoenix' });

		const write = queries.find((q) => q.sql.includes('INSERT INTO users'));
		expect(write!.params[1]).toBe('David');
	});

	it('falls back to a placeholder username rather than refusing', async () => {
		const { client, queries } = clientWithD1([]);
		await client.setUserTimezone('user-1', 'America/Phoenix');
		const write = queries.find((q) => q.sql.includes('INSERT INTO users'));
		expect(write!.params[1]).toBe('Discord user');
	});

	it('exposes update_user_timezone as an action tool', async () => {
		const { MCP_TOOLS } = await import('../lib/ai/mcp-client.js');
		const { isActionTool } = await import('../lib/ai/tool-calling.js');

		const tool = MCP_TOOLS.find((t: any) => t.name === 'update_user_timezone');
		expect(tool).toBeTruthy();
		expect(Object.keys(tool!.parameters as any)).toEqual(['timezone']);
		// Must count as an action, or the "you only described it" guard fires
		// after the bot has genuinely saved the zone.
		expect(isActionTool('update_user_timezone')).toBe(true);
	});
});

describe('asking when the timezone is unknown', () => {
	function client(stored: string | null) {
		const c: any = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });
		const queries: Array<{ sql: string; params: any[] }> = [];
		c.executeD1Query = async (sql: string, params: any[] = []) => {
			queries.push({ sql, params });
			if (sql.includes('preferences_json FROM users')) {
				return {
					results: stored
						? [{ preferences_json: JSON.stringify({ timezone: stored }) }]
						: [],
				};
			}
			return { results: [], success: true };
		};
		return { c, queries };
	}

	const EVENT_ARGS = {
		guildId: '1',
		userId: 'u1',
		name: 'Ammoura.me Launch/Listening Party',
		scheduledStartTime: '2026-09-11T21:11:00.000Z',
		entityType: 3,
		location: 'Discord',
	};

	it('refuses to schedule when neither the user nor the server has a zone', async () => {
		const { c } = client(null);
		const result: any = await c.executeTool('preview_scheduled_event', EVENT_ARGS);

		expect(result.success).toBe(false);
		expect(result.needsTimezone).toBe(true);
		expect(result.error).toMatch(/ask the user which timezone/i);
		// Must not offer UTC as a way out — that is the bug being fixed.
		expect(result.error).toMatch(/do not guess a zone or use utc/i);
	});

	it('blocks every tool that turns a spoken time into a stored one', async () => {
		const { c } = client(null);
		for (const tool of EVENT_TIME_TOOLS) {
			const result: any = await c.executeTool(tool, { ...EVENT_ARGS, eventsText: 'x' });
			expect(result.needsTimezone, `${tool} should be gated`).toBe(true);
		}
	});

	it('still lets the user read events back without a zone', async () => {
		const { c } = client(null);
		c.getScheduledEvents = async () => [];
		const result: any = await c.executeTool('get_scheduled_events', { guildId: '1' });
		expect(result.success).toBe(true);
		expect(result.needsTimezone).toBeUndefined();
	});

	it("proceeds on the user's stored zone once they have answered", async () => {
		const { c } = client('America/Phoenix');
		const result: any = await c.executeTool('preview_scheduled_event', EVENT_ARGS);

		expect(result.success).toBe(true);
		expect(result.requiresConfirmation).toBe(true);
		expect(result.data.preview.startTime).toContain('MST');
	});

	it("falls back to the server's zone rather than asking needlessly", async () => {
		const { c } = client(null);
		const result: any = await c.executeTool('preview_scheduled_event', {
			...EVENT_ARGS,
			_guildTimezone: 'America/New_York',
		});

		expect(result.success).toBe(true);
		expect(result.data.preview.startTime).toContain('EDT');
	});

	it('counts a zone set earlier in the same turn, not the turn-start snapshot', async () => {
		// "I'm in Arizona, now make me an event" — the update lands mid-turn, so
		// the snapshot handed to the tools is still null. Re-reading is what stops
		// the bot asking for something the user just told it.
		const { c } = client('America/Phoenix');
		const result: any = await c.executeTool('preview_scheduled_event', {
			...EVENT_ARGS,
			_userTimezone: null,
		});

		expect(result.needsTimezone).toBeUndefined();
		expect(result.data.preview.startTime).toContain('MST');
	});

	it('remembers a DM-only user who has no dashboard account yet', async () => {
		const { c, queries } = client(null);
		const saved: any = await c.setUserTimezone('u1', 'America/Phoenix', 'David');

		expect(saved.success).toBe(true);
		// Asking and then failing to keep the answer would make it ask forever.
		const write = queries.find((q) => q.sql.includes('INSERT INTO users'));
		expect(write).toBeTruthy();
		expect(write!.params[1]).toBe('David');
		expect(JSON.parse(write!.params[2])).toEqual({ timezone: 'America/Phoenix' });
	});
});

describe('discordTimestamp', () => {
	it('renders the markup Discord localises for each reader', () => {
		expect(discordTimestamp(new Date('2026-09-12T04:11:00.000Z'), 'F')).toBe(
			'<t:1789186260:F>'
		);
		expect(discordTimestamp('2026-09-12T04:11:00.000Z', 'R')).toBe('<t:1789186260:R>');
		expect(discordTimestamp(1789186260000)).toBe('<t:1789186260:F>');
	});

	it('returns empty rather than <t:NaN:F> for a missing or bad date', () => {
		expect(discordTimestamp(null)).toBe('');
		expect(discordTimestamp(undefined)).toBe('');
		expect(discordTimestamp('')).toBe('');
		expect(discordTimestamp('not a date')).toBe('');
	});

	it('pairs the absolute and relative forms', () => {
		expect(discordTimestampWithRelative('2026-09-12T04:11:00.000Z')).toBe(
			'<t:1789186260:F> (<t:1789186260:R>)'
		);
		expect(discordTimestampWithRelative(null)).toBe('');
	});
});

describe('event payloads carry paste-ready timestamps', () => {
	const client: any = new MCPClient({ accountId: 'a', apiToken: 'b', databaseId: 'c' });

	it('puts the markup on a single-event preview', () => {
		const preview: any = client.previewScheduledEvent(
			'123',
			{
				name: 'Launch',
				scheduledStartTime: '2026-09-12T04:11:00.000Z',
				scheduledEndTime: '2026-09-12T06:11:00.000Z',
				entityType: 3,
				location: 'Discord',
			},
			'America/Phoenix'
		);
		expect(preview.preview.startTimeDiscord).toBe('<t:1789186260:F>');
		expect(preview.preview.startTimeRelative).toBe('<t:1789186260:R>');
		expect(preview.preview.endTimeDiscord).toBe('<t:1789193460:F>');
	});

	it('puts it on every row of a multi-event preview', () => {
		const preview: any = client.previewMultipleScheduledEvents(
			'123',
			'Launch\nSep 11, 2026 · 9:11 PM',
			'Discord',
			3,
			null,
			false,
			'America/Phoenix'
		);
		expect(preview.events[0].startTimeDiscord).toBe('<t:1789186260:F>');
		expect(preview.events[0].startTimeRelative).toBe('<t:1789186260:R>');
	});
});

describe('changing an event after it exists', () => {
	function client(existing: any[] = []) {
		const c: any = new MCPClient({
			accountId: 'a',
			apiToken: 'b',
			databaseId: 'c',
			discordBotToken: 'bot',
		});
		const calls: any[] = [];
		globalThis.fetch = (async (url: any, init: any) => {
			calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body });
			if ((init?.method || 'GET') === 'GET') {
				return { ok: true, status: 200, json: async () => existing };
			}
			const patch = JSON.parse(init.body);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					id: 'e1',
					name: patch.name ?? 'Launch',
					scheduled_start_time: patch.scheduled_start_time ?? '2026-09-12T04:11:00.000Z',
					scheduled_end_time: patch.scheduled_end_time ?? null,
					entity_type: 3,
					status: 1,
					entity_metadata: { location: patch.entity_metadata?.location ?? 'Discord' },
				}),
			};
		}) as any;
		return { c, calls };
	}

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('PATCHes only the fields that changed', async () => {
		const { c, calls } = client();
		const result: any = await c.updateScheduledEvent('123', 'e1', { name: 'New Name' });

		const patch = calls.find((call) => call.method === 'PATCH');
		expect(patch.url).toContain('/guilds/123/scheduled-events/e1');
		// A PATCH carrying every field would blank the ones we did not set.
		expect(JSON.parse(patch.body)).toEqual({ name: 'New Name' });
		expect(result.name).toBe('New Name');
	});

	it('carries the end time along when only the start moves', async () => {
		// Discord rejects a start past the end, and "move it an hour later" should
		// not silently shorten the event.
		const { c, calls } = client([
			{
				id: 'e1',
				name: 'Launch',
				scheduled_start_time: '2026-09-12T04:11:00.000Z',
				scheduled_end_time: '2026-09-12T06:11:00.000Z',
				entity_type: 3,
			},
		]);

		await c.updateScheduledEvent('123', 'e1', {
			scheduledStartTime: '2026-09-12T05:11:00.000Z',
		});

		const patch = JSON.parse(calls.find((call) => call.method === 'PATCH').body);
		expect(patch.scheduled_start_time).toBe('2026-09-12T05:11:00.000Z');
		expect(patch.scheduled_end_time).toBe('2026-09-12T07:11:00.000Z');
	});

	it('returns the new time as markup, so the reply can be verified at a glance', async () => {
		const { c } = client();
		const result: any = await c.updateScheduledEvent('123', 'e1', {
			scheduledStartTime: '2026-09-12T04:11:00.000Z',
		});
		expect(result.startTimeDiscord).toBe('<t:1789186260:F>');
		expect(result.startTimeRelative).toBe('<t:1789186260:R>');
		expect(result.eventLink).toBe('https://discord.com/events/123/e1');
	});

	it('refuses without an event id rather than creating a duplicate', async () => {
		const { c } = client();
		await expect(c.updateScheduledEvent('123', null, { name: 'x' })).rejects.toThrow(
			/get_scheduled_events/
		);
	});

	it('refuses an empty change', async () => {
		const { c } = client();
		await expect(c.updateScheduledEvent('123', 'e1', {})).rejects.toThrow(/Nothing to change/);
	});

	it('is registered as a gated action tool', async () => {
		const { MCP_TOOLS } = await import('../lib/ai/mcp-client.js');
		const { isActionTool } = await import('../lib/ai/tool-calling.js');

		expect(MCP_TOOLS.some((t: any) => t.name === 'update_scheduled_event')).toBe(true);
		expect(isActionTool('update_scheduled_event')).toBe(true);
		// It writes a spoken time, so it needs a known zone like the others.
		expect(EVENT_TIME_TOOLS.has('update_scheduled_event')).toBe(true);
	});
});
