import { fail } from '@sveltejs/kit';
import { getIdea, ideasBy, saveExists } from '$lib/db/ideas.js';
import { describeFeature, findExisting } from '$lib/server/idea-exists.js';
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
		if (result.copy) return { saved: true };
		// Ask whether SpaceBot already does this, for a few seconds at most, so the sender
		// hears it on this page. Whatever happens, the idea is already saved.
		let exists: { text: string; url: string | null } | null = null;
		const idea = await getIdea(env.DB, result.id);
		const found = idea ? await findExisting(env.DB, env, idea, undefined, 8000) : null;
		if (found) {
			await saveExists(env.DB, result.id, describeFeature(found));
			exists = { text: describeFeature(found), url: found.url };
		}
		// After the reply: a slow or failing model never delays or loses the idea.
		(platform as any)?.context?.waitUntil?.(scoreIdea(env.DB, env, result.id));
		return { saved: true, exists };
	},
};
