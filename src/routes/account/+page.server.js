import { redirect } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getUser } from "$lib/db/users.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";
import { getBillingHistory } from "$lib/db/billing-history.js";
import { getRunnerTokens, getRunnerJobs, getRunnerInstances, getRunnerEvents } from "$lib/db/local-runners.js";

/** @type {import('./$types').PageServerLoad} */
export async function load({ cookies, platform, parent }) {
  const parentData = await parent();
  const userId = cookies.get("discord_user_id");

  if (!userId) {
    throw redirect(302, "/login");
  }

  const db = platform?.env?.DB;

  // Fetch user record from DB (has login stats, email, etc.)
  const dbUser = db ? await getUser(db, userId) : null;

  // Get all admin guilds the user has access to
  const adminGuilds = parentData.adminGuilds || [];

  // Fetch plans and billing for all servers the user manages
  const serverPlans = [];
  if (db && adminGuilds.length > 0) {
    const planPromises = adminGuilds
      .filter((g) => g.botIsInServer !== false)
      .map(async (guild) => {
        const plan = await getServerPlan(db, guild.id);
        const { events } = await getBillingHistory(db, guild.id, { limit: 20 });
        return {
          guildId: guild.id,
          guildName: guild.name,
          guildIcon: guild.icon,
          plan: plan.plan || "free",
          stripeStatus: plan.stripe_status || null,
          stripeSubscriptionId: plan.stripe_subscription_id || null,
          stripeCustomerId: plan.stripe_customer_id || null,
          stripeCurrentPeriodEnd: plan.stripe_current_period_end || null,
          priceCents: plan.price_cents || 0,
          recentBilling: events || [],
        };
      });

    const results = await Promise.all(planPromises);
    serverPlans.push(...results);
  }

  return {
    dbUser,
    serverPlans,
    planTiers: PLAN_TIERS,
    runnerTokens: db ? await getRunnerTokens(db, userId) : [],
    runnerJobs: db ? await getRunnerJobs(db, userId, null, 25) : [],
    runnerInstances: db ? await getRunnerInstances(db, userId, { limit: 100 }) : [],
    runnerEvents: db ? await getRunnerEvents(db, userId, { limit: 50 }) : [],
  };
}
