-- Billing history table for tracking all billing-related events
-- Gives server owners visibility into plan changes, payments, and admin actions

CREATE TABLE IF NOT EXISTS billing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,

    -- Event classification
    event_type TEXT NOT NULL,      -- 'plan_upgrade', 'plan_downgrade', 'admin_edit', 'payment_success',
                                   -- 'payment_failed', 'subscription_canceled', 'subscription_reactivated',
                                   -- 'subscription_renewed', 'checkout_completed'
    description TEXT NOT NULL,     -- Human-readable summary

    -- Optional details
    details TEXT DEFAULT NULL,     -- JSON blob for extra context
    actor_id TEXT DEFAULT NULL,    -- Discord user ID who triggered the event (NULL for system/Stripe)
    actor_name TEXT DEFAULT NULL,  -- Display name of actor
    amount_cents INTEGER DEFAULT NULL, -- Payment amount if applicable
    plan_before TEXT DEFAULT NULL, -- Plan tier before change
    plan_after TEXT DEFAULT NULL,  -- Plan tier after change

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_billing_history_guild ON billing_history(guild_id);
CREATE INDEX IF NOT EXISTS idx_billing_history_guild_created ON billing_history(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_history_event_type ON billing_history(event_type);
