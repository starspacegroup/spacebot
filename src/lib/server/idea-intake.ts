/**
 * Taking an idea in, from the /ideas page or the /idea command: who may send, how often, and
 * what counts as a copy. Both doors call `submitIdea`, so the rules are in one place.
 */

import { consumeQuota } from './rate-limit.js';
import { IDEA_LIMITS, validateIdea, type CleanIdea, type IdeaInput } from './idea-scoring.js';
import { findRecentCopy, insertIdea, isBanned } from '../db/ideas.js';

type Db = any;

export type SubmitResult =
	| { ok: true; id: number; copy: boolean }
	| { ok: false; reason: 'invalid' | 'banned' | 'rate' | 'unavailable'; message: string };

const DAY_MS = 86_400_000;

export async function submitIdea(
	db: Db,
	args: {
		source: 'web' | 'command';
		userId: string | null | undefined;
		userName: string | null;
		guildId: string | null;
		input: IdeaInput;
		now?: Date;
	}
): Promise<SubmitResult> {
	if (!db) {
		return { ok: false, reason: 'unavailable', message: 'Ideas cannot be saved right now.' };
	}
	// Signed-in senders only: that is how we know who sent each one.
	if (!args.userId) {
		return { ok: false, reason: 'invalid', message: 'Sign in with Discord to send an idea.' };
	}
	const checked = validateIdea(args.input);
	if (!checked.ok)
		return { ok: false, reason: 'invalid', message: (checked as { error: string }).error };

	if (await isBanned(db, args.userId)) {
		return { ok: false, reason: 'banned', message: 'Ideas are closed for this account.' };
	}
	const now = args.now ?? new Date();
	// The same text from the same person within a day is saved once, and the sender is told
	// "saved" either way.
	const copy = await findRecentCopy(
		db,
		args.userId,
		(checked as { idea: CleanIdea }).idea.body,
		new Date(now.getTime() - DAY_MS).toISOString()
	);
	if (copy) return { ok: true, id: copy, copy: true };

	for (const limit of IDEA_LIMITS) {
		if (!(await consumeQuota(db, 'idea', args.userId, limit))) {
			return {
				ok: false,
				reason: 'rate',
				message:
					limit.windowSeconds <= 60
						? 'Easy, one idea a minute. Try again shortly.'
						: 'That is ten ideas today. Come back tomorrow.',
			};
		}
	}
	const id = await insertIdea(db, {
		source: args.source,
		userId: args.userId,
		userName: args.userName,
		guildId: args.guildId,
		idea: (checked as { idea: CleanIdea }).idea,
		now: now.toISOString(),
	});
	return { ok: true, id, copy: false };
}
