import { fail } from '@sveltejs/kit';
import { ideasBy } from '$lib/db/ideas.js';
import { scoreIdea } from '$lib/server/idea-ai.js';
import { submitIdea } from '$lib/server/idea-intake.js';

/** The form, and the signed-in person's own ideas with their status. */
export async function load({ cookies, platform }) {
	const userId = cookies.get('discord_user_id');
	const db = (platform as any)?.env?.DB;
	return {
		signedIn: Boolean(userId),
		userName: cookies.get('discord_username') ?? null,
		mine: userId && db ? await ideasBy(db, userId) : [],
	};
}

export const actions = {
	default: async ({ request, cookies, platform }) => {
		const form = await request.formData();
		const values = {
			body: String(form.get('body') ?? ''),
			title: String(form.get('title') ?? ''),
			area: String(form.get('area') ?? 'other'),
		};
		const env = (platform as any)?.env ?? {};
		const result = await submitIdea(env.DB, {
			source: 'web',
			userId: cookies.get('discord_user_id'),
			userName: cookies.get('discord_username') ?? null,
			guildId: null,
			input: values,
		});
		if (!result.ok) {
			const refused = result as { reason: string; message: string };
			return fail(refused.reason === 'rate' ? 429 : 400, {
				error: refused.message,
				values,
			});
		}
		if (!result.copy) {
			// After the reply: a slow or failing model never delays or loses the idea.
			const work = scoreIdea(env.DB, env, result.id);
			(platform as any)?.context?.waitUntil?.(work);
		}
		return { saved: true };
	},
};
