/**
 * Names are free text. `*Space` is a real server and the asterisk is part of
 * the name — but the same class of bug hits any name carrying markdown
 * punctuation, so these use a spread of realistic awkward names rather than
 * special-casing one.
 */
import { describe, expect, it } from 'vitest';
import {
	escapeDiscordMarkdown,
	findGuildMatches,
	namesMatch,
	normalizeNameForMatch,
	quoteNameForPrompt,
	resolveGuildByName,
} from '../lib/discord/markdown.js';
import { buildSystemPrompt } from '../lib/ai/chat.js';

const AWKWARD_NAMES = [
	'*Space',
	'**Bold** Server',
	'_underscore_',
	'~lounge~',
	'[Test] Server',
	'Server | Community',
	'`code`',
	'C:\\\\Windows',
	'# hashtag',
	'- dashes -',
];

describe('escapeDiscordMarkdown', () => {
	it('keeps the asterisk in *Space from being read as formatting', () => {
		expect(escapeDiscordMarkdown('*Space')).toBe('\\*Space');
	});

	it('escapes the backslash first so escaping does not double-mangle', () => {
		expect(escapeDiscordMarkdown('C:\\Windows')).toBe('C:\\\\Windows');
		expect(escapeDiscordMarkdown('a\\*b')).toBe('a\\\\\\*b');
	});

	it('leaves plain names untouched', () => {
		expect(escapeDiscordMarkdown('Gaming Hub')).toBe('Gaming Hub');
	});

	it('handles empty and nullish input', () => {
		expect(escapeDiscordMarkdown('')).toBe('');
		expect(escapeDiscordMarkdown(null)).toBe('');
		expect(escapeDiscordMarkdown(undefined)).toBe('');
	});

	it('escapes every markdown character an awkward name can carry', () => {
		for (const name of AWKWARD_NAMES) {
			const escaped = escapeDiscordMarkdown(name);
			// Every markdown char in the output must be backslash-preceded.
			for (let i = 0; i < escaped.length; i++) {
				if (/[*_~`|>#\-[\]()]/.test(escaped[i])) {
					expect(escaped[i - 1]).toBe('\\');
				}
			}
		}
	});
});

describe('quoteNameForPrompt', () => {
	it('delimits the name so the model can see where it ends', () => {
		expect(quoteNameForPrompt('*Space')).toBe('"*Space"');
		expect(quoteNameForPrompt('[Test] Server')).toBe('"[Test] Server"');
	});

	it('escapes embedded quotes rather than producing an ambiguous string', () => {
		expect(quoteNameForPrompt('The "Best" Server')).toBe('"The \\"Best\\" Server"');
	});

	it('round-trips every awkward name exactly', () => {
		for (const name of AWKWARD_NAMES) {
			expect(JSON.parse(quoteNameForPrompt(name))).toBe(name);
		}
	});
});

describe('name matching tolerates a model dropping punctuation', () => {
	it('matches *Space to Space — the actual reported failure', () => {
		// The model replied about a server called "Space"; a lookup must still
		// resolve rather than silently finding nothing.
		expect(namesMatch('*Space', 'Space')).toBe(true);
		expect(namesMatch('*Space', '*Space')).toBe(true);
		expect(namesMatch('*Space', 'space')).toBe(true);
	});

	it('does not collapse genuinely different servers together', () => {
		expect(namesMatch('*Space', 'Spaced')).toBe(false);
		expect(namesMatch('Gaming', 'Music')).toBe(false);
	});

	it('never matches on empty input', () => {
		expect(namesMatch('', '')).toBe(false);
		expect(namesMatch(null, null)).toBe(false);
		expect(namesMatch('*', '')).toBe(false);
	});

	it('normalizes punctuation and whitespace, not letters', () => {
		expect(normalizeNameForMatch('  **Bold**   Server ')).toBe('bold server');
		expect(normalizeNameForMatch('[Test] Server')).toBe('test server');
	});
});

describe('resolveGuildByName', () => {
	const guilds = [
		{ id: '111111111111111111', name: '*Space' },
		{ id: '222222222222222222', name: 'Gaming Hub' },
		{ id: '333333333333333333', name: '[Test] Server' },
	];

	it('resolves whether or not the model kept the punctuation', () => {
		expect(resolveGuildByName(guilds, '*Space')?.id).toBe('111111111111111111');
		expect(resolveGuildByName(guilds, 'Space')?.id).toBe('111111111111111111');
		expect(resolveGuildByName(guilds, 'space')?.id).toBe('111111111111111111');
		expect(resolveGuildByName(guilds, 'Test Server')?.id).toBe('333333333333333333');
	});

	it('prefers an id when one is supplied', () => {
		expect(resolveGuildByName(guilds, '222222222222222222')?.name).toBe('Gaming Hub');
	});

	it('returns nothing rather than guessing when ambiguous', () => {
		// Acting on the wrong server is far worse than asking.
		const ambiguous = [
			{ id: '1', name: 'Space Station' },
			{ id: '2', name: 'Space Camp' },
		];
		expect(resolveGuildByName(ambiguous, 'Space')).toBeNull();
		expect(resolveGuildByName(guilds, 'nothing like this')).toBeNull();
		expect(resolveGuildByName(guilds, '')).toBeNull();
		expect(resolveGuildByName([], 'Space')).toBeNull();
	});
});

describe('system prompt presents names unambiguously', () => {
	function promptFor(name: string) {
		return buildSystemPrompt({
			managedGuilds: [{ id: '111111111111111111', name, isOwner: true }],
			mcpEnabled: false,
			isSuperAdmin: false,
			selectedGuild: null,
			selectedGuildId: '111111111111111111',
			selectedGuildName: name,
			runnerInventory: null,
		});
	}

	it('quotes the name so its punctuation survives into the model', () => {
		const prompt = promptFor('*Space');
		expect(prompt).toContain('"*Space"');
		// The old format dropped the bare name into a markdown heading.
		expect(prompt).not.toContain('### *Space [');
	});

	it('keeps a name with brackets or pipes from colliding with the badge list', () => {
		// `### [Test] Server [✅ SELECTED | 👑 Owner]` — where does the name end?
		const bracketed = promptFor('[Test] Server');
		expect(bracketed).toContain('"[Test] Server"');
		expect(bracketed).not.toContain('### [Test] Server [');

		const piped = promptFor('Server | Community');
		expect(piped).toContain('"Server | Community"');
	});

	it('tells the model that names are literal and must not be tidied', () => {
		const prompt = promptFor('*Space');
		expect(prompt).toMatch(/NAMES ARE LITERAL/);
		expect(prompt).toMatch(/is not `Space`|\*Space` is not/);
	});

	it('still carries the server id, which is the real identifier', () => {
		expect(promptFor('*Space')).toContain('111111111111111111');
	});
});

describe('findGuildMatches tiering', () => {
	it('lets an exact match win over a longer name that merely contains it', () => {
		const guilds = [
			{ id: '1', name: 'Space Station' },
			{ id: '2', name: 'Space' },
		];
		expect(findGuildMatches(guilds, 'Space').map((g) => g.id)).toEqual(['2']);
	});

	it('returns every candidate when a query is genuinely ambiguous', () => {
		const guilds = [
			{ id: '1', name: 'Space Station' },
			{ id: '2', name: 'Space Camp' },
		];
		// The old `.find()` silently returned whichever was first in the array,
		// switching the user to a server they did not ask for.
		expect(findGuildMatches(guilds, 'space').map((g) => g.id)).toEqual(['1', '2']);
	});

	it('resolves *Space with or without the asterisk, and by id', () => {
		const guilds = [
			{ id: '111111111111111111', name: '*Space' },
			{ id: '222222222222222222', name: 'Gaming' },
		];
		for (const q of ['*Space', 'Space', 'space', '  *space  ', '111111111111111111']) {
			expect(findGuildMatches(guilds, q).map((g) => g.id)).toEqual(['111111111111111111']);
		}
	});

	it('returns nothing for an empty or unmatched query', () => {
		expect(findGuildMatches([{ id: '1', name: 'A' }], '')).toEqual([]);
		expect(findGuildMatches([{ id: '1', name: 'A' }], 'zzz')).toEqual([]);
		expect(findGuildMatches([], 'A')).toEqual([]);
	});
});
