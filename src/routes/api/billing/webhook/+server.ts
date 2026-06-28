/**
 * Stripe Webhook Handler
 *
 * POST /api/billing/webhook
 *
 * Handles Stripe webhook events to keep plan data in sync.
 * This endpoint does NOT require cookie auth — it uses Stripe signature verification.
 */

import { json } from "@sveltejs/kit";
import { log } from "$lib/db/logger.js";
import { verifyWebhookSignature, getStripeWebhookSecret } from "$lib/stripe.js";
import {
  updateStripeBilling,
  getPlanBySubscriptionId,
  downgradeToFree,
} from "$lib/db/server-plans.js";
import { addBillingEvent, BILLING_EVENT_TYPES } from "$lib/db/billing-history.js";

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, platform }) {
  const db = (platform as any)?.env?.DB;
  if (!db) {
    log.error("[StripeWebhook] Database not available");
    return json({ error: "Database not available" }, { status: 500 });
  }

  const webhookSecret = getStripeWebhookSecret(platform);
  if (!webhookSecret) {
    log.error("[StripeWebhook] Webhook secret not configured");
    return json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyWebhookSignature(rawBody, signature, webhookSecret);
  } catch (error) {
    log.error("[StripeWebhook] Signature verification failed:", error.message);
    return json({ error: "Invalid signature" }, { status: 400 });
  }

  log.info(`[StripeWebhook] Received event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      // ─── Checkout completed — user successfully paid ─────────────────
      case "checkout.session.completed": {
        const session = event.data.object;
        const guildId = session.metadata?.guild_id;
        const userId = session.metadata?.discord_user_id;

        if (!guildId) {
          log.warn("[StripeWebhook] checkout.session.completed missing guild_id in metadata");
          break;
        }

        // The subscription is created at this point
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        await updateStripeBilling(db, guildId, {
          plan: "pro",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_status: "active",
          upgraded_by: userId || null,
        });

        // Log to billing history
        const amountPaid = session.amount_total || null;
        await addBillingEvent(db, {
          guild_id: guildId,
          event_type: BILLING_EVENT_TYPES.CHECKOUT_COMPLETED,
          description: `Upgraded to Pro plan`,
          details: { subscription_id: subscriptionId, customer_id: customerId, interval: session.metadata?.interval },
          actor_id: userId || null,
          amount_cents: amountPaid,
          plan_before: "free",
          plan_after: "pro",
        });

        log.info(`[StripeWebhook] Guild ${guildId} upgraded to Pro by user ${userId}`);
        break;
      }

      // ─── Subscription updated (renewal, plan change, cancellation) ───
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const guildId = subscription.metadata?.guild_id;

        if (!guildId) {
          // Try to find the guild by subscription ID
          const existingPlan = await getPlanBySubscriptionId(db, subscription.id);
          if (!existingPlan) {
            log.warn(`[StripeWebhook] subscription.updated: can't find guild for sub ${subscription.id}`);
            break;
          }
          // Use the guild_id from the existing plan
          await handleSubscriptionUpdate(db, existingPlan.guild_id, subscription);
          break;
        }

        await handleSubscriptionUpdate(db, guildId, subscription);
        break;
      }

      // ─── Subscription deleted (fully canceled / expired) ─────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const guildId = subscription.metadata?.guild_id;

        let targetGuildId = guildId;
        if (!targetGuildId) {
          const existingPlan = await getPlanBySubscriptionId(db, subscription.id);
          targetGuildId = existingPlan?.guild_id;
        }

        if (!targetGuildId) {
          log.warn(`[StripeWebhook] subscription.deleted: can't find guild for sub ${subscription.id}`);
          break;
        }

        await downgradeToFree(db, targetGuildId);

        // Log subscription deletion / downgrade
        await addBillingEvent(db, {
          guild_id: targetGuildId,
          event_type: BILLING_EVENT_TYPES.PLAN_DOWNGRADE,
          description: `Subscription ended — downgraded to free plan`,
          details: { subscription_id: subscription.id },
          plan_before: "pro",
          plan_after: "free",
        });

        log.info(`[StripeWebhook] Guild ${targetGuildId} downgraded to Free (subscription deleted)`);
        break;
      }

      // ─── Invoice paid — subscription renewed successfully ────────────
      case "invoice.paid": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        const existingPlan = await getPlanBySubscriptionId(db, subscriptionId);
        if (existingPlan) {
          const periodEnd = invoice.lines?.data?.[0]?.period?.end
            ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
            : null;

          await updateStripeBilling(db, existingPlan.guild_id, {
            plan: "pro",
            stripe_status: "active",
            stripe_current_period_end: periodEnd,
          });

          // Log successful payment
          await addBillingEvent(db, {
            guild_id: existingPlan.guild_id,
            event_type: BILLING_EVENT_TYPES.SUBSCRIPTION_RENEWED,
            description: `Subscription renewed successfully`,
            details: { invoice_id: invoice.id, period_end: periodEnd },
            amount_cents: invoice.amount_paid || null,
            plan_before: "pro",
            plan_after: "pro",
          });

          log.info(`[StripeWebhook] Guild ${existingPlan.guild_id} subscription renewed`);
        }
        break;
      }

      // ─── Invoice payment failed ─────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        const existingPlan = await getPlanBySubscriptionId(db, subscriptionId);
        if (existingPlan) {
          await updateStripeBilling(db, existingPlan.guild_id, {
            stripe_status: "past_due",
          });

          // Log failed payment
          await addBillingEvent(db, {
            guild_id: existingPlan.guild_id,
            event_type: BILLING_EVENT_TYPES.PAYMENT_FAILED,
            description: `Payment failed — subscription marked past due`,
            details: { invoice_id: invoice.id },
            amount_cents: invoice.amount_due || null,
            plan_before: "pro",
            plan_after: "pro",
          });

          log.warn(`[StripeWebhook] Guild ${existingPlan.guild_id} payment failed — marked past_due`);
        }
        break;
      }

      default:
        log.debug(`[StripeWebhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    log.error(`[StripeWebhook] Error processing ${event.type}:`, error);
    // Return 200 anyway to prevent Stripe from retrying
    // (we log the error and can investigate manually)
  }

  // Always return 200 to acknowledge receipt
  return json({ received: true });
}

/**
 * Handle subscription update logic.
 *
 * @param {D1Database} db
 * @param {string} guildId
 * @param {object} subscription - Stripe subscription object
 */
async function handleSubscriptionUpdate(db, guildId, subscription) {
  const status = subscription.cancel_at_period_end ? "canceling" : subscription.status;

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  // If the subscription is active, keep it as Pro
  // If it's canceled/past_due/unpaid, update status but don't immediately downgrade
  // (The subscription.deleted event will handle full downgrade)
  const plan = ["active", "trialing", "canceling"].includes(status) ? "pro" : undefined;

  await updateStripeBilling(db, guildId, {
    plan,
    stripe_status: status,
    stripe_current_period_end: periodEnd,
  });

  log.info(`[StripeWebhook] Guild ${guildId} subscription updated: status=${status}`);
}
