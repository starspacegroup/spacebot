import { redirect } from "@sveltejs/kit";
import { getUser } from "$lib/db/users.js";
import { getServerPlan, PLAN_TIERS } from "$lib/db/server-plans.js";
import { getBillingHistory } from "$lib/db/billing-history.js";
import { getRunnerTokens, getRunnerInstances, getRunnerEvents } from "$lib/db/local-runners.js";
import { listUserWorkflows } from "$lib/db/workflows.js";
import { listAIJobsForUser } from "$lib/db/ai-orchestration.js";

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
  const aiJobs = db ? await listAIJobsForUser(db, userId, { limit: 100 }) : [];

  const aiJobSummary = (() => {
    const summary = {
      total: aiJobs.length,
      pending: 0,
      running: 0,
      completed: 0,
      failed_terminal: 0,
      canceled: 0,
      latest: null,
    };

    for (const job of aiJobs) {
      if (Object.prototype.hasOwnProperty.call(summary, job.status)) {
        summary[job.status] += 1;
      }
    }

    if (aiJobs.length > 0) {
      const latest = aiJobs[0];
      summary.latest = {
        id: latest.id,
        correlationId: latest.correlation_id,
        status: latest.status,
        requestText: latest.request_text,
        attemptCount: latest.attempt_count,
        maxAttempts: latest.max_attempts,
        updatedAt: latest.updated_at,
      };
    }

    return summary;
  })();

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
    runnerUiPrefs: dbUser?.preferences_json ? (() => {
      try {
        const parsed = JSON.parse(dbUser.preferences_json);
        return parsed?.runnerUi && typeof parsed.runnerUi === "object" ? parsed.runnerUi : {};
      } catch {
        return {};
      }
    })() : {},
    serverPlans,
    planTiers: PLAN_TIERS,
    runnerTokens: db ? await getRunnerTokens(db, userId) : [],
    runnerInstances: db ? await getRunnerInstances(db, userId, { limit: 100 }) : [],
    runnerEvents: db ? await getRunnerEvents(db, userId, { limit: 50 }) : [],
    workflows: db ? await listUserWorkflows(db, userId, { limit: 100 }) : [],
    aiJobSummary,
  };
}
