/**
 * The SVG for one share card (1200×630). Pure: the caller supplies the mark as a data URI, so
 * this runs the same in the generator script and in tests. `scripts/generate-og-cards.ts` turns
 * it into the PNGs in `static/og/`.
 *
 * Layout: the brand at the top left, the words on the left, and on the right a drawing of what
 * is on the page (an uptime graph for the status page, a leaderboard for the leaderboards, and
 * so on). The drawings are illustrations, not data.
 */
import type { OgCard, OgCardKey } from './social.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

const PURPLE = '#7c3aed';
const LILAC = '#a78bfa';
const BLURPLE = '#5865F2';
const GREEN = '#34d399';
const AMBER = '#fbbf24';
const RED = '#f87171';
const INK = '#ffffff';
const MUTED = '#b4b0c9';
const LINE = '#ffffff';

// Discord Clyde logo mark (24×24 viewBox)
const DISCORD_LOGO_PATH =
	'M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.36-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z';

export function esc(str: string) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Break text into lines of at most `max` characters, on spaces. */
function greedyWrap(text: string, max: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && (line + ' ' + word).length > max) {
			lines.push(line);
			line = word;
		} else {
			line = line ? line + ' ' + word : word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * Wrap to at most `max` characters a line, then even the lines out: the same number of lines,
 * with the shortest width that still fits, so a line never ends on one lonely word.
 */
export function wrap(text: string, max: number): string[] {
	const first = greedyWrap(text, max);
	if (first.length < 2) return first;
	for (let width = Math.ceil(text.length / first.length); width < max; width++) {
		const lines = greedyWrap(text, width);
		if (lines.length === first.length && lines.every((l) => l.length <= width)) return lines;
	}
	return first;
}

// --- small drawing helpers (panel coordinates) -------------------------------------------

const rect = (x: number, y: number, w: number, h: number, fill: string, o = 1, r = 0) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" fill-opacity="${o}"/>`;
const bar = (x: number, y: number, w: number, o = 0.16, h = 10, fill = LINE) =>
	rect(x, y, w, h, fill, o, h / 2);
const circle = (cx: number, cy: number, r: number, fill: string, o = 1) =>
	`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="${o}"/>`;
const label = (
	x: number,
	y: number,
	text: string,
	size = 18,
	weight = 600,
	fill = INK,
	anchor = 'start'
) =>
	`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}" text-anchor="${anchor}">${esc(text)}</text>`;
const card = (x: number, y: number, w: number, h: number, r = 16, o = 0.06) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${LINE}" fill-opacity="${o}" stroke="${LINE}" stroke-opacity="0.12"/>`;
const STAR = 'M0-12 3.5-3.7 12-3.7 5.2 1.6 7.6 10.2 0 5.2-7.6 10.2-5.2 1.6-12-3.7-3.5-3.7Z';

// --- the drawings, one per card ---------------------------------------------------------

type Draw = () => string;

const VISUALS: Record<OgCardKey, Draw> = {
	// An uptime graph per system, like the page itself: one bar per day, mostly green.
	status: () => {
		const rows = ['Website', 'Database', 'Bot host', 'Discord'];
		const slow: Record<number, number[]> = { 2: [17], 3: [9, 26] };
		let out = '';
		rows.forEach((name, i) => {
			const y = 26 + i * 90;
			out += label(28, y + 22, name, 19, 600);
			out += circle(400, y + 15, 9, GREEN);
			out += `<path d="M395.5 15.5l3 3 5.5-6" transform="translate(0 ${y})" fill="none" stroke="#0d0b1a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
			const n = 34;
			const pitch = 372 / n;
			for (let k = 0; k < n; k++) {
				const colour = k < 3 ? LINE : slow[i]?.includes(k) ? AMBER : GREEN;
				const o = k < 3 ? 0.14 : 1;
				out += rect(28 + k * pitch, y + 38, pitch - 3.2, 30, colour, o, 2.5);
			}
		});
		return out;
	},

	home: () => {
		const tiles: [string, string][] = [
			[
				'Commands',
				`<text x="94" y="86" fill="${LILAC}" font-size="64" font-weight="700" font-family="${FONT}" text-anchor="middle">/</text>`,
			],
			['Automations', `<path d="M104 34 78 76h20l-8 34 28-46H98Z" fill="${AMBER}"/>`],
			[
				'AI assistant',
				`<path transform="translate(94 72) scale(2.6)" d="${STAR}" fill="${LILAC}"/><path transform="translate(122 46) scale(1)" d="${STAR}" fill="${LILAC}" fill-opacity="0.6"/>`,
			],
			[
				'Analytics',
				[0, 1, 2, 3]
					.map((k) =>
						rect(
							66 + k * 18,
							96 - [26, 44, 34, 62][k],
							12,
							[26, 44, 34, 62][k],
							k === 3 ? GREEN : LILAC,
							1,
							3
						)
					)
					.join(''),
			],
		];
		return tiles
			.map(([name, art], i) => {
				const x = 16 + (i % 2) * 204;
				const y = 24 + Math.floor(i / 2) * 188;
				return `<g transform="translate(${x} ${y})">${card(0, 0, 192, 172)}<g transform="translate(0 4)">${art}</g>${label(96, 152, name, 18, 600, INK, 'middle')}</g>`;
			})
			.join('');
	},

	docs: () =>
		card(24, 24, 380, 346, 18) +
		rect(48, 52, 150, 16, LILAC, 1, 8) +
		[0, 1, 2].map((k) => bar(48, 88 + k * 22, [320, 290, 240][k])).join('') +
		rect(48, 170, 332, 96, '#0d0b1a', 0.85, 12) +
		rect(64, 188, 70, 9, GREEN, 0.9, 4.5) +
		rect(142, 188, 110, 9, LILAC, 0.9, 4.5) +
		rect(80, 208, 150, 9, AMBER, 0.85, 4.5) +
		rect(80, 228, 100, 9, LINE, 0.3, 4.5) +
		rect(64, 244, 60, 9, GREEN, 0.9, 4.5) +
		[0, 1].map((k) => bar(48, 288 + k * 22, [300, 200][k])).join('') +
		rect(48, 334, 90, 14, PURPLE, 1, 7),

	devdocs: () =>
		rect(24, 40, 380, 314, '#0d0b1a', 0.9, 18) +
		`<rect x="24" y="40" width="380" height="314" rx="18" fill="none" stroke="${LINE}" stroke-opacity="0.14"/>` +
		circle(52, 66, 6, RED) +
		circle(72, 66, 6, AMBER) +
		circle(92, 66, 6, GREEN) +
		rect(52, 100, 52, 24, GREEN, 0.2, 12) +
		label(78, 117, 'GET', 14, 700, GREEN, 'middle') +
		bar(114, 106, 190, 0.5, 12, LILAC) +
		label(52, 168, '{', 26, 500, MUTED) +
		rect(76, 186, 60, 10, LILAC, 0.9, 5) +
		rect(146, 186, 120, 10, GREEN, 0.75, 5) +
		rect(76, 210, 80, 10, LILAC, 0.9, 5) +
		rect(166, 210, 90, 10, AMBER, 0.8, 5) +
		rect(76, 234, 50, 10, LILAC, 0.9, 5) +
		rect(136, 234, 150, 10, GREEN, 0.75, 5) +
		rect(76, 258, 90, 10, LILAC, 0.9, 5) +
		rect(176, 258, 60, 10, LINE, 0.3, 5) +
		label(52, 304, '}', 26, 500, MUTED),

	servers: () => {
		const hues = [PURPLE, '#2563eb', '#0d9488', '#db2777', '#d97706', '#4f46e5'];
		return hues
			.map((c, i) => {
				const x = 14 + (i % 3) * 136;
				const y = 38 + Math.floor(i / 3) * 170;
				return `<g transform="translate(${x} ${y})">${card(0, 0, 124, 158, 16)}${circle(62, 46, 26, c)}${label(62, 55, ['S', 'G', 'M', 'A', 'D', 'C'][i], 24, 700, INK, 'middle')}${bar(24, 92, 76, 0.28)}${bar(34, 112, 56, 0.14)}${rect(36, 132, 52, 12, GREEN, 0.22, 6)}</g>`;
			})
			.join('');
	},

	leaderboards: () => {
		const widths = [292, 244, 204, 164, 128];
		const medals = [AMBER, '#cbd5e1', '#d97706', LILAC, LILAC];
		return widths
			.map((w, i) => {
				const y = 26 + i * 68;
				return `<g transform="translate(0 ${y})">${card(14, 0, 400, 56, 14, i === 0 ? 0.1 : 0.05)}${label(40, 37, String(i + 1), 22, 800, medals[i], 'middle')}${circle(80, 28, 15, [PURPLE, '#2563eb', '#0d9488', '#db2777', '#4f46e5'][i])}${rect(108, 20, w * 0.95, 16, i === 0 ? AMBER : LILAC, i === 0 ? 0.9 : 0.7, 8)}</g>`;
			})
			.join('');
	},

	ideas: () => {
		const lines = [
			[210, 150],
			[180, 120],
			[230, 100],
		];
		return (
			lines
				.map(([a, b], i) => {
					const y = 130 + i * 84;
					return `<g transform="translate(0 ${y})">${card(18, 0, 392, 72, 14)}${rect(34, 12, 40, 48, PURPLE, 0.3, 10)}<path d="M54 24l11 13H43Z" fill="${LILAC}"/>${rect(46, 44, 16, 6, LILAC, 0.9, 3)}${bar(90, 18, a, 0.34, 12)}${bar(90, 42, b, 0.16)}</g>`;
				})
				.join('') +
			`<path d="M214 28a40 40 0 0 0-22 73v14h44v-14a40 40 0 0 0-22-73Z" transform="translate(0 -6)" fill="${AMBER}" fill-opacity="0.95"/>` +
			rect(196, 100, 36, 7, '#d97706', 1, 3.5) +
			rect(200, 112, 28, 6, '#d97706', 1, 3)
		);
	},

	vote: () =>
		circle(214, 150, 112, PURPLE, 0.16) +
		circle(214, 150, 84, PURPLE, 0.9) +
		`<path d="M214 100 258 158H228V206H200V158H170Z" fill="${INK}"/>` +
		[0, 1, 2, 3, 4]
			.map(
				(k) =>
					`<path transform="translate(${114 + k * 50} 300) scale(1.5)" d="${STAR}" fill="${AMBER}"/>`
			)
			.join('') +
		bar(114, 340, 200, 0.18),

	support: () =>
		card(20, 30, 270, 92, 20) +
		bar(44, 58, 200, 0.34, 12) +
		bar(44, 84, 140, 0.18) +
		rect(138, 144, 270, 92, PURPLE, 0.85, 20) +
		bar(162, 172, 200, 0.7, 12, INK) +
		bar(162, 198, 120, 0.4, 10, INK) +
		card(20, 258, 220, 70, 20) +
		bar(44, 284, 150, 0.34, 12) +
		bar(44, 306, 90, 0.18, 8) +
		rect(150, 340, 100, 26, GREEN, 0.2, 13) +
		label(200, 359, 'Online', 15, 600, GREEN, 'middle'),

	invite: () =>
		card(18, 26, 392, 120, 18) +
		circle(70, 86, 30, PURPLE) +
		label(70, 96, 'S', 26, 700, INK, 'middle') +
		bar(118, 66, 170, 0.4, 14) +
		bar(118, 92, 110, 0.18) +
		rect(40, 170, 348, 68, BLURPLE, 1, 18) +
		`<path transform="translate(70 188) scale(1.3)" d="${DISCORD_LOGO_PATH}" fill="${INK}"/>` +
		label(214, 212, 'Add to server', 22, 700, INK, 'middle') +
		[0, 1, 2]
			.map(
				(k) =>
					`<g transform="translate(0 ${260 + k * 40})">${rect(40, 0, 36, 22, GREEN, 0.9, 11)}${circle(65, 11, 8, INK)}${bar(92, 6, [190, 150, 170][k], 0.22)}</g>`
			)
			.join(''),

	login: () =>
		card(38, 40, 352, 314, 24) +
		circle(214, 112, 38, PURPLE) +
		`<path transform="translate(190 88) scale(2)" d="${DISCORD_LOGO_PATH}" fill="${INK}"/>` +
		bar(134, 178, 160, 0.34, 14) +
		bar(164, 204, 100, 0.16) +
		rect(66, 250, 296, 64, BLURPLE, 1, 16) +
		label(214, 290, 'Continue with Discord', 19, 700, INK, 'middle'),

	dashboard: () =>
		card(14, 28, 400, 340, 18) +
		rect(14, 28, 96, 340, LINE, 0.05, 18) +
		[0, 1, 2, 3]
			.map((k) =>
				k === 0 ? rect(26, 52, 72, 26, PURPLE, 0.9, 8) : bar(30, 94 + k * 34, 56, 0.2, 10)
			)
			.join('') +
		[0, 1, 2]
			.map(
				(k) =>
					`${rect(124 + k * 96, 48, 88, 60, LINE, 0.07, 12)}${bar(134 + k * 96, 62, 40, 0.3, 8)}${rect(134 + k * 96, 80, 54, 14, [GREEN, LILAC, AMBER][k], 0.9, 7)}`
			)
			.join('') +
		`<path d="M128 330 168 296 208 312 252 262 296 280 340 226 392 244" fill="none" stroke="${LILAC}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
		`<path d="M128 330 168 296 208 312 252 262 296 280 340 226 392 244V344H128Z" fill="${PURPLE}" fill-opacity="0.22"/>`,

	profile: () =>
		card(30, 30, 368, 330, 24) +
		circle(214, 114, 46, PURPLE) +
		circle(214, 104, 15, INK, 0.9) +
		`<path d="M184 144a30 24 0 0 1 60 0Z" fill="${INK}" fill-opacity="0.9"/>` +
		bar(144, 188, 140, 0.4, 14) +
		bar(174, 214, 80, 0.18) +
		rect(80, 252, 84, 28, AMBER, 0.22, 14) +
		rect(172, 252, 84, 28, GREEN, 0.22, 14) +
		rect(264, 252, 84, 28, LILAC, 0.25, 14) +
		bar(80, 306, 268, 0.12) +
		bar(80, 326, 190, 0.12),

	privacy: () =>
		`<path d="M214 34 340 82V186C340 264 292 322 214 354 136 322 88 264 88 186V82Z" fill="${PURPLE}" fill-opacity="0.9"/>` +
		`<path d="M214 34 340 82V186C340 264 292 322 214 354Z" fill="${INK}" fill-opacity="0.07"/>` +
		`<path d="M162 196l38 38 68-78" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`,

	terms: () =>
		card(60, 24, 308, 356, 20) +
		rect(88, 54, 140, 16, LILAC, 1, 8) +
		[0, 1, 2, 3]
			.map(
				(k) =>
					`<g transform="translate(0 ${100 + k * 52})">${circle(100, 14, 14, GREEN, 0.9)}<path d="M93 14l5 5 9-10" fill="none" stroke="#0d0b1a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${bar(130, 8, [200, 170, 190, 140][k], 0.24, 12)}</g>`
			)
			.join('') +
		`<path d="M92 336c12-18 22-18 28 0s16 18 26-4 18 6 36-2" fill="none" stroke="${LILAC}" stroke-width="3" stroke-linecap="round"/>`,
};

// --- the card ---------------------------------------------------------------------------

export function ogSvg(key: OgCardKey, meta: OgCard, markHref: string): string {
	const W = CARD_WIDTH;
	const H = CARD_HEIGHT;
	const TEXT_X = 76;

	const title = wrap(meta.title, 16);
	const subtitle = meta.subtitle === 'SpaceBot' ? [] : wrap(meta.subtitle, 36);
	const description = wrap(meta.description, 38).slice(0, 4);

	// Centre the words in the space under the brand row and above the domain.
	const TITLE_LH = 68;
	const SUB_LH = 36;
	const DESC_LH = 36;
	const blockH =
		title.length * TITLE_LH +
		(subtitle.length ? 14 + subtitle.length * SUB_LH : 0) +
		22 +
		description.length * DESC_LH;
	let y = 130 + (440 - blockH) / 2;

	let words = '';
	for (const line of title) {
		y += TITLE_LH;
		words += `<text x="${TEXT_X}" y="${y - 16}" fill="${INK}" font-size="60" font-weight="700" font-family="${FONT}" letter-spacing="-1">${esc(line)}</text>`;
	}
	if (subtitle.length) {
		y += 14;
		for (const line of subtitle) {
			y += SUB_LH;
			words += `<text x="${TEXT_X}" y="${y - 9}" fill="${LILAC}" font-size="27" font-weight="600" font-family="${FONT}">${esc(line)}</text>`;
		}
	}
	y += 22;
	for (const line of description) {
		y += DESC_LH;
		words += `<text x="${TEXT_X}" y="${y - 10}" fill="${MUTED}" font-size="25" font-weight="400" font-family="${FONT}">${esc(line)}</text>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D0B1A"/>
      <stop offset="100%" stop-color="#1a1333"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5610C6"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="mark"><rect x="${TEXT_X}" y="52" width="56" height="56" rx="14"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="900" cy="300" r="380" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#accent)"/>

  <!-- Brand -->
  <image href="${markHref}" x="${TEXT_X}" y="52" width="56" height="56" clip-path="url(#mark)"/>
  <rect x="${TEXT_X}" y="52" width="56" height="56" rx="14" fill="none" stroke="#7C3AED" stroke-opacity="0.6" stroke-width="2"/>
  <text x="${TEXT_X + 74}" y="89" fill="${INK}" font-size="28" font-weight="700" font-family="${FONT}">SpaceBot</text>

  <!-- Words -->
  ${words}

  <!-- What is on the page -->
  <g transform="translate(690 108)">
    <rect x="0" y="0" width="428" height="394" rx="30" fill="${LINE}" fill-opacity="0.035" stroke="${LINE}" stroke-opacity="0.1"/>
    ${VISUALS[key]()}
  </g>

  <!-- Domain -->
  <rect x="${TEXT_X}" y="552" width="64" height="4" rx="2" fill="url(#accent)"/>
  <text x="${TEXT_X}" y="588" fill="#8b87a3" font-size="21" font-weight="500" font-family="${FONT}">spacebot.starspace.group</text>
</svg>`;
}
