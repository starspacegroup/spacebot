import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createSqliteD1 } from './helpers/sqlite-d1';
import { updateCommand } from '../lib/db/commands';
import { hasSubcommands, parseStoredOptions } from '../lib/db/command-options';

const SCHEMA = `CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, name TEXT, description TEXT,
  options TEXT, context_menu_user INTEGER DEFAULT 0, registered INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1, updated_at TEXT);`;

const withSub = JSON.stringify([
	{ name: 'find', type: 1, options: [{ name: 'search', type: 3, required: true }] },
]);
const flat = [{ name: 'find', type: 3, required: false }];

async function setup(guild: string) {
	const db: any = createSqliteD1(SCHEMA);
	await db
		.prepare(
			`INSERT INTO commands (guild_id, name, description, options) VALUES (?, 'x', 'd', ?)`
		)
		.bind(guild, withSub)
		.run();
	return db;
}
const stored = async (db: any) =>
	(await db.prepare(`SELECT options FROM commands WHERE id = 1`).first()).options;

describe('a built-in with subcommands keeps them', () => {
	it('ignores a flat options save on a built-in', async () => {
		const db = await setup('__built_in__');
		const r = await updateCommand(db, 1, { options: flat, description: 'new' });
		expect(r.success).toBe(true);
		expect(await stored(db)).toBe(withSub);
		expect((await db.prepare(`SELECT description d FROM commands`).first()).d).toBe('new');
	});

	it('still lets a built-in change to options that keep subcommands', async () => {
		const db = await setup('__built_in__');
		const next = [{ name: 'go', type: 1 }];
		await updateCommand(db, 1, { options: next });
		expect(JSON.parse(await stored(db))).toEqual(next);
	});

	it('does not interfere with a server command', async () => {
		const db = await setup('123456789012345678');
		await updateCommand(db, 1, { options: flat });
		expect(JSON.parse(await stored(db))).toEqual(flat);
	});

	it('hasSubcommands is true exactly when a type 1 or 2 option is present', () => {
		fc.assert(
			fc.property(fc.array(fc.record({ type: fc.integer({ min: 1, max: 11 }) })), (opts) => {
				return hasSubcommands(opts) === opts.some((o) => o.type === 1 || o.type === 2);
			})
		);
		expect(parseStoredOptions('not json')).toEqual([]);
	});
});

describe('migration 0103', () => {
	const sql = readFileSync('migrations/0103_restore_subcommand_options.sql', 'utf8');
	const literals = [
		...sql.matchAll(
			/options = '(\[.*\])'\s*\nWHERE guild_id = '__built_in__' AND name = '(\w+)'/g
		),
	];

	it('puts back valid options with subcommands for topic and personality', () => {
		expect(literals.map((m) => m[2])).toEqual(['topic', 'personality']);
		for (const m of literals) {
			const parsed = JSON.parse(m[1].replace(/''/g, "'"));
			expect(hasSubcommands(parsed)).toBe(true);
			expect(parsed.every((o: any) => o.type === 1)).toBe(true);
		}
		const personality = JSON.parse(literals[1][1].replace(/''/g, "'"));
		const find = personality.find((o: any) => o.name === 'find');
		expect(find.options[0]).toMatchObject({ name: 'search', type: 3, required: true });
		expect(JSON.stringify(personality)).not.toContain("''");
	});
});
