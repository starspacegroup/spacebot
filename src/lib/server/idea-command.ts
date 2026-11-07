/**
 * /idea: a built-in command anyone can use to tell us how to make SpaceBot better.
 *
 * Saves the idea with who sent it, when, and the server they were in, then answers at once with
 * a private "Saved". The AI draft runs afterwards through `schedule` (waitUntil), so a slow model
 * never delays or fails the reply. Mentions in the reply are off.
 */

import { getCommandByName } from '../db/commands.js';
import { scoreIdea } from './idea-ai.js';
import { submitIdea } from './idea-intake.js';

type Db = any;

const RESPOND_MESSAGE = 4;
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
	schedule: (work: Promise<unknown>) => void
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
	if (!result.copy) schedule(scoreIdea(db, env, result.id));
	return say(
		`Saved. Thanks for the idea. We keep your Discord name and ID, this server and the time, so we can follow up. See your ideas and what became of them at ${IDEAS_URL}`
	);
}
