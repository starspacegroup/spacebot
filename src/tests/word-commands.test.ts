import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

let enabled = true;
vi.mock('../lib/db/commands.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/db/commands.js')>()),
	getCommandByName: vi.fn(async () => (enabled ? { name: 'x' } : null)),
}));

import {
	LOOKUP_LIMIT,
	cleanWord,
	handleWordCommand,
	isWordCommand,
	parseDatamuse,
	parseWiktionary,
	stripHtml,
} from '../lib/server/word-commands.js';

const migration = (file: string) =>
	readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

const A = (word: string) => `<a rel="mw:WikiLink" href="/wiki/${word}" title="${word}">${word}</a>`;
const DEFINITION = {
	en: [
		{
			partOfSpeech: 'Noun',
			language: 'English',
			definitions: [
				{
					definition: `The ${A('phenomenon')} of making an ${A('unplanned')}, ${A('fortunate')} ${A('discovery')} &amp; more.`,
					examples: ['<i>A happy <b>serendipity</b>.</i>'],
				},
				{ definition: '' },
				{ definition: '<span class="usage-label-sense">(rare)</span> A second sense.' },
				{ definition: 'A third sense that is not shown.' },
			],
		},
		{
			partOfSpeech: 'Adjective',
			language: 'English',
			definitions: [{ definition: 'Of or by serendipity.' }],
		},
	],
	de: [
		{
			partOfSpeech: 'Noun',
			language: 'German',
			definitions: [{ definition: 'Nicht gezeigt.' }],
		},
	],
};

const body = (word: unknown, over: Record<string, any> = {}) => ({
	guild_id: 'g1',
	member: { user: { id: 'u1' } },
	data: { options: [{ name: 'word', type: 3, value: word }] },
	...over,
});
const reply = (json: unknown, status = 200) =>
	Promise.resolve(new Response(JSON.stringify(json), { status }));

let db: ReturnType<typeof createSqliteD1>;
beforeEach(() => {
	enabled = true;
	db = createSqliteD1(migration('0054_roadmap_completion.sql'));
});

describe('cleanWord', () => {
	it('tidies a word and refuses anything that is not letters', () => {
		expect(cleanWord('  Serendipity ')).toBe('serendipity');
		expect(cleanWord('ice   cream')).toBe('ice cream');
		expect(cleanWord("don't")).toBe("don't");
		expect(cleanWord('café')).toBe('café');
		for (const bad of [
			'',
			'   ',
			'123',
			'a/b',
			'<@123>',
			'**bold**',
			'x'.repeat(41),
			undefined,
			null,
		]) {
			expect(cleanWord(bad)).toBeNull();
		}
	});
	it('knows its two commands', () => {
		expect(isWordCommand('define')).toBe(true);
		expect(isWordCommand('synonym')).toBe(true);
		expect(isWordCommand('game')).toBe(false);
	});
});

describe('parsing', () => {
	it('strips markup and decodes entities', () => {
		expect(stripHtml(`The ${A('x')} &amp; <i>y</i> &lt;3 &#39;q&#39; &#x41; &nbsp;z`)).toBe(
			"The x & y <3 'q' A z"
		);
		expect(stripHtml('&unknown; &#99999999;')).toBe('&unknown;');
		expect(stripHtml(undefined)).toBe('');
	});
	it('reads the English entries only, skipping empty senses, and tolerates junk', () => {
		const meanings = parseWiktionary(DEFINITION);
		expect(meanings.map((m) => m.partOfSpeech)).toEqual(['Noun', 'Adjective']);
		expect(meanings[0].definitions).toHaveLength(3); // the empty one is gone
		expect(meanings[0].definitions[0]).toEqual({
			definition: 'The phenomenon of making an unplanned, fortunate discovery & more.',
			example: 'A happy serendipity.',
		});
		expect(parseWiktionary({ title: 'Not found.' })).toEqual([]);
		expect(parseWiktionary(null)).toEqual([]);
		expect(
			parseWiktionary({ en: [{ partOfSpeech: 'Noun', definitions: [{ definition: '' }] }] })
		).toEqual([]);
	});
	it('keeps distinct single words from Datamuse, never the query, and drops names and phrases', () => {
		const rows = [
			{ word: 'glad' },
			{ word: 'Happy' },
			{ word: 'happy' },
			{ word: 'joyful' },
			{ word: 'glad' },
			{ word: '<@1>' },
			{ word: 'jonathan swift' },
		];
		expect(parseDatamuse(rows, 'happy')).toEqual(['glad', 'joyful']);
		expect(parseDatamuse([{ word: 'ice box' }], 'ice cream')).toEqual(['ice box']); // a phrase query keeps phrases
		expect(parseDatamuse({ nope: true }, 'x')).toEqual([]);
	});
});

describe('/define', () => {
	it('answers with an embed, two senses per part of speech, and no pings', async () => {
		const fetcher = vi.fn((_url: string) => reply(DEFINITION));
		const out: any = await handleWordCommand('define', body('Serendipity'), db, fetcher);
		expect(fetcher.mock.calls[0][0]).toBe(
			'https://en.wiktionary.org/api/rest_v1/page/definition/serendipity'
		);
		const e = out.data.embeds[0];
		expect(e.title).toBe('serendipity');
		expect(e.url).toBe('https://en.wiktionary.org/wiki/serendipity');
		expect(e.fields.map((f: any) => f.name)).toEqual(['Noun', 'Adjective']);
		expect(e.fields[0].value).toContain('1. The phenomenon of making');
		expect(e.fields[0].value).toContain('2. (rare) A second sense.');
		expect(e.fields[0].value).not.toContain('third sense');
		expect(e.fields[0].value).not.toContain('<'); // no markup reaches Discord
		expect(e.footer.text).toContain('Wiktionary');
		expect(out.data.allowed_mentions).toEqual({ parse: [] });
		expect(out.data.flags).toBeUndefined(); // public
	});

	it('shows the everyday parts of speech before odd ones like Symbol', async () => {
		const out: any = await handleWordCommand('define', body('run'), db, () =>
			reply({
				en: [
					{ partOfSpeech: 'Symbol', definitions: [{ definition: 'A language code.' }] },
					{ partOfSpeech: 'Verb', definitions: [{ definition: 'To move quickly.' }] },
					{ partOfSpeech: 'Noun', definitions: [{ definition: 'An act of running.' }] },
				],
			})
		);
		expect(out.data.embeds[0].fields.map((f: any) => f.name)).toEqual([
			'Noun',
			'Verb',
			'Symbol',
		]);
	});

	it('looks a phrase up with underscores', async () => {
		const fetcher = vi.fn((_url: string) => reply(DEFINITION));
		await handleWordCommand('define', body('Ice   Cream'), db, fetcher);
		expect(fetcher.mock.calls[0][0]).toBe(
			'https://en.wiktionary.org/api/rest_v1/page/definition/ice_cream'
		);
	});

	it('says so for an unknown word, a word with no English entry, a failing service and a slow one', async () => {
		const missing: any = await handleWordCommand('define', body('zzzxq'), db, () =>
			reply({}, 404)
		);
		expect(missing.data.content).toContain('No definition found for **zzzxq**');
		expect(missing.data.flags).toBe(64);

		const foreign: any = await handleWordCommand('define', body('haus'), db, () =>
			reply({ de: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'x' }] }] })
		);
		expect(foreign.data.content).toContain('No English definition');

		const down: any = await handleWordCommand('define', body('word'), db, () => reply({}, 502));
		expect(down.data.content).toContain('having trouble');

		const slow: any = await handleWordCommand('define', body('word'), db, () =>
			Promise.reject(new DOMException('timed out', 'TimeoutError'))
		);
		expect(slow.data.content).toContain('having trouble');
	});
});

describe('/synonym', () => {
	it('lists synonyms, best first', async () => {
		const fetcher = vi.fn((_url: string) =>
			reply([{ word: 'glad' }, { word: 'joyful' }, { word: 'cheerful' }])
		);
		const out: any = await handleWordCommand('synonym', body('happy'), db, fetcher);
		expect(fetcher.mock.calls[0][0]).toContain('rel_syn=happy');
		expect(out.data.embeds[0].title).toBe('Synonyms for “happy”');
		expect(out.data.embeds[0].description).toBe('glad, joyful, cheerful');
	});

	it('falls back to "means like" and says so, then gives up politely', async () => {
		const calls: string[] = [];
		const fetcher = vi.fn((url: string) => {
			calls.push(url);
			return reply(url.includes('rel_syn') ? [] : [{ word: 'fast' }, { word: 'quick' }]);
		});
		const out: any = await handleWordCommand('synonym', body('swift'), db, fetcher);
		expect(calls).toHaveLength(2);
		expect(out.data.embeds[0].title).toBe('Words like “swift”');

		const none: any = await handleWordCommand('synonym', body('swift'), db, () => reply([]));
		expect(none.data.content).toContain('No synonyms found');
	});
});

describe('guards', () => {
	it('is off unless the server turned it on', async () => {
		enabled = false;
		const fetcher = vi.fn();
		const out: any = await handleWordCommand('define', body('word'), db, fetcher);
		expect(out.data.content).toContain('not turned on');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refuses a bad word and a command outside a server, without calling out', async () => {
		const fetcher = vi.fn();
		expect(
			((await handleWordCommand('define', body('<@123>'), db, fetcher)) as any).data.content
		).toContain('made of letters');
		expect(
			(
				(await handleWordCommand(
					'define',
					body('word', { guild_id: undefined }),
					db,
					fetcher
				)) as any
			).data.content
		).toContain('inside a server');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('limits one member to a dozen lookups a minute, per member', async () => {
		const fetcher = vi.fn((_url: string) => reply(DEFINITION));
		for (let i = 0; i < LOOKUP_LIMIT.max; i++) {
			const ok: any = await handleWordCommand('define', body('word'), db, fetcher);
			expect(ok.data.embeds).toBeTruthy();
		}
		const over: any = await handleWordCommand('define', body('word'), db, fetcher);
		expect(over.data.content).toContain('Try again in a minute');
		const other: any = await handleWordCommand(
			'define',
			body('word', { member: { user: { id: 'u2' } } }),
			db,
			fetcher
		);
		expect(other.data.embeds).toBeTruthy();
	});
});

describe('migration 0092', () => {
	it('adds both commands off by default, once', async () => {
		const sql = migration('0092_word_commands.sql');
		const fresh: any = createSqliteD1(
			`CREATE TABLE commands (id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT, description TEXT,
			   enabled INTEGER, is_built_in INTEGER, options TEXT, ephemeral INTEGER, defer INTEGER,
			   action_type TEXT, action_config TEXT, response_type TEXT, response_content TEXT,
			   response_embed TEXT, created_by TEXT, UNIQUE(guild_id, name));`
		);
		fresh.exec(sql);
		fresh.exec(sql);
		const rows = (
			await fresh
				.prepare('SELECT name, enabled, is_built_in, options FROM commands ORDER BY name')
				.all()
		).results;
		expect(rows.map((r: any) => [r.name, r.enabled, r.is_built_in])).toEqual([
			['define', 0, 1],
			['synonym', 0, 1],
		]);
		expect(JSON.parse(rows[0].options)[0]).toMatchObject({
			name: 'word',
			type: 3,
			required: true,
			max_length: 40,
		});
	});
});
