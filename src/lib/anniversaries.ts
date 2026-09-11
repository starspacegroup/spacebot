/**
 * Anniversary timelines — a historical day, minute by minute.
 *
 * Content lives here rather than in the database on purpose. Every guild gets
 * the same record; a per-server editable copy of a historical timeline is a way
 * for one to quietly drift wrong, and nobody would ever notice. Changing what
 * happened should be a commit with a diff, not a form field.
 *
 * Times are `HH:MM` on a 24-hour clock, in the timeline's OWN `timezone` — the
 * zone the events happened in. A guild may choose to read them against its own
 * clock instead (see `anniversary_timelines.timezone` in migration 0067), which
 * is why the times are stored as wall-clock strings and not as instants.
 *
 * Ordering is by time and is asserted in the tests. Keys are permanent: they
 * are the idempotency key in `anniversary_timeline_posts`, so renaming one
 * would re-post an event that already went out.
 */

export interface AnniversaryEvent {
	/** Permanent identifier. Never rename — this is the posted-once key. */
	key: string;
	/** Wall-clock `HH:MM`, 24-hour, in the timeline's timezone. */
	time: string;
	/** Short bold line. */
	title: string;
	/** The body. Written to stand alone — these arrive hours apart. */
	body: string;
	/**
	 * Marks the post that opens the day. It is the only one that carries the
	 * "N years ago today" framing, so the rest do not repeat it 26 times.
	 */
	opening?: boolean;
	/** Marks the closing post, which carries the toll rather than an event. */
	closing?: boolean;
}

export interface AnniversaryTimeline {
	key: string;
	title: string;
	/** Month and day the timeline runs on. `month` is 1-based. */
	month: number;
	day: number;
	/** The year the events happened, used for "N years ago today". */
	sourceYear: number;
	/** The zone the events are recorded in — the default reading clock. */
	timezone: string;
	/** Embed colour when the guild has not overridden it. */
	color: number;
	events: AnniversaryEvent[];
}

/**
 * September 11, 2001, Eastern Daylight Time.
 *
 * Sourced from the 9/11 Commission Report's timeline. Where a commonly-quoted
 * time and the Commission's differ, the Commission's is used. Impact and
 * collapse times are the seismically- and radar-confirmed ones, truncated to
 * the minute.
 *
 * The tone is deliberate: plain declaratives, no adjectives doing work the
 * facts already do. It is read by people who remember it and by people born
 * after it, and the second group is now most of them.
 */
const SEPTEMBER_11_2001: AnniversaryTimeline = {
	key: 'september-11-2001',
	title: 'September 11, 2001',
	month: 9,
	day: 11,
	sourceYear: 2001,
	timezone: 'America/New_York',
	color: 0x2b2d31,
	events: [
		{
			key: 'aa11-departs',
			time: '07:59',
			title: 'American 11 leaves Boston',
			body: 'American Airlines Flight 11 departs Boston Logan for Los Angeles with 92 people aboard. An ordinary Tuesday morning departure, eleven minutes late.',
			opening: true,
		},
		{
			key: 'ua175-departs',
			time: '08:14',
			title: 'United 175 leaves Boston',
			body: 'United Airlines Flight 175 departs Boston Logan for Los Angeles with 65 aboard. In the same minute, American 11 is hijacked.',
		},
		{
			key: 'betty-ong',
			time: '08:19',
			title: 'The first word from the air',
			body: 'Flight attendant Betty Ong reaches American Airlines on an in-flight phone and reports the hijacking. She stays on the line for 23 minutes. Hers is the first account anyone on the ground receives.',
		},
		{
			key: 'aa77-departs',
			time: '08:20',
			title: 'American 77 leaves Washington',
			body: 'American Airlines Flight 77 departs Washington Dulles for Los Angeles with 64 aboard.',
		},
		{
			key: 'we-have-some-planes',
			time: '08:24',
			title: '"We have some planes"',
			body: 'A hijacker aboard American 11 keys the microphone by mistake, and air traffic control hears the cockpit: "We have some planes." It is the first indication that this is not one aircraft.',
		},
		{
			key: 'neads-notified',
			time: '08:37',
			title: 'The military is told',
			body: 'Boston Center notifies the Northeast Air Defense Sector that American 11 has been hijacked. It is the first notification the military receives, nine minutes before the first impact.',
		},
		{
			key: 'ua93-departs',
			time: '08:42',
			title: 'United 93 leaves Newark',
			body: 'United Airlines Flight 93 departs Newark for San Francisco with 44 aboard, 42 minutes behind schedule. That delay is the reason its passengers will learn what is happening elsewhere.',
		},
		{
			key: 'north-tower-struck',
			time: '08:46',
			title: 'The North Tower is struck',
			body: 'American 11 strikes the North Tower of the World Trade Center between floors 93 and 99. Everyone above the impact is cut off. Fighters are scrambled from Otis Air National Guard Base in Massachusetts, with nothing yet to intercept.',
		},
		{
			key: 'south-tower-struck',
			time: '09:03',
			title: 'The South Tower is struck',
			body: 'United 175 strikes the South Tower between floors 77 and 85, live on television. In that moment an accident becomes an attack, watched by most of the country at once.',
		},
		{
			key: 'bush-informed',
			time: '09:05',
			title: 'The President is told',
			body: 'In a second-grade classroom in Sarasota, Florida, Andrew Card leans over the President and says: "A second plane hit the second tower. America is under attack."',
		},
		{
			key: 'bridges-closed',
			time: '09:21',
			title: 'Manhattan is sealed',
			body: 'The Port Authority closes every bridge and tunnel into Manhattan. Hundreds of thousands of people will walk home across them anyway.',
		},
		{
			key: 'ua93-hijacked',
			time: '09:28',
			title: 'United 93 is hijacked',
			body: 'United 93 is taken over high above Ohio, 46 minutes after leaving Newark.',
		},
		{
			key: 'pentagon-struck',
			time: '09:37',
			title: 'The Pentagon is struck',
			body: 'American 77 strikes the western face of the Pentagon, killing 59 aboard and 125 people in the building.',
		},
		{
			key: 'ground-stop',
			time: '09:42',
			title: 'Every aircraft is grounded',
			body: 'The FAA orders every civilian aircraft over the United States to land immediately — about 4,500 planes. It has never been done before or since. The order is given by Ben Sliney, National Operations Manager, on his first day in the job.',
		},
		{
			key: 'white-house-evacuated',
			time: '09:45',
			title: 'Washington empties',
			body: 'The White House and the Capitol are evacuated. Staff are told to run, and to take off their shoes to do it.',
		},
		{
			key: 'ua93-revolt',
			time: '09:57',
			title: 'The passengers of United 93 decide',
			body: 'Having learned from phone calls what the other planes were used for, the passengers and crew take a vote, and then charge the cockpit.',
		},
		{
			key: 'south-tower-falls',
			time: '09:59',
			title: 'The South Tower falls',
			body: 'The South Tower collapses in ten seconds. It stood for 56 minutes after being struck.',
		},
		{
			key: 'ua93-crashes',
			time: '10:03',
			title: 'United 93 goes down',
			body: 'United 93 crashes into a field near Shanksville, Pennsylvania, at 563 miles per hour. It is 20 minutes’ flying time from Washington. No one on the ground is harmed.',
		},
		{
			key: 'pentagon-collapse',
			time: '10:15',
			title: 'The Pentagon’s E-ring collapses',
			body: 'A section of the Pentagon’s outermost ring gives way, half an hour after the impact.',
		},
		{
			key: 'north-tower-falls',
			time: '10:28',
			title: 'The North Tower falls',
			body: 'The North Tower collapses. It stood for 102 minutes — long enough for roughly 15,000 people to get out, and for hundreds of firefighters to be climbing it when it came down.',
		},
		{
			key: 'lower-manhattan-evacuated',
			time: '11:02',
			title: 'Lower Manhattan is evacuated',
			body: 'Mayor Giuliani orders everyone below Canal Street to leave. The area is under several inches of pulverised building.',
		},
		{
			key: 'airspace-clear',
			time: '12:16',
			title: 'The sky is empty',
			body: 'The last commercial flight lands. For the first time, there is no civilian aircraft in American airspace. It stays that way for two days.',
		},
		{
			key: 'military-alert',
			time: '13:04',
			title: 'Worldwide high alert',
			body: 'From Barksdale Air Force Base in Louisiana, the President announces that American military forces are on high alert worldwide.',
		},
		{
			key: 'wtc7-falls',
			time: '17:20',
			title: '7 World Trade Center falls',
			body: 'The 47-storey 7 World Trade Center collapses. Nothing struck it; it had burned unfought all afternoon, because there was no water and no one left to send.',
		},
		{
			key: 'bush-returns',
			time: '18:58',
			title: 'The President returns to Washington',
			body: 'After Barksdale and Offutt, the President arrives back at the White House.',
		},
		{
			key: 'address',
			time: '20:30',
			title: 'The address to the nation',
			body: 'The President addresses the country from the Oval Office. By now the rescue has become a recovery, and almost no one knows it yet.',
		},
		{
			key: 'toll',
			time: '21:00',
			title: 'The toll',
			body: [
				'**2,977 people were killed**, not counting the 19 hijackers: 2,753 at the World Trade Center, 184 at the Pentagon, 40 aboard United 93. They came from 77 countries.',
				'',
				'Among them were 343 New York City firefighters, 37 Port Authority police officers and 23 NYPD officers — the largest loss of emergency responders in American history. Most died inside that 102-minute window, going up the stairs while everyone else came down.',
				'',
				'More have died since of illness from the air at Ground Zero than were killed that morning.',
			].join('\n'),
			closing: true,
		},
	],
};

export const ANNIVERSARY_TIMELINES: AnniversaryTimeline[] = [SEPTEMBER_11_2001];

export const DEFAULT_TIMELINE_KEY = SEPTEMBER_11_2001.key;

export function getTimeline(key: string): AnniversaryTimeline | null {
	return ANNIVERSARY_TIMELINES.find((t) => t.key === key) ?? null;
}

/** `HH:MM` → minutes since midnight. Returns null for anything malformed. */
export function minutesOfDay(time: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
	if (!match) return null;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;

	return hours * 60 + minutes;
}

/**
 * What a guild's clock reads right now, in the zone it chose.
 *
 * `Intl` rather than arithmetic on purpose: the offset changes with daylight
 * saving, and September 11 falls inside it for New York — so a fixed -5 would
 * put the whole day an hour out every single year, which is exactly the class
 * of bug nobody catches until the one day it shows.
 */
export function zonedNow(
	now: Date,
	timeZone: string
): { year: number; month: number; day: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(now);

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	// Midnight formats as hour "24" in some ICU versions; normalise it to 0.
	const hour = get('hour') % 24;

	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		minutes: hour * 60 + get('minute'),
	};
}

/**
 * The events that are due right now and have not gone out yet.
 *
 * "Due" is a window, not an instant: from the event's minute up to
 * `graceMinutes` after it. Before the window it is early, after it the day has
 * moved on and posting would be worse than not. `posted` carries the keys
 * already claimed for this year, whatever their outcome — a failed send is not
 * retried, for the reason given in migration 0067.
 */
export function dueEvents(
	timeline: AnniversaryTimeline,
	clock: { month: number; day: number; minutes: number },
	posted: Set<string>,
	graceMinutes: number
): { due: AnniversaryEvent[]; expired: AnniversaryEvent[] } {
	const due: AnniversaryEvent[] = [];
	const expired: AnniversaryEvent[] = [];

	if (clock.month !== timeline.month || clock.day !== timeline.day) {
		return { due, expired };
	}

	for (const event of timeline.events) {
		if (posted.has(event.key)) continue;

		const at = minutesOfDay(event.time);
		if (at === null) continue;

		const late = clock.minutes - at;
		if (late < 0) continue;
		if (late <= graceMinutes) due.push(event);
		else expired.push(event);
	}

	return { due, expired };
}

/** The "N years ago today" number, or null before the first anniversary. */
export function yearsSince(timeline: AnniversaryTimeline, year: number): number | null {
	const years = year - timeline.sourceYear;
	return years > 0 ? years : null;
}
