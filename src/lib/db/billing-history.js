/**
 * Billing History Database Module
 *
 * Tracks billing-related events for each guild: plan changes, payments,
 * admin edits, cancellations, etc. Gives server owners a clear audit trail.
 */

import { log } from "./logger.js";

/**
 * Event type constants
 */
export const BILLING_EVENT_TYPES = {
  CHECKOUT_COMPLETED: "checkout_completed",
  PLAN_UPGRADE: "plan_upgrade",
  PLAN_DOWNGRADE: "plan_downgrade",
  ADMIN_EDIT: "admin_edit",
  PAYMENT_SUCCESS: "payment_success",
  PAYMENT_FAILED: "payment_failed",
  SUBSCRIPTION_CANCELED: "subscription_canceled",
  SUBSCRIPTION_REACTIVATED: "subscription_reactivated",
  SUBSCRIPTION_RENEWED: "subscription_renewed",
  PLAN_RESET: "plan_reset",
};

/**
 * Add a billing history event.
 *
 * @param {D1Database} db
 * @param {object} event
 * @param {string} event.guild_id
 * @param {string} event.event_type - One of BILLING_EVENT_TYPES
 * @param {string} event.description - Human-readable summary
 * @param {object} [event.details] - Additional context (stored as JSON)
 * @param {string} [event.actor_id] - Discord user ID who triggered the event
 * @param {string} [event.actor_name] - Display name of actor
 * @param {number} [event.amount_cents] - Payment amount in cents
 * @param {string} [event.plan_before] - Plan tier before change
 * @param {string} [event.plan_after] - Plan tier after change
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function addBillingEvent(db, event) {
  if (!db || !event?.guild_id || !event?.event_type) {
    return { success: false, error: "Missing required fields" };
  }

  try {
    await db
      .prepare(`
        INSERT INTO billing_history (
          guild_id, event_type, description,
          details, actor_id, actor_name,
          amount_cents, plan_before, plan_after,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(
        event.guild_id,
        event.event_type,
        event.description,
        event.details ? JSON.stringify(event.details) : null,
        event.actor_id || null,
        event.actor_name || null,
        event.amount_cents ?? null,
        event.plan_before || null,
        event.plan_after || null,
      )
      .run();

    log.debug(`[BillingHistory] Logged ${event.event_type} for guild ${event.guild_id}`);
    return { success: true };
  } catch (error) {
    log.error("[BillingHistory] Error adding event:", error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Get billing history for a guild.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {object} [options]
 * @param {number} [options.limit=50] - Max events to return
 * @param {number} [options.offset=0] - Offset for pagination
 * @returns {Promise<{events: object[], total: number}>}
 */
export async function getBillingHistory(db, guildId, { limit = 50, offset = 0 } = {}) {
  if (!db || !guildId) return { events: [], total: 0 };

  try {
    const [eventsResult, countResult] = await Promise.all([
      db
        .prepare(`
          SELECT * FROM billing_history
          WHERE guild_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `)
        .bind(guildId, limit, offset)
        .all(),
      db
        .prepare("SELECT COUNT(*) as total FROM billing_history WHERE guild_id = ?")
        .bind(guildId)
        .first(),
    ]);

    const events = (eventsResult?.results || []).map((row) => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : null,
    }));

    return {
      events,
      total: countResult?.total || 0,
    };
  } catch (error) {
    log.error("[BillingHistory] Error getting history:", error);
    return { events: [], total: 0 };
  }
}
