-- Add avatar hash columns to event_logs and billing_history for avatar display
-- This allows us to show Discord avatars next to actor names without additional API calls

ALTER TABLE event_logs ADD COLUMN actor_avatar TEXT DEFAULT NULL;
ALTER TABLE event_logs ADD COLUMN target_avatar TEXT DEFAULT NULL;

ALTER TABLE billing_history ADD COLUMN actor_avatar TEXT DEFAULT NULL;

-- Also add discriminator to help calculate default avatars for accounts with no custom avatar
ALTER TABLE event_logs ADD COLUMN actor_discriminator TEXT DEFAULT '0';
ALTER TABLE billing_history ADD COLUMN actor_discriminator TEXT DEFAULT '0';
