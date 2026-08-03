import { redirect } from '@sveltejs/kit';
import { log } from '$lib/db/logger.js';
import { getServerPlan, PLAN_TIERS } from '$lib/db/server-plans.js';
import { getBillingHistory } from '$lib/db/billing-history.js';
import { hasFullAdminPermission } from '$lib/discord/guilds.js';
import { getSubscription } from '$lib/stripe.js';
import { checkIsSuperAdmin } from '$lib/server/superadmin-guard.js';

/**
 * Safely get environment variable, works in both Node.js and Cloudflare Workers
 */
function getEnv(name, platform) {
	return (
		platform?.env?.[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
	);
}

/** Default usage counts */
const DEFAULT_USAGE = {
	commands: 0,
	commandsActive: 0,
	commandsInactive: 0,
	automations: 0,
	automationsActive: 0,
	automationsInactive: 0,
	apiKeys: 0,
	apiKeysActive: 0,
	apiKeysRevoked: 0,
	webhooks: 0,
	webhooksActive: 0,
	webhooksInactive: 0,
};

/**
 * Get usage counts for the guild (commands, automations, API keys, webhooks)
 */
async function getUsageCounts(db, guildId) {
	if (!db || !guildId) return { ...DEFAULT_USAGE };

	try {
		const [commandsResult, automationsResult, apiKeysResult, webhooksResult] =
			await Promise.all([
				db
					.prepare(
						'SELECT COUNT(*) as count, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM commands WHERE guild_id = ?'
					)
					.bind(guildId)
					.first(),
				db
					.prepare(
						'SELECT COUNT(*) as count, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM automations WHERE guild_id = ?'
					)
					.bind(guildId)
					.first(),
				db
					.prepare(
						'SELECT COUNT(*) as count, SUM(CASE WHEN revoked = 0 THEN 1 ELSE 0 END) as active FROM api_keys WHERE guild_id = ?'
					)
					.bind(guildId)
					.first(),
				db
					.prepare(
						'SELECT COUNT(*) as count, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active FROM webhooks WHERE guild_id = ?'
					)
					.bind(guildId)
					.first(),
			]);

		const cmds = commandsResult?.count || 0;
		const cmdsActive = commandsResult?.active || 0;
		const autos = automationsResult?.count || 0;
		const autosActive = automationsResult?.active || 0;
		const keys = apiKeysResult?.count || 0;
		const keysActive = apiKeysResult?.active || 0;
		const hooks = webhooksResult?.count || 0;
		const hooksActive = webhooksResult?.active || 0;

		return {
			commands: cmds,
			commandsActive: cmdsActive,
			commandsInactive: cmds - cmdsActive,
			automations: autos,
			automationsActive: autosActive,
			automationsInactive: autos - autosActive,
			apiKeys: keysActive,
			apiKeysActive: keysActive,
			apiKeysRevoked: keys - keysActive,
			webhooks: hooks,
			webhooksActive: hooksActive,
			webhooksInactive: hooks - hooksActive,
		};
	} catch (error) {
		log.warn('[Account] Failed to fetch usage counts for guild', guildId, error?.message);
		return { ...DEFAULT_USAGE };
	}
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent, params }) {
	if (!/^\d{17,20}$/.test(params.serverId)) {
		throw redirect(302, '/admin');
	}

	const parentData = await parent();
	const userId = cookies.get('discord_user_id');

	if (!userId) {
		throw redirect(302, '/login');
	}

	const serverId = params.serverId;
	const isSuperAdmin = checkIsSuperAdmin(userId, platform);
	const adminGuilds = parentData.adminGuilds || [];

	const hasAccessToServer = isSuperAdmin || adminGuilds.some((g) => g.id === serverId);
	if (!hasAccessToServer) {
		throw redirect(302, '/admin');
	}

	const guild = adminGuilds.find((g) => g.id === serverId);

	// Only administrators can manage billing
	const hasFullAdminAccess = isSuperAdmin || hasFullAdminPermission(guild);
	if (!hasFullAdminAccess) {
		throw redirect(302, `/admin/${serverId}`);
	}

	// Wrap ALL data fetching in try-catch to prevent 500 on production
	try {
		const db = (platform as any)?.env?.DB;
		const plan = db ? await getServerPlan(db, serverId) : { plan: 'free', ...PLAN_TIERS.free };

		// Fetch billing history and usage counts in parallel
		const [billingHistoryResult, usage] = await Promise.all([
			db
				? getBillingHistory(db, serverId, { limit: 50 })
				: Promise.resolve({ events: [], total: 0 }),
			getUsageCounts(db, serverId),
		]);

		const { events: billingHistory, total: billingHistoryTotal } = billingHistoryResult;

		// Check if Stripe is configured
		const stripeConfigured = !!getEnv('STRIPE_SECRET_KEY', platform);

		// Fetch upcoming billing details from Stripe subscription if active
		let nextBillingDate = plan.stripe_current_period_end || null;
		let nextBillingAmount = null;
		let billingInterval = null;

		if (
			plan.stripe_subscription_id &&
			stripeConfigured &&
			['active', 'trialing'].includes(plan.stripe_status)
		) {
			try {
				const sub = await getSubscription(platform, plan.stripe_subscription_id);
				if (sub) {
					nextBillingDate = sub.current_period_end
						? new Date(sub.current_period_end * 1000).toISOString()
						: nextBillingDate;
					const item = sub.items?.data?.[0];
					if (item?.price) {
						nextBillingAmount = item.price.unit_amount || null;
						billingInterval = item.price.recurring?.interval || null;
					}
				}
			} catch (err) {
				log.warn(
					`[Account] Failed to fetch Stripe subscription for guild ${serverId}:`,
					err.message
				);
			}
		}

		return {
			serverId,
			guild,
			plan,
			planTiers: PLAN_TIERS,
			stripeConfigured,
			isSuperAdmin,
			billingHistory,
			billingHistoryTotal,
			nextBillingDate,
			nextBillingAmount,
			billingInterval,
			usage,
		};
	} catch (err) {
		// Catch-all to prevent 500 — log the actual error for diagnosis
		log.error(
			`[Account] Unhandled error loading account page for guild ${serverId}:`,
			err?.message,
			err?.stack
		);
		return {
			serverId,
			guild,
			plan: { plan: 'free', ...PLAN_TIERS.free },
			planTiers: PLAN_TIERS,
			stripeConfigured: false,
			isSuperAdmin,
			billingHistory: [],
			billingHistoryTotal: 0,
			nextBillingDate: null,
			nextBillingAmount: null,
			billingInterval: null,
			usage: { ...DEFAULT_USAGE },
			loadError: err?.message || 'Failed to load account data',
		};
	}
}
