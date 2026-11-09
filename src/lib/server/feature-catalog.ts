/**
 * What SpaceBot already does, as a short list the idea check can match an idea against.
 *
 * Two sources, so it does not go stale by hand:
 *  - the "Features & subsystems" list in `docs/index.md` (the docs are updated in the same
 *    change as a feature, so this is the list of record), bundled at build time;
 *  - the built-in commands in the database, which are always the live set.
 * A few lines cover what the docs index does not list as a feature (custom commands,
 * automations, logging, the DM assistant).
 *
 * The idea check only ever points at an entry here, and what the sender is shown is the
 * entry's own text, never words from the model.
 */

import docsIndex from '../../../docs/index.md?raw';

type Db = any;

export interface Feature {
	/** `slug` for a doc, `/name` for a built-in command. */
	id: string;
	name: string;
	summary: string;
	/** A page that explains it, when there is one. */
	url: string | null;
}

const DOCS_URL = 'https://spacebot.starspace.group/docs/dev';

/** Things the dashboard does that no single doc page is about. */
const EXTRAS: Feature[] = [
	{
		id: 'custom-commands',
		name: 'Custom slash commands',
		summary: 'Server admins make their own slash commands in the dashboard.',
		url: null,
	},
	{
		id: 'automations',
		name: 'Automations',
		summary: 'Admins build triggers and actions that run on server events, from the dashboard.',
		url: null,
	},
	{
		id: 'logging',
		name: 'Event logging',
		summary:
			'Server events (joins, leaves, messages, voice) are logged and shown in the dashboard.',
		url: null,
	},
	{
		id: 'assistant',
		name: 'AI assistant',
		summary: 'An AI assistant answers in direct messages.',
		url: null,
	},
];

/** The feature lines of the docs index. A "not implemented" plan is not a feature. */
export function parseDocsIndex(raw: string): Feature[] {
	const start = raw.indexOf('## Features & subsystems');
	if (start < 0) return [];
	const rest = raw.slice(start + 1);
	const end = rest.indexOf('\n## ');
	const section = end < 0 ? rest : rest.slice(0, end);
	const out: Feature[] = [];
	for (const line of section.split('\n')) {
		const m = /^- \[(.+?)\]\(([\w-]+)\.md\)\s+[—-]\s+(.+)$/.exec(line.trim());
		if (!m) continue;
		const summary = m[3].replace(/`/g, '').trim();
		if (/not implemented/i.test(summary)) continue;
		out.push({ id: m[2], name: m[1], summary, url: `${DOCS_URL}/${m[2]}` });
	}
	return out;
}

export async function featureCatalog(db: Db, raw: string = docsIndex): Promise<Feature[]> {
	const features = [...parseDocsIndex(raw), ...EXTRAS];
	try {
		const { results } = await db
			.prepare(
				`SELECT name, description FROM commands WHERE guild_id = '__built_in__' ORDER BY name`
			)
			.all();
		for (const c of (results || []) as any[]) {
			features.push({
				id: `/${c.name}`,
				name: `/${c.name}`,
				summary: String(c.description ?? '').trim() || `The /${c.name} command.`,
				url: null,
			});
		}
	} catch {
		// the docs list alone is still useful
	}
	return features;
}
