/**
 * Superadmin Single Server API
 *
 * GET    /api/superadmin/servers/[guildId] - Get server details + plan
 * PATCH  /api/superadmin/servers/[guildId] - Update server plan
 * DELETE /api/superadmin/servers/[guildId] - Delete server plan (reset to free)
 *
 * Superadmin access only.
 */

import { json } from '@sveltejs/kit';
import {
	getServerPlan,
	upsertServerPlan,
	deleteServerPlan,
	PLAN_TIERS,
} from '$lib/db/server-plans.js';
import { getGuildMetadata } from '$lib/db/guild-metadata.js';
import { addBillingEvent, BILLING_EVENT_TYPES } from '$lib/db/billing-history.js';
import { getUser } from '$lib/db/users.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const [metadata, plan] = await Promise.all([
		getGuildMetadata(db, params.guildId),
		getServerPlan(db, params.guildId),
	]);

	return json({ server: metadata, plan });
}

/** @type {import('./$types').RequestHandler} */
export async function PATCH({ cookies, platform, params, request }) {
	const userId = cookies.get('discord_user_id');
	const actorAvatar = cookies.get('discord_avatar') || null;
	const actorDiscriminator = cookies.get('discord_discriminator') || '0';
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = await request.json();

	// Get the current plan before the change for audit trail
	const planBefore = await getServerPlan(db, params.guildId);
	const result = await upsertServerPlan(db, params.guildId, body);

	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	const plan = await getServerPlan(db, params.guildId);

	// Log admin plan change to billing history
	const adminUser = await getUser(db, userId).catch(() => null);
	const changes = [];
	if (planBefore.plan !== plan.plan) changes.push(`plan: ${planBefore.plan} → ${plan.plan}`);
	if (planBefore.price_cents !== plan.price_cents)
		changes.push(
			`price: $${((planBefore.price_cents || 0) / 100).toFixed(2)} → $${((plan.price_cents || 0) / 100).toFixed(2)}`
		);
	if (planBefore.max_commands !== plan.max_commands)
		changes.push(
			`commands limit: ${planBefore.max_commands ?? '∞'} → ${plan.max_commands ?? '∞'}`
		);
	if (planBefore.max_automations !== plan.max_automations)
		changes.push(
			`automations limit: ${planBefore.max_automations ?? '∞'} → ${plan.max_automations ?? '∞'}`
		);
	if (planBefore.expires_at !== plan.expires_at)
		changes.push(`expiry: ${planBefore.expires_at || 'none'} → ${plan.expires_at || 'none'}`);

	const description =
		planBefore.plan !== plan.plan
			? `Plan changed from ${planBefore.plan} to ${plan.plan} by admin`
			: `Plan settings updated by admin`;

	await addBillingEvent(db, {
		guild_id: params.guildId,
		event_type:
			planBefore.plan !== plan.plan
				? PLAN_TIERS[plan.plan]?.price_cents >
					(PLAN_TIERS[planBefore.plan]?.price_cents || 0)
					? BILLING_EVENT_TYPES.PLAN_UPGRADE
					: BILLING_EVENT_TYPES.PLAN_DOWNGRADE
				: BILLING_EVENT_TYPES.ADMIN_EDIT,
		description,
		details: { changes, plan_before: planBefore, plan_after: plan },
		actor_id: userId,
		actor_name: adminUser?.global_name || adminUser?.username || userId,
		actor_avatar: actorAvatar,
		actor_discriminator: actorDiscriminator,
		plan_before: planBefore.plan,
		plan_after: plan.plan,
		amount_cents: plan.price_cents,
	});

	return json({ success: true, plan });
}

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ cookies, platform, params }) {
	const userId = cookies.get('discord_user_id');
	const actorAvatar = cookies.get('discord_avatar') || null;
	const actorDiscriminator = cookies.get('discord_discriminator') || '0';
	if (!checkIsSuperAdmin(userId, platform)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });

	// Get current plan before deletion for audit trail
	const planBefore = await getServerPlan(db, params.guildId);

	const result = await deleteServerPlan(db, params.guildId);
	if (!result.success) {
		return json({ error: result.error }, { status: 500 });
	}

	// Log the plan reset
	const adminUser = await getUser(db, userId).catch(() => null);
	await addBillingEvent(db, {
		guild_id: params.guildId,
		event_type: BILLING_EVENT_TYPES.PLAN_RESET,
		description: `Plan reset to free by admin`,
		details: { plan_before: planBefore },
		actor_id: userId,
		actor_name: adminUser?.global_name || adminUser?.username || userId,
		actor_avatar: actorAvatar,
		actor_discriminator: actorDiscriminator,
		plan_before: planBefore.plan,
		plan_after: 'free',
	});

	return json({ success: true });
}
