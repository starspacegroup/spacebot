-- Add Stripe billing fields to server_plans
-- Enables self-service plan upgrades via Stripe Checkout

ALTER TABLE server_plans ADD COLUMN stripe_customer_id TEXT DEFAULT NULL;
ALTER TABLE server_plans ADD COLUMN stripe_subscription_id TEXT DEFAULT NULL;
ALTER TABLE server_plans ADD COLUMN stripe_status TEXT DEFAULT NULL;       -- 'active', 'past_due', 'canceled', 'trialing', etc.
ALTER TABLE server_plans ADD COLUMN stripe_current_period_end DATETIME DEFAULT NULL;
ALTER TABLE server_plans ADD COLUMN upgraded_by TEXT DEFAULT NULL;          -- Discord user ID who upgraded

-- Index for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_server_plans_stripe_customer ON server_plans(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_server_plans_stripe_subscription ON server_plans(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_server_plans_stripe_status ON server_plans(stripe_status);
