import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.js';

const enabled = { on: true };
vi.mock('../lib/db/commands.js', () => ({
	getCommandByName: async () => (enabled.on ? { name: 'personality' } : null),
}));

import { handlePersonalityCommand } from '../lib/server/personality-command.js';
import {
	CATEGORIES,
	TESTS,
	cleanUrl,
	listed,
	listEmbed,
	matchBuiltIn,
	search,
} from '../lib/server/personality-tests.js';

const SCHEMA = `
CREATE TABLE personality_hidden (guild_id TEXT NOT NULL, test_id TEXT NOT NULL, hidden_by TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (guild_id, test_id));
CREATE TABLE personality_custom (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
	name TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'hubs', note TEXT,
	added_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`;

const MANAGE = String(1 << 5);
const body = (sub: string, options: any[] = [], permissions = '0', guild = 'g1') => ({
	guild_id: guild,
	member: { user: { id: 'u1' }, permissions },
	data: { name: 'personality', options: [{ name: sub, type: 1, options }] },
});
const opt = (name: string, value: any) => ({ name, value });
const text = (r: any) => r.data.content ?? '';
const embed = (r: any) => r.data.embeds?.[0];

let db: any;
beforeEach(() => {
	enabled.on = true;
	db = createSqliteD1(SCHEMA);
});
const admin = (sub: string, options: any[] = [], guild = 'g1') =>
	handlePersonalityCommand(body(sub, options, MANAGE, guild), db);

describe('the catalog', () => {
	it('has unique ids, real https links, and every category used', () => {
		expect(new Set(TESTS.map((t) => t.id)).size).toBe(TESTS.length);
		expect(new Set(TESTS.map((t) => t.url)).size).toBe(TESTS.length);
		for (const t of TESTS) expect(cleanUrl(t.url)).not.toBeNull();
		for (const c of CATEGORIES) expect(TESTS.some((t) => t.category === c.id)).toBe(true);
		for (const t of TESTS) expect(CATEGORIES.some((c) => c.id === t.category)).toBe(true);
	});
	it('covers the kinds David named', () => {
		const names = TESTS.map((t) => `${t.name} ${t.keywords.join(' ')}`.toLowerCase()).join(' ');
		for (const k of ['bdsm', 'autism', 'myers briggs', 'enneagram', 'big five', 'attachment']) {
			expect(names).toContain(k);
		}
	});
	it('marks the BDSM test adult', () => {
		expect(TESTS.find((t) => t.id === 'bdsm-test')?.adult).toBe(true);
	});
});

describe('search', () => {
	const all = listed(new Set(), []);
	it('finds by topic word', () => {
		expect(search(all, 'autism').map((i) => i.key)).toEqual(
			expect.arrayContaining(['aq', 'raads-r'])
		);
		expect(search(all, 'mbti').map((i) => i.key)).toContain('16personalities');
		expect(search(all, 'kink')[0].key).toBe('bdsm-test');
	});
	it('puts an exact name first and needs every word to match', () => {
		expect(search(all, 'hexaco')[0].key).toBe('hexaco');
		expect(search(all, 'autism zzzqqq')).toEqual([]);
		expect(search(all, '   ')).toEqual([]);
	});
	it('matches built-ins by name for hide and show', () => {
		expect(matchBuiltIn('16Personalities').map((t) => t.id)).toEqual(['16personalities']);
		expect(matchBuiltIn('nothing like this')).toEqual([]);
	});
});

describe('cleanUrl', () => {
	it('accepts a public https link', () => {
		expect(cleanUrl('https://example.com/quiz')).toBe('https://example.com/quiz');
	});
	it.each([
		'http://example.com',
		'javascript:alert(1)',
		'https://user:pw@example.com',
		'https://localhost/x',
		'https://127.0.0.1/x',
		'https://[::1]/x',
		'https://intranet/x',
		'https://a.local/x',
		'https://example.com/with space',
		'',
		'not a url',
	])('refuses %s', (u) => expect(cleanUrl(u)).toBeNull());
});

describe('/personality (everyone)', () => {
	it('is off until the server turns it on', async () => {
		enabled.on = false;
		expect(text(await handlePersonalityCommand(body('list'), db))).toMatch(/not turned on/);
	});

	it('lists every test by default, grouped, with a disclaimer', async () => {
		const e = embed(await handlePersonalityCommand(body('list'), db));
		expect(e.fields.map((f: any) => f.name)).toEqual(
			CATEGORIES.map((c) => expect.stringContaining(c.label))
		);
		const all = e.fields.map((f: any) => f.value).join('\n');
		expect(all).toContain('https://bdsmtest.org/');
		expect(all).toContain('🔞');
		expect(e.footer.text).toMatch(/not a diagnosis/);
	});

	it('fits Discord limits with every test and a full set of own links', async () => {
		for (let i = 0; i < 50; i++) {
			await admin('add', [
				opt('name', `Own test number ${i}`),
				opt('link', `https://example.com/q${i}`),
			]);
		}
		const e = embed(await handlePersonalityCommand(body('list'), db));
		const size =
			e.title.length +
			e.description.length +
			e.footer.text.length +
			e.fields.reduce((n: number, f: any) => n + f.name.length + f.value.length, 0);
		expect(size).toBeLessThanOrEqual(6000);
		expect(e.fields.length).toBeLessThanOrEqual(25);
		for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
	});

	it('shows one category with notes', async () => {
		const e = embed(
			await handlePersonalityCommand(body('list', [opt('category', 'neuro')]), db)
		);
		expect(e.title).toContain('Autism');
		expect(e.description).toContain('RAADS-R');
		expect(e.description).not.toContain('16Personalities');
	});

	it('finds a test, and says so when nothing matches', async () => {
		const found = embed(
			await handlePersonalityCommand(body('find', [opt('search', 'enneagram')]), db)
		);
		expect(found.description).toContain('Enneagram');
		expect(
			text(await handlePersonalityCommand(body('find', [opt('search', 'qqqzzz')]), db))
		).toMatch(/Nothing matches/);
	});

	it('finds sociopath, takes the search text under any option name, and asks when it is empty', async () => {
		const dark = embed(
			await handlePersonalityCommand(body('find', [opt('search', 'sociopath')]), db)
		);
		expect(dark.description).toContain('Dark Triad');
		const renamed = embed(
			await handlePersonalityCommand(body('find', [opt('query', 'enneagram')]), db)
		);
		expect(renamed.description).toContain('Enneagram');
		expect(text(await handlePersonalityCommand(body('find', []), db))).toMatch(/Type a name/);
	});

	it('never pings anyone', async () => {
		const r: any = await handlePersonalityCommand(body('list'), db);
		expect(r.data.allowed_mentions).toEqual({ parse: [] });
	});
});

describe('/personality (Manage Server)', () => {
	it('refuses everyone else', async () => {
		for (const sub of ['hide', 'show', 'reset', 'add', 'remove', 'manage']) {
			expect(text(await handlePersonalityCommand(body(sub), db))).toMatch(/Manage Server/);
		}
	});

	it('hides a test, which then disappears from list and find, and shows it again', async () => {
		expect(text(await admin('hide', [opt('test', 'BDSM Test')]))).toMatch(/Hidden/);
		const list = embed(await handlePersonalityCommand(body('list'), db));
		expect(list.fields.map((f: any) => f.value).join('\n')).not.toContain('bdsmtest.org');
		expect(
			text(await handlePersonalityCommand(body('find', [opt('search', 'bdsm')]), db))
		).toMatch(/Nothing matches/);
		await admin('show', [opt('test', 'BDSM Test')]);
		const again = embed(await handlePersonalityCommand(body('list'), db));
		expect(again.fields.map((f: any) => f.value).join('\n')).toContain('bdsmtest.org');
	});

	it('keeps one server’s choices from another', async () => {
		await admin('hide', [opt('test', 'BDSM Test')]);
		const other = embed(await handlePersonalityCommand(body('list', [], '0', 'g2'), db));
		expect(other.fields.map((f: any) => f.value).join('\n')).toContain('bdsmtest.org');
	});

	it('asks for the full name when a hide is ambiguous', async () => {
		expect(text(await admin('hide', [opt('test', 'big five')]))).toMatch(/More than one/);
	});

	it('reset shows everything again and leaves own links', async () => {
		await admin('add', [opt('name', 'Mine'), opt('link', 'https://example.com/mine')]);
		await admin('hide', [opt('test', 'BDSM Test')]);
		await admin('reset');
		const m = text(await admin('manage'));
		expect(m).toContain('Nothing is hidden');
		expect(m).toContain('Mine');
	});

	it('adds an own link into a category and removes it by number, only on its own server', async () => {
		const added = text(
			await admin('add', [
				opt('name', 'Our **quiz**'),
				opt('link', 'https://example.com/ours'),
				opt('category', 'fun'),
				opt('note', 'Made by us'),
			])
		);
		expect(added).toMatch(/Added #1/);
		const fun = embed(
			await handlePersonalityCommand(body('list', [opt('category', 'fun')]), db)
		);
		expect(fun.description).toContain('[Our quiz](https://example.com/ours)');
		expect(fun.description).toContain('Made by us');

		expect(text(await admin('remove', [opt('number', 1)], 'g2'))).toMatch(/no link #1/);
		expect(text(await admin('remove', [opt('number', 1)]))).toMatch(/Removed #1/);
	});

	it('refuses a bad link, a repeat and the 51st', async () => {
		expect(
			text(await admin('add', [opt('name', 'x'), opt('link', 'http://example.com')]))
		).toMatch(/will not do/);
		await admin('add', [opt('name', 'a'), opt('link', 'https://example.com/a')]);
		expect(
			text(await admin('add', [opt('name', 'b'), opt('link', 'https://example.com/a')]))
		).toMatch(/already/);
		for (let i = 0; i < 49; i++)
			await admin('add', [opt('name', `n${i}`), opt('link', `https://example.com/z${i}`)]);
		expect(
			text(await admin('add', [opt('name', 'last'), opt('link', 'https://example.com/last')]))
		).toMatch(/can keep 50/);
	});

	it('says when every test is hidden', async () => {
		for (const t of TESTS) await admin('hide', [opt('test', t.name)]);
		const e = embed(await handlePersonalityCommand(body('list'), db));
		expect(e.description).toMatch(/not showing any tests/);
	});
});

describe('listEmbed', () => {
	it('is the empty notice with nothing to show', () => {
		expect(listEmbed([]).description).toMatch(/not showing any/);
	});
});

describe('the migration', () => {
	const sql = readFileSync('migrations/0102_personality_command.sql', 'utf8');
	it('ships the command off, with valid options and both tables', () => {
		expect(sql).toMatch(/'personality', '[^']+', 0, 1/);
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS personality_hidden');
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS personality_custom');
		const json = sql.match(/'(\[\{"name":"list".*?\}\])',\n\s+0, 0,/s)![1].replace(/''/g, "'");
		const options = JSON.parse(json);
		expect(options.map((o: any) => o.name)).toEqual([
			'list',
			'find',
			'hide',
			'show',
			'reset',
			'add',
			'remove',
			'manage',
		]);
		const cats = options[0].options[0].choices.map((c: any) => c.value);
		expect(cats).toEqual(CATEGORIES.map((c) => c.id));
	});
});
