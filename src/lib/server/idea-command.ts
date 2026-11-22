/**
 * /idea: a built-in command anyone can use to tell us how to make SpaceBot better.
 *
 * Saves the idea with who sent it, when, and the server they were in, then answers at once with
 * a private "Saved". The AI draft runs afterwards through `schedule` (waitUntil), so a slow model
 * never delays or fails the reply. Mentions in the reply are off.
 */

import { callAI, isAIEnabled } from '../ai/chat.js';
import { getCommandByName } from '../db/commands.js';
import { getIdea, saveExists } from '../db/ideas.js';
import { log } from '../log.js';
import type { Feature } from './feature-catalog.js';
import { scoreIdea } from './idea-ai.js';
import { describeFeature, findExisting } from './idea-exists.js';
import { submitIdea } from './idea-intake.js';

type Db = any;

const RESPOND_MESSAGE = 4;
const RESPOND_DEFERRED = 5;
const EPHEMERAL = 64;
export const IDEAS_URL = 'https://spacebot.starspace.group/ideas';

const say = (content: string) => ({
	type: RESPOND_MESSAGE,
	data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

function option(body: any, name: string): string | undefined {
	const found = (body.data?.options ?? []).find((o: any) => o.name === name);
	return found?.value === undefined ? undefined : String(found.value);
}

export async function handleIdeaCommand(
	body: any,
	db: Db,
	env: any,
	schedule: (work: Promise<unknown>) => void,
	deps: IdeaDeps = {}
) {
	if (!db) return say('Ideas cannot be saved right now. Try again in a moment.');
	const guildId: string | null = body.guild_id ?? null;
	// A server owner can switch it off from the Commands page.
	if (guildId && !(await getCommandByName(db, 'idea', guildId))) {
		return say('/idea is not turned on in this server.');
	}
	const user = body.member?.user ?? body.user;
	const result = await submitIdea(db, {
		source: 'command',
		userId: user?.id,
		userName: user?.global_name || user?.username || null,
		guildId,
		input: {
			body: option(body, 'text'),
			title: option(body, 'title'),
			area: option(body, 'area'),
		},
	});
	if (!result.ok) return say((result as { message: string }).message);
	const id = (result as { id: number }).id;
	const saved = `Saved. Thanks for the idea. We keep your Discord name and ID, this server and the time, so we can follow up. See your ideas and what became of them at ${IDEAS_URL}`;
	if (result.copy) return say(saved);

	// Checking whether it already exists takes a model call, so when that is possible the
	// reply is deferred (still private) and edited when the answer is in. Without AI, or
	// without a way to edit the reply, it is the plain "Saved" at once.
	const canCheck = Boolean(deps.call) || isAIEnabled(env || {});
	if (!canCheck || !body.application_id || !body.token) {
		schedule(scoreIdea(db, env, id, deps.call));
		return say(saved);
	}
	schedule(finishReply(db, env, id, body.application_id, body.token, saved, deps));
	return { type: RESPOND_DEFERRED, data: { flags: EPHEMERAL } };
}

/** For tests: swap the model and the way the reply is edited. */
export interface IdeaDeps {
	call?: (messages: Array<{ role: string; content: string }>, env: any) => Promise<string>;
	edit?: (applicationId: string, token: string, content: string) => Promise<void>;
}

export function existsMessage(f: Feature): string {
	return [
		'Saved, but this may already exist in SpaceBot:',
		`**${describeFeature(f)}**`,
		f.url ? `More: ${f.url}` : '',
		`If you meant something it does not do, your idea is saved and we will read it. ${IDEAS_URL}`,
	]
		.filter(Boolean)
		.join('\n');
}

async function editReply(applicationId: string, token: string, content: string) {
	const res = await fetch(
		`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
		{
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
		}
	);
	if (!res.ok) throw new Error(`edit ${res.status}`);
}

/**
 * Answer the deferred reply, then draft the scores. The reply is always edited, whatever
 * happens in the check, or the sender would be left looking at "thinking...".
 */
async function finishReply(
	db: Db,
	env: any,
	id: number,
	applicationId: string,
	token: string,
	saved: string,
	deps: IdeaDeps
) {
	let content = saved;
	try {
		const idea = await getIdea(db, id);
		const found = idea ? await findExisting(db, env, idea, deps.call ?? (callAI as any)) : null;
		if (found) {
			await saveExists(db, id, describeFeature(found));
			content = existsMessage(found);
		}
	} catch (err: any) {
		log.warn(`[Ideas] The reply check failed for idea ${id}: ${err?.message ?? err}`);
	}
	try {
		await (deps.edit ?? editReply)(applicationId, token, content);
	} catch (err: any) {
		log.warn(`[Ideas] Could not edit the reply for idea ${id}: ${err?.message ?? err}`);
	}
	await scoreIdea(db, env, id, deps.call ?? (callAI as any));
}
