/**
 * `/status`: the status page as a Discord embed. Pure: the caller reads the snapshot, this shapes
 * it. Same checks, same words and same "no data" honesty as the page.
 */

import type { StatusSnapshot } from '../db/status.js';
import { SITE_URL } from '../seo/social.js';
import { ageSeconds, describeAgo, type Status } from './logic.js';

const ICON: Record<Status, string> = { operational: '🟢', degraded: '🟡', down: '🔴' };
const WORD: Record<Status, string> = {
	operational: 'Operational',
	degraded: 'Slow',
	down: 'Down',
};
const COLOR: Record<Status, number> = { operational: 0x57f287, degraded: 0xfee75c, down: 0xed4245 };
const GREY = 0x95a5a6;
const MAX_INCIDENTS = 3;

export function buildStatusEmbed(snap: StatusSnapshot | null, now: Date = new Date()) {
	const url = `${SITE_URL}/status`;
	if (!snap) {
		return {
			title: 'SpaceBot status',
			url,
			description: 'The status checks could not be read just now. Try again in a minute.',
			color: GREY,
		};
	}

	const fields = snap.components.map((c) => ({
		name: `${ICON[c.status]} ${c.name}`,
		value:
			c.uptimePercent === null
				? WORD[c.status]
				: `${WORD[c.status]} · ${c.uptimePercent}% over 90 days`,
		inline: true,
	}));

	if (snap.openIncidents.length) {
		fields.push({
			name: 'Open incidents',
			value: snap.openIncidents
				.slice(0, MAX_INCIDENTS)
				.map((i) => `• ${i.title}`)
				.join('\n')
				.slice(0, 1000),
			inline: false,
		});
	}

	const checked = snap.lastChecked
		? `Last checked ${describeAgo(ageSeconds(snap.lastChecked, now))}`
		: 'No check has run yet';

	return {
		title: snap.stale ? 'SpaceBot status: no recent checks' : snap.headline,
		url,
		description: snap.stale
			? 'No check has run lately, so this may be out of date.'
			: undefined,
		color: snap.stale ? GREY : COLOR[snap.overall],
		fields,
		footer: { text: `${checked} · full history at ${SITE_URL.replace('https://', '')}/status` },
	};
}
