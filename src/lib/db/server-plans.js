/**
 * Server Plans Database Module
 *
 * Handles CRUD operations for guild subscription plans in the D1 database.
 * Plans define per-guild feature limits (max commands, automations, etc.).
 */

import { log } from "./logger.js";

/**
 * Default plan limits per tier
 */
export const PLAN_TIERS = {
  free: {
    label: "Free",
    max_commands: 3,
    max_automations: 9,
    max_api_keys: 3,
    max_webhooks: 5,
    log_retention_days: 90,
    stats_retention_days: 90,
    price_cents: 0,
  },
  pro: {
    label: "Pro",
    max_commands: null, // unlimited
    max_automations: null,
    max_api_keys: 10,
    max_webhooks: 25,
    log_retention_days: null, // unlimited
    stats_retention_days: null,
    price_cents: 300, // $3/mo
    price_cents_yearly: 3000, // $30/yr (save ~17%)
  },
  enterprise: {
    label: "Enterprise",
    max_commands: null,
    max_automations: null,
    max_api_keys: null,
    max_webhooks: null,
    log_retention_days: null,
    stats_retention_days: null,
    price_cents: 0, // custom pricing
  },
};

/**
 * Get the plan for a guild.
 * Returns the stored plan or default free plan limits.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function getServerPlan(db, guildId) {
  if (!db || !guildId) return { plan: "free", ...PLAN_TIERS.free, guild_id: guildId };

  try {
    const row = await db
      .prepare("SELECT * FROM server_plans WHERE guild_id = ?")
      .bind(guildId)
      .first();

    if (!row) {
      return { plan: "free", ...PLAN_TIERS.free, guild_id: guildId };
    }

    return row;
  } catch (error) {
    log.error("[ServerPlans] Error getting plan for guild:", guildId, error);
    return { plan: "free", ...PLAN_TIERS.free, guild_id: guildId };
  }
}

/**
 * Get plans for all guilds.
 *
 * @param {D1Database} db
 * @returns {Promise<object[]>}
 */
export async function getAllServerPlans(db) {
  if (!db) return [];

  try {
    const result = await db
      .prepare("SELECT * FROM server_plans ORDER BY updated_at DESC")
      .all();

    return result?.results || [];
  } catch (error) {
    log.error("[ServerPlans] Error getting all plans:", error);
    return [];
  }
}

/**
 * Upsert (create or update) a server plan.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {object} planData
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function upsertServerPlan(db, guildId, planData) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  const tier = planData.plan || "free";
  const defaults = PLAN_TIERS[tier] || PLAN_TIERS.free;

  try {
    await db
      .prepare(`
        INSERT INTO server_plans (
          guild_id, plan,
          max_commands, max_automations, max_api_keys, max_webhooks,
          log_retention_days, stats_retention_days,
          price_cents, billing_email, billing_notes,
          started_at, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(guild_id) DO UPDATE SET
          plan = excluded.plan,
          max_commands = excluded.max_commands,
          max_automations = excluded.max_automations,
          max_api_keys = excluded.max_api_keys,
          max_webhooks = excluded.max_webhooks,
          log_retention_days = excluded.log_retention_days,
          stats_retention_days = excluded.stats_retention_days,
          price_cents = excluded.price_cents,
          billing_email = excluded.billing_email,
          billing_notes = excluded.billing_notes,
          started_at = excluded.started_at,
          expires_at = excluded.expires_at,
          updated_at = datetime('now')
      `)
      .bind(
        guildId,
        tier,
        planData.max_commands ?? defaults.max_commands,
        planData.max_automations ?? defaults.max_automations,
        planData.max_api_keys ?? defaults.max_api_keys,
        planData.max_webhooks ?? defaults.max_webhooks,
        planData.log_retention_days ?? defaults.log_retention_days,
        planData.stats_retention_days ?? defaults.stats_retention_days,
        planData.price_cents ?? defaults.price_cents,
        planData.billing_email || null,
        planData.billing_notes || null,
        planData.started_at || new Date().toISOString(),
        planData.expires_at || null,
      )
      .run();

    log.info(`[ServerPlans] Upserted plan for guild ${guildId}: ${tier}`);
    return { success: true };
  } catch (error) {
    log.error("[ServerPlans] Error upserting plan:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Delete a server plan (resets to free).
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteServerPlan(db, guildId) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  try {
    await db
      .prepare("DELETE FROM server_plans WHERE guild_id = ?")
      .bind(guildId)
      .run();

    log.info(`[ServerPlans] Deleted plan for guild ${guildId} (reset to free)`);
    return { success: true };
  } catch (error) {
    log.error("[ServerPlans] Error deleting plan:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Check if a guild is within its plan limit for a given feature.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {'commands' | 'automations' | 'api_keys' | 'webhooks'} feature
 * @param {number} currentCount - current usage count
 * @returns {Promise<{allowed: boolean, limit: number|null, current: number}>}
 */
export async function checkPlanLimit(db, guildId, feature, currentCount) {
  const plan = await getServerPlan(db, guildId);

  const limitKey = `max_${feature}`;
  const limit = plan[limitKey];

  // null = unlimited
  if (limit === null || limit === undefined) {
    return { allowed: true, limit: null, current: currentCount };
  }

  return {
    allowed: currentCount < limit,
    limit,
    current: currentCount,
  };
}

// ─── Stripe-related helpers ─────────────────────────────────────────────────

/**
 * Update Stripe billing fields on a server plan (called from webhook handler).
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {object} stripeData
 * @param {string} [stripeData.stripe_customer_id]
 * @param {string} [stripeData.stripe_subscription_id]
 * @param {string} [stripeData.stripe_status]
 * @param {string} [stripeData.stripe_current_period_end]
 * @param {string} [stripeData.upgraded_by]
 * @param {string} [stripeData.plan] - Plan tier to set (e.g. 'pro')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateStripeBilling(db, guildId, stripeData) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  try {
    // First ensure a row exists
    const existingPlan = await getServerPlan(db, guildId);
    const tier = stripeData.plan || existingPlan.plan || "free";
    const defaults = PLAN_TIERS[tier] || PLAN_TIERS.free;

    await db
      .prepare(`
        INSERT INTO server_plans (
          guild_id, plan,
          max_commands, max_automations, max_api_keys, max_webhooks,
          log_retention_days, stats_retention_days,
          price_cents,
          stripe_customer_id, stripe_subscription_id, stripe_status,
          stripe_current_period_end, upgraded_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(guild_id) DO UPDATE SET
          plan = excluded.plan,
          max_commands = excluded.max_commands,
          max_automations = excluded.max_automations,
          max_api_keys = excluded.max_api_keys,
          max_webhooks = excluded.max_webhooks,
          log_retention_days = excluded.log_retention_days,
          stats_retention_days = excluded.stats_retention_days,
          price_cents = excluded.price_cents,
          stripe_customer_id = COALESCE(excluded.stripe_customer_id, server_plans.stripe_customer_id),
          stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, server_plans.stripe_subscription_id),
          stripe_status = COALESCE(excluded.stripe_status, server_plans.stripe_status),
          stripe_current_period_end = COALESCE(excluded.stripe_current_period_end, server_plans.stripe_current_period_end),
          upgraded_by = COALESCE(excluded.upgraded_by, server_plans.upgraded_by),
          updated_at = datetime('now')
      `)
      .bind(
        guildId,
        tier,
        defaults.max_commands,
        defaults.max_automations,
        defaults.max_api_keys,
        defaults.max_webhooks,
        defaults.log_retention_days,
        defaults.stats_retention_days,
        defaults.price_cents,
        stripeData.stripe_customer_id || null,
        stripeData.stripe_subscription_id || null,
        stripeData.stripe_status || null,
        stripeData.stripe_current_period_end || null,
        stripeData.upgraded_by || null,
      )
      .run();

    log.info(`[ServerPlans] Updated Stripe billing for guild ${guildId}: status=${stripeData.stripe_status}, plan=${tier}`);
    return { success: true };
  } catch (error) {
    log.error("[ServerPlans] Error updating Stripe billing:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Find a server plan by Stripe subscription ID.
 *
 * @param {D1Database} db
 * @param {string} subscriptionId
 * @returns {Promise<object|null>}
 */
export async function getPlanBySubscriptionId(db, subscriptionId) {
  if (!db || !subscriptionId) return null;

  try {
    return await db
      .prepare("SELECT * FROM server_plans WHERE stripe_subscription_id = ?")
      .bind(subscriptionId)
      .first();
  } catch (error) {
    log.error("[ServerPlans] Error finding plan by subscription:", error);
    return null;
  }
}

/**
 * Find a server plan by Stripe customer ID.
 *
 * @param {D1Database} db
 * @param {string} customerId
 * @returns {Promise<object|null>}
 */
export async function getPlanByCustomerId(db, customerId) {
  if (!db || !customerId) return null;

  try {
    return await db
      .prepare("SELECT * FROM server_plans WHERE stripe_customer_id = ?")
      .bind(customerId)
      .first();
  } catch (error) {
    log.error("[ServerPlans] Error finding plan by customer:", error);
    return null;
  }
}

/**
 * Downgrade a guild to free plan (called when subscription is canceled/expired).
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function downgradeToFree(db, guildId) {
  if (!db || !guildId) {
    return { success: false, error: "Missing database or guild ID" };
  }

  const freeDefaults = PLAN_TIERS.free;

  try {
    await db
      .prepare(`
        UPDATE server_plans SET
          plan = 'free',
          max_commands = ?,
          max_automations = ?,
          max_api_keys = ?,
          max_webhooks = ?,
          log_retention_days = ?,
          stats_retention_days = ?,
          price_cents = 0,
          stripe_status = 'canceled',
          updated_at = datetime('now')
        WHERE guild_id = ?
      `)
      .bind(
        freeDefaults.max_commands,
        freeDefaults.max_automations,
        freeDefaults.max_api_keys,
        freeDefaults.max_webhooks,
        freeDefaults.log_retention_days,
        freeDefaults.stats_retention_days,
        guildId,
      )
      .run();

    log.info(`[ServerPlans] Downgraded guild ${guildId} to free plan`);
    return { success: true };
  } catch (error) {
    log.error("[ServerPlans] Error downgrading to free:", error);
    return { success: false, error: error.message || String(error) };
  }
}
