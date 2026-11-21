/**
 * /personality: links to free online personality tests, off until a server turns it on.
 *
 *   /personality list [category]     what this server shows
 *   /personality find <search>       a test by name or topic ("autism", "enneagram", "bdsm")
 *   /personality hide|show <test>    (Manage Server) choose which built-in tests appear
 *   /personality reset               (Manage Server) show every built-in test again
 *   /personality add|remove|manage   (Manage Server) the server's own links
 *
 * Every built-in test shows unless a server hides it. The catalog is personality-tests.ts; this
 * file holds what a server chose, and is shared by the slash command and the dashboard.
 */

import { getCommandByName } from '../db/commands.js';
import {
	CATEGORIES,
	MAX_CUSTOM_TESTS,
	SERVER_CATEGORY,
	TESTS,
	TEST_IDS,
	categoryEmbed,
	categoryLabel,
	cleanName,
	cleanNote,
	cleanUrl,
	emptyEmbed,
	findEmbed,
	listEmbed,
	listed,
	matchBuiltIn,
	search,
	type CustomTest,
	type PersonalityTest,
} from './personality-tests.js';

type Db = any;

const RESPOND_MESSAGE = 4;
const EPHEMERAL = 64;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const NO_MENTIONS = { parse: [] as string[] };

const say = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS },
});

const embedReply = (embed: unknown) => ({
	type: RESPOND_MESSAGE,
	data: { embeds: [embed], allowed_mentions: NO_MENTIONS },
});

function mayManage(permissions: unknown): boolean {
	try {
		const bits = BigInt(String(permissions ?? '0'));
		return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_GUILD) === MANAGE_GUILD;
	} catch {
		return false;
	}
}

export type Outcome<T = {}> = { ok: boolean; error?: string } & Partial<T>;

// ---- What a server chose ---------------------------------------------------------------------

export async function getHidden(db: Db, guildId: string): Promise<Set<string>> {
	const { results } = await db
		.prepare(`SELECT test_id FROM personality_hidden WHERE guild_id = ?`)
		.bind(guildId)
		.all();
	// Ids that left the catalog are ignored, so an old row never hides a new test by accident.
	return new Set(
		((results ?? []) as { test_id: string }[])
			.map((r) => r.test_id)
			.filter((id) => TEST_IDS.has(id))
	);
}

/** Replace the hidden set. Only ids in the catalog are stored. */
export async function setHidden(db: Db, guildId: string, userId: string, ids: Iterable<string>) {
	const wanted = [...new Set([...ids].filter((id) => TEST_IDS.has(id)))];
	const statements = [
		db.prepare(`DELETE FROM personality_hidden WHERE guild_id = ?`).bind(guildId),
		...wanted.map((id) =>
			db
				.prepare(
					`INSERT INTO personality_hidden (guild_id, test_id, hidden_by) VALUES (?, ?, ?)`
				)
				.bind(guildId, id, userId || null)
		),
	];
	await db.batch(statements);
	return wanted.length;
}

export async function listCustom(db: Db, guildId: string): Promise<CustomTest[]> {
	const { results } = await db
		.prepare(
			`SELECT id, name, url, category, note FROM personality_custom WHERE guild_id = ? ORDER BY id LIMIT ?`
		)
		.bind(guildId, MAX_CUSTOM_TESTS)
		.all();
	return results ?? [];
}

const validCategory = (c: unknown) =>
	typeof c === 'string' && CATEGORIES.some((x) => x.id === c) ? c : 'hubs';

/** Add one of a server's own links. Shared by the slash command and the dashboard. */
export async function addCustom(
	db: Db,
	guildId: string,
	userId: string,
	input: { name: unknown; url: unknown; category?: unknown; note?: unknown }
): Promise<Outcome<{ id: number; name: string; count: number }>> {
	const name = cleanName(input.name);
	if (!name) return { ok: false, error: 'Give the test a name.' };
	const url = cleanUrl(input.url);
	if (!url) {
		return {
			ok: false,
			error: 'That link will not do. Use a full https:// link to a public website.',
		};
	}
	const have = await listCustom(db, guildId);
	if (have.length >= MAX_CUSTOM_TESTS) {
		return {
			ok: false,
			error: `A server can keep ${MAX_CUSTOM_TESTS} links. Remove one first.`,
		};
	}
	if (have.some((c) => c.url === url))
		return { ok: false, error: 'That link is already on your list.' };
	const added: any = await db
		.prepare(
			`INSERT INTO personality_custom (guild_id, name, url, category, note, added_by) VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			guildId,
			name,
			url,
			validCategory(input.category),
			cleanNote(input.note) || null,
			userId || null
		)
		.run();
	return { ok: true, id: Number(added?.meta?.last_row_id), name, count: have.length + 1 };
}

/** Remove one of a server's own links. Never touches another server's. */
export async function removeCustom(db: Db, guildId: string, id: number): Promise<boolean> {
	const gone: any = await db
		.prepare(`DELETE FROM personality_custom WHERE id = ? AND guild_id = ?`)
		.bind(id, guildId)
		.run();
	return Boolean(gone?.meta?.changes);
}

// ---- The slash command ------------------------------------------------------------------------

function pick(
	matches: PersonalityTest[],
	query: string
): { one?: PersonalityTest; reply?: unknown } {
	if (matches.length === 0) {
		return {
			reply: say(
				`No built-in test matches “${cleanName(query)}”. Try \`/personality manage\`.`
			),
		};
	}
	if (matches.length > 1 && matches[0].name.toLowerCase() !== cleanName(query).toLowerCase()) {
		const names = matches
			.slice(0, 5)
			.map((t) => `• ${t.name}`)
			.join('\n');
		return {
			reply: say(
				`More than one test matches. Use the full name:\n${names}${matches.length > 5 ? '\n…' : ''}`
			),
		};
	}
	return { one: matches[0] };
}

async function manage(
	name: string,
	opts: Map<string, any>,
	ctx: { db: Db; guildId: string; userId: string }
) {
	const { db, guildId, userId } = ctx;
	if (name === 'hide' || name === 'show') {
		const { one, reply } = pick(
			matchBuiltIn(String(opts.get('test') ?? '')),
			String(opts.get('test') ?? '')
		);
		if (!one) return reply;
		const hidden = await getHidden(db, guildId);
		if (name === 'hide') hidden.add(one.id);
		else hidden.delete(one.id);
		await setHidden(db, guildId, userId, hidden);
		return say(
			name === 'hide' ? `Hidden: **${one.name}**.` : `Showing again: **${one.name}**.`
		);
	}
	if (name === 'reset') {
		await setHidden(db, guildId, userId, []);
		return say('Every built-in test is showing again. Your own links were not touched.');
	}
	if (name === 'add') {
		const r = await addCustom(db, guildId, userId, {
			name: opts.get('name'),
			url: opts.get('link'),
			category: opts.get('category'),
			note: opts.get('note'),
		});
		return say(r.ok ? `Added #${r.id}: **${r.name}**. You have ${r.count}.` : (r.error ?? ''));
	}
	if (name === 'remove') {
		const id = Number(opts.get('number'));
		return say(
			(await removeCustom(db, guildId, id))
				? `Removed #${id}.`
				: `There is no link #${id} on your list.`
		);
	}
	// manage
	const [hidden, custom] = await Promise.all([getHidden(db, guildId), listCustom(db, guildId)]);
	const hiddenNames = TESTS.filter((t) => hidden.has(t.id)).map((t) => t.name);
	const lines = [
		`Showing **${TESTS.length - hiddenNames.length} of ${TESTS.length}** built-in tests.`,
		hiddenNames.length ? `Hidden: ${hiddenNames.join(', ')}` : 'Nothing is hidden.',
		custom.length
			? `Your links:\n${custom.map((c) => `#${c.id} ${c.name} (${categoryLabel(c.category)})`).join('\n')}`
			: 'You have no links of your own. Add one with `/personality add`.',
	];
	return say(lines.join('\n').slice(0, 1900));
}

export async function handlePersonalityCommand(body: any, db: Db) {
	const guildId: string | undefined = body.guild_id;
	const userId: string | undefined = body.member?.user?.id;
	if (!guildId || !userId) return say('/personality only works inside a server.');
	if (!db) return say('The database is not available right now.');
	// Discord only lists the command where it is on; this is the same check at the point of use.
	if (!(await getCommandByName(db, 'personality', guildId))) {
		return say('/personality is not turned on in this server.');
	}

	const sub = (body.data?.options ?? [])[0];
	const opts = new Map<string, any>((sub?.options ?? []).map((o: any) => [o.name, o.value]));

	if (['hide', 'show', 'reset', 'add', 'remove', 'manage'].includes(sub?.name)) {
		if (!mayManage(body.member?.permissions)) {
			return say('Only people with Manage Server can change /personality.');
		}
		return manage(sub.name, opts, { db, guildId, userId });
	}

	const [hidden, custom] = await Promise.all([getHidden(db, guildId), listCustom(db, guildId)]);
	const items = listed(hidden, custom);
	if (items.length === 0) return embedReply(emptyEmbed());

	if (sub?.name === 'find') {
		// The first option is the search text even if Discord names it differently.
		const query = String(opts.get('search') ?? (sub?.options ?? [])[0]?.value ?? '').trim();
		if (!query) return say('Type a name or topic to look for, like `autism` or `enneagram`.');
		const results = search(items, query);
		if (results.length === 0) {
			return say(
				`Nothing matches “${cleanName(query)}”. Try \`/personality list\` to see everything.`
			);
		}
		return embedReply(findEmbed(query, results));
	}

	const category = opts.get('category');
	if (
		typeof category === 'string' &&
		(CATEGORIES.some((c) => c.id === category) || category === SERVER_CATEGORY)
	) {
		return embedReply(categoryEmbed(category, items));
	}
	return embedReply(listEmbed(items));
}
