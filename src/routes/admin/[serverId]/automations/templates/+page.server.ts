import { fail, redirect } from '@sveltejs/kit';
import { createAutomation } from '$lib/db/automations.js';
import {
	AUTOMATION_TEMPLATES,
	TEMPLATE_CATEGORIES,
	getTemplate,
	templateToAutomation,
} from '$lib/automation/templates.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) throw redirect(302, '/admin');
	const parentData = await parent();
	if (
		!parentData.adminGuilds?.some((g) => g.id === params.serverId) &&
		!parentData.isSuperAdmin
	) {
		throw redirect(302, '/admin');
	}
	return { templates: AUTOMATION_TEMPLATES, categories: TEMPLATE_CATEGORIES };
}

/** @type {import('./$types').Actions} */
export const actions = {
	/** Create the chosen template as a switched-off automation and open it to finish setting up. */
	use: async ({ request, cookies, platform, params }) => {
		const db = (platform as any)?.env?.DB;
		if (!db) return fail(500, { error: 'Database not available' });
		const userId = cookies.get('discord_user_id');
		if (!userId) return fail(401, { error: 'Sign in again.' });

		const form = await request.formData();
		const template = getTemplate(form.get('template'));
		if (!template) return fail(400, { error: 'That template does not exist.' });

		const result = await createAutomation(
			db,
			templateToAutomation(template, params.serverId, userId)
		);
		if (!result.success) return fail(500, { error: result.error });
		throw redirect(
			303,
			`/admin/${params.serverId}/automations/${result.publicId || result.id}?from_template=true`
		);
	},
};
