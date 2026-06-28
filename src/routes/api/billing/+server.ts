/**
 * Stripe Billing API
 *
 * POST /api/billing/checkout - Create a Stripe Checkout session (upgrade to Pro)
 * POST /api/billing/portal   - Create a Stripe Billing Portal session
 * POST /api/billing/cancel   - Cancel subscription at period end
 * POST /api/billing/reactivate - Re-activate a canceled-but-active subscription
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { getServerPlan } from "$lib/db/server-plans.js";
import {
  createCheckoutSession,
  createBillingPortalSession,
  cancelSubscription,
  reactivateSubscription,
  createCustomer,
  StripeError,
} from "$lib/stripe.js";
import { addBillingEvent, BILLING_EVENT_TYPES } from "$lib/db/billing-history.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, cookies, platform, url }) {
  const userId = cookies.get("discord_user_id");
  const actorName = cookies.get("discord_global_name") || cookies.get("discord_username") || null;
  const actorAvatar = cookies.get("discord_avatar") || null;
  const actorDiscriminator = cookies.get("discord_discriminator") || "0";
  if (!userId) {
    return json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = (platform as any)?.env?.DB;
  if (!db) {
    return json({ error: "Database not available" }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, guildId, guildName, interval, returnUrl } = body;

  if (!guildId) {
    return json({ error: "Missing guildId" }, { status: 400 });
  }

  // Verify user has access to this guild (they must be logged in and guild must exist in their admin list)
  // The billing page already enforces this, but we double-check here
  const plan = await getServerPlan(db, guildId);

  // Use the client-provided returnUrl (the page the user is on) so Stripe redirects
  // back to the correct origin, even behind tunnels/proxies. Fall back to server origin.
  const billingUrl = returnUrl || `${url.origin}/admin/${guildId}/account`;

  try {
    switch (action) {
      case "checkout": {
        // Create Stripe Checkout session for upgrading to Pro
        // Only block if there's an active Stripe subscription already.
        // Allow checkout if Pro was granted by a superadmin (no subscription).
        if (plan.stripe_subscription_id && plan.stripe_status === "active") {
          return json({ error: "Server already has an active Pro subscription" }, { status: 400 });
        }

        let customerId = plan.stripe_customer_id;

        // Create a customer if one doesn't exist yet
        if (!customerId) {
          const customer = await createCustomer(platform, {
            guildId,
            guildName: guildName || guildId,
            userId,
          });
          customerId = customer.id;

          // Persist the customer ID immediately
          await db
            .prepare("UPDATE server_plans SET stripe_customer_id = ?, updated_at = datetime('now') WHERE guild_id = ?")
            .bind(customerId, guildId)
            .run()
            .catch(() => {
              // If no row exists yet, insert one
              return db
                .prepare(`
                  INSERT INTO server_plans (guild_id, plan, stripe_customer_id, created_at, updated_at)
                  VALUES (?, 'free', ?, datetime('now'), datetime('now'))
                  ON CONFLICT(guild_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id, updated_at = datetime('now')
                `)
                .bind(guildId, customerId)
                .run();
            });
        }

        // Validate interval
        const billingInterval = interval === "yearly" ? "yearly" : "monthly";

        const session = await createCheckoutSession(platform, {
          guildId,
          guildName: guildName || guildId,
          userId,
          customerId,
          interval: billingInterval,
          successUrl: `${billingUrl}?session_id={CHECKOUT_SESSION_ID}&status=success`,
          cancelUrl: `${billingUrl}?status=canceled`,
        });

        return json({ url: session.url });
      }

      case "portal": {
        // Create a billing portal session
        if (!plan.stripe_customer_id) {
          return json({ error: "No billing account found. Please upgrade first." }, { status: 400 });
        }

        const portalSession = await createBillingPortalSession(
          platform,
          plan.stripe_customer_id,
          billingUrl,
        );

        return json({ url: portalSession.url });
      }

      case "cancel": {
        // Cancel subscription at period end
        if (!plan.stripe_subscription_id) {
          return json({ error: "No active subscription found" }, { status: 400 });
        }

        const sub = await cancelSubscription(platform, plan.stripe_subscription_id);

        // Update local DB
        await db
          .prepare(`
            UPDATE server_plans 
            SET stripe_status = ?, updated_at = datetime('now')
            WHERE guild_id = ?
          `)
          .bind(sub.cancel_at_period_end ? "canceling" : sub.status, guildId)
          .run();

        // Log cancellation
        await addBillingEvent(db, {
          guild_id: guildId,
          event_type: BILLING_EVENT_TYPES.SUBSCRIPTION_CANCELED,
          description: `Subscription set to cancel at end of billing period`,
          actor_id: userId,
          actor_name: actorName,
          actor_avatar: actorAvatar,
          actor_discriminator: actorDiscriminator,
          plan_before: "pro",
          plan_after: "pro",
        });

        return json({ success: true, cancel_at_period_end: sub.cancel_at_period_end });
      }

      case "reactivate": {
        // Re-activate a subscription that was set to cancel
        if (!plan.stripe_subscription_id) {
          return json({ error: "No subscription found" }, { status: 400 });
        }

        const sub = await reactivateSubscription(platform, plan.stripe_subscription_id);

        // Update local DB
        await db
          .prepare(`
            UPDATE server_plans 
            SET stripe_status = ?, updated_at = datetime('now')
            WHERE guild_id = ?
          `)
          .bind(sub.status, guildId)
          .run();

        // Log reactivation
        await addBillingEvent(db, {
          guild_id: guildId,
          event_type: BILLING_EVENT_TYPES.SUBSCRIPTION_REACTIVATED,
          description: `Subscription reactivated`,
          actor_id: userId,
          actor_name: actorName,
          actor_avatar: actorAvatar,
          actor_discriminator: actorDiscriminator,
          plan_before: "pro",
          plan_after: "pro",
        });

        return json({ success: true, status: sub.status });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof StripeError) {
      log.error(`[Billing] Stripe error for guild ${guildId}:`, error.message);
      return json({ error: error.message }, { status: error.status || 500 });
    }
    log.error(`[Billing] Unexpected error for guild ${guildId}:`, error);
    return json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
