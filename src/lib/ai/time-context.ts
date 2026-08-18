/**
 * What time it is, for the model.
 *
 * The DM assistant was told everything about a server except when "now" is.
 * Asked to "create an event called X on September 11th at 9:11PM" it therefore
 * had to invent two things it had no way to know: the year (it guessed one from
 * its training data) and the zone (it wrote the wall-clock time straight into an
 * ISO string ending in `Z`, so a 9:11 PM event landed at 2:11 PM local for a
 * user in Arizona).
 *
 * So the system prompt now carries the current instant, the server's configured
 * timezone, and a worked local→UTC conversion. Everything here is pure — it
 * takes `now` as an argument — so the prompt text can be asserted in tests.
 */

const FALLBACK_TIMEZONE = 'UTC';

/** Does this runtime know the zone? Workers ship full ICU, but be defensive. */
export function isUsableTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
		return true;
	} catch {
		return false;
	}
}

/**
 * Strict enough to *store*, as opposed to merely format.
 *
 * `isUsableTimeZone` accepts the IANA database's legacy fixed-offset aliases —
 * "EST", "MST", "EST5EDT" are all real zone names. They are a trap: someone in
 * New York who says "EST" in July means EDT, and storing the literal `EST` pins
 * them an hour off for half the year. So a stored zone must be a Region/City
 * identifier, which tracks its own DST, or the one sensible zoneless answer.
 */
export function isStorableTimeZone(timeZone: string): boolean {
	const tz = String(timeZone || '').trim();
	if (!tz) return false;
	if (tz.toUpperCase() === 'UTC') return true;
	if (!/^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
	return isUsableTimeZone(tz);
}

/** The guild's configured zone, or UTC when it is unset or unrecognised. */
export function resolveTimeZone(timezone?: string | null): string {
	const tz = String(timezone || '').trim();
	if (!tz || !isUsableTimeZone(tz)) return FALLBACK_TIMEZONE;
	return tz;
}

type WallClock = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

/** The wall-clock reading an observer in `timeZone` sees at instant `date`. */
function wallClockIn(date: Date, timeZone: string): WallClock {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(date);

	const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

	return {
		year: read('year'),
		month: read('month'),
		day: read('day'),
		// Some engines render midnight as hour 24 under hour12:false.
		hour: read('hour') % 24,
		minute: read('minute'),
		second: read('second'),
	};
}

/** Offset in minutes east of UTC for `timeZone` at instant `date` (MST → -420). */
export function offsetMinutesAt(date: Date, timeZone: string): number {
	const wall = wallClockIn(date, timeZone);
	const asIfUTC = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
		wall.second
	);
	// Millisecond remainder is dropped by the formatter; add it back before the
	// diff so a non-zero `date` doesn't round the offset off by a second.
	return Math.round((asIfUTC - (date.getTime() - date.getMilliseconds())) / 60000);
}

/** "UTC-07:00" — the label a human recognises next to a zone name. */
export function formatOffsetLabel(offsetMinutes: number): string {
	const sign = offsetMinutes < 0 ? '-' : '+';
	const abs = Math.abs(offsetMinutes);
	const hours = String(Math.floor(abs / 60)).padStart(2, '0');
	const minutes = String(abs % 60).padStart(2, '0');
	return `UTC${sign}${hours}:${minutes}`;
}

/**
 * Turn a local wall-clock reading into the UTC instant it names.
 *
 * Two passes: guess the offset from the naive instant, then re-read it at the
 * corrected instant. That second pass is what keeps a time near a DST boundary
 * from being an hour out.
 */
export function localWallClockToUTC(wall: WallClock, timeZone: string): Date {
	const naive = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
		wall.second
	);
	const firstGuess = naive - offsetMinutesAt(new Date(naive), timeZone) * 60000;
	return new Date(naive - offsetMinutesAt(new Date(firstGuess), timeZone) * 60000);
}

/** Short zone name as the locale writes it ("MST", "GMT+9", "UTC"). */
export function timeZoneAbbreviation(date: Date, timeZone: string): string {
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone,
			timeZoneName: 'short',
		}).formatToParts(date);
		return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
	} catch {
		return timeZone;
	}
}

const DISPLAY_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
	// "Friday, August 14, 2026 at 6:33 AM MST"
	long: {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	},
	// "Fri, Aug 14, 2026, 6:33 AM MST" — for list previews
	short: {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	},
	// "8:33 AM MST" — an end time whose date is already on the line
	time: { hour: 'numeric', minute: '2-digit' },
};

/**
 * Format an instant for a human, always with the zone attached.
 *
 * The zone name is not decoration: these strings are what a user reads back to
 * check that "9:11 PM" meant *their* 9:11 PM.
 */
export function formatInTimeZone(
	date: Date,
	timeZone: string,
	style: keyof typeof DISPLAY_STYLES = 'long'
): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		...(DISPLAY_STYLES[style] || DISPLAY_STYLES.long),
		timeZoneName: 'short',
	}).format(date);
}

/**
 * Discord's timestamp markup styles.
 *
 * `F` is "Friday, September 11, 2026 9:11 PM", `R` is "in 3 weeks". The rest
 * are shorter cuts of the same instant.
 */
export type DiscordTimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

/**
 * An instant as Discord's `<t:unix:style>` markup.
 *
 * This is the one way of writing a time that is correct for every reader:
 * Discord renders it client-side on whatever clock the reader's own device
 * keeps. It sidesteps the entire question of whose zone we interpreted, which
 * is why the bot is told to use it for every date it writes rather than
 * formatting one itself.
 *
 * Returns '' for an unparseable date so a bad value shows as missing rather
 * than as `<t:NaN:F>`.
 */
export function discordTimestamp(
	date: Date | string | number | null | undefined,
	style: DiscordTimestampStyle = 'F'
): string {
	if (date === null || date === undefined || date === '') return '';
	const parsed = date instanceof Date ? date : new Date(date);
	const ms = parsed.getTime();
	if (!Number.isFinite(ms)) return '';
	return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/**
 * The full date plus a relative hint: "<t:…:F> (<t:…:R>)".
 *
 * The relative half is what catches a wrong year at a glance — "in 3 weeks"
 * reads very differently from "11 months ago".
 */
export function discordTimestampWithRelative(
	date: Date | string | number | null | undefined
): string {
	const full = discordTimestamp(date, 'F');
	if (!full) return '';
	return `${full} (${discordTimestamp(date, 'R')})`;
}

/** One zone, described every way the prompt needs it. */
export type ZoneReading = {
	timeZone: string;
	abbreviation: string;
	offsetMinutes: number;
	offsetLabel: string;
	nowLocal: string;
	todayLocal: string;
};

export type TimeContext = {
	/** The zone times are interpreted in: the user's, else the server's, else UTC. */
	timeZone: string;
	/** Which of those it came from — the prompt says so, rather than implying a choice. */
	source: 'user' | 'guild' | 'fallback';
	/** The DM user's own zone, when we know it. */
	user: ZoneReading | null;
	/** The guild's configured zone, when it has one. */
	guild: ZoneReading | null;
	/** The effective zone, always populated (it is `user` or `guild` or UTC). */
	effective: ZoneReading;
	/** True when we know both and they disagree — the bot then names the zone. */
	zonesDiffer: boolean;
	nowUTC: string;
	/** Convenience mirrors of `effective`, so callers don't reach through. */
	abbreviation: string;
	offsetLabel: string;
	nowLocal: string;
	todayLocal: string;
	/** A local 8:00 PM tonight, converted — the model copies the shape of this. */
	exampleLocal: string;
	exampleUTC: string;
};

function readZone(timeZone: string, now: Date): ZoneReading {
	const wall = wallClockIn(now, timeZone);
	const pad = (n: number) => String(n).padStart(2, '0');
	const offsetMinutes = offsetMinutesAt(now, timeZone);

	return {
		timeZone,
		abbreviation: timeZoneAbbreviation(now, timeZone),
		offsetMinutes,
		offsetLabel: formatOffsetLabel(offsetMinutes),
		nowLocal: formatInTimeZone(now, timeZone),
		todayLocal: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
	};
}

/** A zone we were handed, or null if it was unset or unrecognisable. */
function usableZoneOrNull(timezone?: string | null): string | null {
	const requested = String(timezone || '').trim();
	if (!requested || !isUsableTimeZone(requested)) return null;
	return requested;
}

export type TimeContextInput = {
	/** The DM user's own zone, from their account preferences. */
	userTimezone?: string | null;
	/** The selected guild's configured zone. */
	guildTimezone?: string | null;
};

/**
 * Work out which clock a spoken time is on.
 *
 * The server's configured zone wins when it has one. A server event is a
 * community fixture and the server's zone is the community's answer, so
 * assuming it needs no negotiation; the user's own zone is the stand-in for
 * servers that never set one. Getting this wrong is cheap now in a way it
 * wasn't before, because every time the bot writes back is Discord timestamp
 * markup that renders on the reader's own clock — so a misread is visible
 * immediately and the user can just say "no, 8pm".
 */
export function buildTimeContext(
	{ userTimezone, guildTimezone }: TimeContextInput = {},
	now: Date = new Date()
): TimeContext {
	const userZone = usableZoneOrNull(userTimezone);
	const guildZone = usableZoneOrNull(guildTimezone);

	const timeZone = guildZone || userZone || FALLBACK_TIMEZONE;
	const source: TimeContext['source'] = guildZone ? 'guild' : userZone ? 'user' : 'fallback';

	const user = userZone ? readZone(userZone, now) : null;
	const guild = guildZone ? readZone(guildZone, now) : null;
	const effective =
		(source === 'user' ? user : source === 'guild' ? guild : null) ?? readZone(timeZone, now);

	const wall = wallClockIn(now, timeZone);
	const exampleUTC = localWallClockToUTC({ ...wall, hour: 20, minute: 0, second: 0 }, timeZone);
	const pad = (n: number) => String(n).padStart(2, '0');

	return {
		timeZone,
		source,
		user,
		guild,
		effective,
		zonesDiffer: Boolean(user && guild && user.offsetMinutes !== guild.offsetMinutes),
		nowUTC: now.toISOString(),
		abbreviation: effective.abbreviation,
		offsetLabel: effective.offsetLabel,
		nowLocal: effective.nowLocal,
		todayLocal: effective.todayLocal,
		exampleLocal: `${wall.year}-${pad(wall.month)}-${pad(wall.day)} 8:00 PM`,
		exampleUTC: exampleUTC.toISOString(),
	};
}

/**
 * How the bot writes a time back, and the standing offer to change it.
 *
 * Both halves exist for the same reason: whichever zone we picked, the reader
 * sees the instant on their own clock and can correct it in one sentence. That
 * is what makes assuming the server's zone safe rather than presumptuous.
 */
const WRITING_TIMES_RULES = `
### Writing a time back to the user

**Never write a date or time as plain text.** Always use Discord's timestamp
markup, which every reader's client renders on their own local clock:

- \`<t:1757646660:F>\` → "Friday, September 11, 2026 9:11 PM" for whoever reads it.
- \`<t:1757646660:R>\` → "in 3 weeks".
- Write both when you announce or confirm an event: \`<t:1757646660:F> (<t:1757646660:R>)\`.
  The relative half is what makes a wrong year obvious at a glance.

Tool results hand you this markup already built — \`startTimeDiscord\`,
\`endTimeDiscord\`, \`startTimeRelative\`. Paste those verbatim. Do NOT write
"September 11th at 9:11 PM MST", do NOT convert anything for display, and do NOT
put a timezone abbreviation next to a timestamp; the markup already localises it.

### Always offer to change it

Every time you show or confirm an event, finish with a short line telling the
user they can change it just by saying so — the time, the date, the name, the
location. This is true **after** it has been created too: say so plainly rather
than implying it is now fixed. Something like "Say the word if you want the time,
name or anything else changed." One sentence, no ceremony.

When they do ask for a change, call \`update_scheduled_event\` on the existing
event — look it up with \`get_scheduled_events\` to get its id. Do not create a
second event, and do not tell them to edit it themselves in Discord.
`;

/**
 * The prompt section. Kept here (rather than inline in `buildSystemPrompt`) so
 * the wording and the arithmetic that feeds it are tested together.
 */
export function formatTimeContextForPrompt(context: TimeContext): string {
	let prompt = `\n\n## 🕒 CURRENT DATE AND TIME\n\n`;
	prompt += `- **Right now:** ${context.nowLocal}\n`;
	prompt += `- **Right now in UTC:** ${context.nowUTC}\n`;
	prompt += `- **Today's local date:** ${context.todayLocal}\n`;

	if (context.guild) {
		prompt += `- **This server's timezone:** ${context.guild.timeZone} (${context.guild.abbreviation}, ${context.guild.offsetLabel})`;
		prompt += context.source === 'guild' ? ` — use this one.\n` : `\n`;
	}
	if (context.user) {
		prompt += `- **The user's own timezone:** ${context.user.timeZone} (${context.user.abbreviation}, ${context.user.offsetLabel})`;
		prompt +=
			context.source === 'user'
				? ` — use this one; the server has not set one.\n`
				: ` — right now it is ${context.user.nowLocal} for them.\n`;
	}
	if (context.source === 'fallback') {
		prompt += `- **Timezone: UNKNOWN.** Neither this server nor the user has one set. Scheduling tools will REFUSE to run until you fix this — see below.\n`;
	}

	prompt += `\nInterpret dates and times the user gives you as **${context.timeZone}** unless they say otherwise. You know what "now" is from the lines above — never guess it, and never fall back to a year from your training data.\n\n`;
	prompt += `- A date with no year means the **next** occurrence on or after ${context.todayLocal}. Never resolve it to a past date.\n`;
	prompt += `- "tonight", "tomorrow", "next Friday" are relative to the local date above.\n`;
	prompt += `- \`scheduledStartTime\` and \`scheduledEndTime\` are ISO 8601 **in UTC** and must end in \`Z\`. Convert from local first — do not paste the local wall-clock time in and add a \`Z\`.\n`;
	prompt += `- Worked example: ${context.exampleLocal} local → \`${context.exampleUTC}\`.\n`;

	prompt += `- Never invent a date or time the user did not give you. If it is genuinely ambiguous, ask.\n`;

	if (context.zonesDiffer) {
		prompt += `- Note the user's own clock reads ${context.user?.abbreviation} while the server keeps ${context.guild?.abbreviation}. Use the server's, and do not belabour the difference — the timestamps you write render on their clock anyway.\n`;
	}

	prompt += WRITING_TIMES_RULES;

	// Last, and outside the bullet list, because it is a procedure rather than a
	// rule — and because it is the only thing that matters when it applies.
	if (context.source === 'fallback') {
		prompt += `\n**You cannot schedule anything yet.** \`preview_scheduled_event\`, \`confirm_scheduled_event\` and the rest of the scheduled-event tools will return an error while the timezone is unknown, because "9:11PM" is not a real instant until you know whose clock it is on. When the user asks to create an event:\n\n`;
		prompt += `1. Ask them what timezone they are in. Be brief and say why — you need it to schedule at the right time, and you will only ask once.\n`;
		prompt += `2. Take their answer ("Arizona", "EST", "I'm in London") and call \`update_user_timezone\` with the matching Region/City IANA name (America/Phoenix, America/New_York, Europe/London). Abbreviations are rejected; map them yourself.\n`;
		prompt += `3. Then go ahead with the event. It is saved permanently, so never ask a second time.\n\n`;
		prompt += `Do NOT guess a zone, do NOT quietly use UTC, and do NOT tell the user an event exists when the tool refused.\n`;
	}

	return prompt;
}
