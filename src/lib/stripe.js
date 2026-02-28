/**
 * Stripe Integration Module
 *
 * Handles all Stripe API interactions for SpaceBot billing.
 * Uses the Stripe REST API directly (no SDK) for Cloudflare Workers compatibility.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY      - Stripe secret key (sk_live_... or sk_test_...)
 *   STRIPE_WEBHOOK_SECRET  - Webhook endpoint signing secret (whsec_...)
 *   STRIPE_PRO_PRICE_ID    - Price ID for the Pro plan (price_...)
 */

import { log } from "./db/logger.js";

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Get the Stripe secret key from the platform environment
 * @param {object} platform
 * @returns {string|undefined}
 */
function getStripeKey(platform) {
  return platform?.env?.STRIPE_SECRET_KEY ?? process.env?.STRIPE_SECRET_KEY;
}

/**
 * Get the Stripe webhook signing secret
 * @param {object} platform
 * @returns {string|undefined}
 */
export function getStripeWebhookSecret(platform) {
  return platform?.env?.STRIPE_WEBHOOK_SECRET ?? process.env?.STRIPE_WEBHOOK_SECRET;
}

/**
 * Get the Stripe Pro monthly price ID
 * @param {object} platform
 * @returns {string|undefined}
 */
export function getStripePriceIdMonthly(platform) {
  return platform?.env?.STRIPE_PRO_MONTHLY_PRICE_ID ?? process.env?.STRIPE_PRO_MONTHLY_PRICE_ID;
}

/**
 * Get the Stripe Pro yearly price ID
 * @param {object} platform
 * @returns {string|undefined}
 */
export function getStripePriceIdYearly(platform) {
  return platform?.env?.STRIPE_PRO_YEARLY_PRICE_ID ?? process.env?.STRIPE_PRO_YEARLY_PRICE_ID;
}

/**
 * Make an authenticated request to the Stripe API.
 *
 * @param {string} stripeKey - Stripe secret key
 * @param {string} endpoint - API path (e.g. "/customers")
 * @param {object} [options]
 * @param {'GET'|'POST'|'DELETE'} [options.method='GET']
 * @param {Record<string, string>} [options.body] - Form-encoded body params
 * @returns {Promise<object>}
 */
async function stripeRequest(stripeKey, endpoint, { method = "GET", body = null } = {}) {
  const url = `${STRIPE_API}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${stripeKey}`,
  };

  const fetchOptions = { method, headers };

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    fetchOptions.body = encodeBody(body);
  }

  const res = await fetch(url, fetchOptions);
  const data = await res.json();

  if (!res.ok) {
    log.error(`[Stripe] API error ${res.status} on ${method} ${endpoint}:`, data?.error?.message);
    throw new StripeError(data?.error?.message || "Stripe API error", res.status, data?.error);
  }

  return data;
}

/**
 * URL-encode a flat or nested object into application/x-www-form-urlencoded format.
 * Supports nested keys like metadata[guild_id] via dot/bracket notation.
 *
 * @param {Record<string, any>} params
 * @returns {string}
 */
function encodeBody(params) {
  const parts = [];

  function encode(key, value) {
    if (value === null || value === undefined) return;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        encode(`${key}[${k}]`, v);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => encode(`${key}[${i}]`, v));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  for (const [key, value] of Object.entries(params)) {
    encode(key, value);
  }

  return parts.join("&");
}

/**
 * Custom error class for Stripe API errors.
 */
export class StripeError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {object} [raw]
   */
  constructor(message, status, raw) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.raw = raw;
  }
}

// ─── Customer Management ────────────────────────────────────────────────────

/**
 * Create a Stripe customer for a guild.
 *
 * @param {object} platform
 * @param {object} opts
 * @param {string} opts.guildId
 * @param {string} opts.guildName
 * @param {string} [opts.email]
 * @param {string} [opts.userId] - Discord user ID of the person upgrading
 * @returns {Promise<object>} Stripe customer object
 */
export async function createCustomer(platform, { guildId, guildName, email, userId }) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  const body = {
    name: guildName,
    metadata: {
      guild_id: guildId,
      discord_user_id: userId || "",
      source: "spacebot",
    },
  };
  if (email) body.email = email;

  return stripeRequest(key, "/customers", { method: "POST", body });
}

/**
 * Retrieve a Stripe customer.
 *
 * @param {object} platform
 * @param {string} customerId
 * @returns {Promise<object>}
 */
export async function getCustomer(platform, customerId) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  return stripeRequest(key, `/customers/${customerId}`);
}

// ─── Checkout Sessions ──────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout session for upgrading to Pro.
 *
 * @param {object} platform
 * @param {object} opts
 * @param {string} opts.guildId
 * @param {string} opts.guildName
 * @param {string} opts.userId - Discord user ID
 * @param {string} [opts.customerId] - Existing Stripe customer ID
 * @param {'monthly'|'yearly'} [opts.interval='monthly'] - Billing interval
 * @param {string} opts.successUrl - URL after successful payment
 * @param {string} opts.cancelUrl - URL if user cancels
 * @returns {Promise<object>} Stripe Checkout Session object
 */
export async function createCheckoutSession(platform, { guildId, guildName, userId, customerId, interval = "monthly", successUrl, cancelUrl }) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  const priceId = interval === "yearly"
    ? getStripePriceIdYearly(platform)
    : getStripePriceIdMonthly(platform);
  if (!priceId) throw new StripeError(`Stripe Pro ${interval} price ID is not configured`, 500);

  const body = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      guild_id: guildId,
      guild_name: guildName,
      discord_user_id: userId,
    },
    "subscription_data[metadata][guild_id]": guildId,
    "subscription_data[metadata][guild_name]": guildName,
    "subscription_data[metadata][discord_user_id]": userId,
  };

  if (customerId) {
    body.customer = customerId;
  } else {
    body.customer_creation = "always";
    body["customer_email"] = undefined; // Let user enter it during checkout
  }

  return stripeRequest(key, "/checkout/sessions", { method: "POST", body });
}

// ─── Subscription Management ────────────────────────────────────────────────

/**
 * Retrieve a Stripe subscription.
 *
 * @param {object} platform
 * @param {string} subscriptionId
 * @returns {Promise<object>}
 */
export async function getSubscription(platform, subscriptionId) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  return stripeRequest(key, `/subscriptions/${subscriptionId}`);
}

/**
 * Cancel a Stripe subscription at period end (doesn't immediately revoke).
 *
 * @param {object} platform
 * @param {string} subscriptionId
 * @returns {Promise<object>}
 */
export async function cancelSubscription(platform, subscriptionId) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  return stripeRequest(key, `/subscriptions/${subscriptionId}`, {
    method: "POST",
    body: { cancel_at_period_end: "true" },
  });
}

/**
 * Re-activate a subscription that was set to cancel at period end.
 *
 * @param {object} platform
 * @param {string} subscriptionId
 * @returns {Promise<object>}
 */
export async function reactivateSubscription(platform, subscriptionId) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  return stripeRequest(key, `/subscriptions/${subscriptionId}`, {
    method: "POST",
    body: { cancel_at_period_end: "false" },
  });
}

// ─── Billing Portal ─────────────────────────────────────────────────────────

/**
 * Create a Stripe Billing Portal session so users can manage payment methods,
 * view invoices, etc.
 *
 * @param {object} platform
 * @param {string} customerId
 * @param {string} returnUrl - URL to return to after portal
 * @returns {Promise<object>}
 */
export async function createBillingPortalSession(platform, customerId, returnUrl) {
  const key = getStripeKey(platform);
  if (!key) throw new StripeError("Stripe is not configured", 500);

  return stripeRequest(key, "/billing_portal/sessions", {
    method: "POST",
    body: {
      customer: customerId,
      return_url: returnUrl,
    },
  });
}

// ─── Webhook Verification ───────────────────────────────────────────────────

/**
 * Verify a Stripe webhook signature (using Web Crypto API for Workers compat).
 *
 * @param {string} payload - Raw request body
 * @param {string} signature - Stripe-Signature header value
 * @param {string} secret - Webhook signing secret
 * @param {number} [toleranceSeconds=300] - Max age of event in seconds
 * @returns {Promise<object>} Parsed event object
 * @throws {StripeError} If verification fails
 */
export async function verifyWebhookSignature(payload, signature, secret, toleranceSeconds = 300) {
  if (!signature || !secret) {
    throw new StripeError("Missing webhook signature or secret", 400);
  }

  const parts = signature.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    acc[key.trim()] = value?.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const expectedSig = parts.v1;

  if (!timestamp || !expectedSig) {
    throw new StripeError("Invalid webhook signature format", 400);
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > toleranceSeconds) {
    throw new StripeError("Webhook timestamp too old", 400);
  }

  // Compute expected signature using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(`${timestamp}.${payload}`);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const computedSig = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedSig !== expectedSig) {
    throw new StripeError("Invalid webhook signature", 400);
  }

  return JSON.parse(payload);
}
