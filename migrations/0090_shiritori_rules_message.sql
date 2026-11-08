-- The Shiritori rules message the bot posted with `/game shiritori rules:True`: where it is,
-- so the bot can keep a "Right now" status section on it up to date (the chain's length, last
-- word, next letter and dead letter). NULL means no rules message is being kept up to date.
ALTER TABLE shiritori_settings ADD COLUMN rules_channel_id TEXT;
ALTER TABLE shiritori_settings ADD COLUMN rules_message_id TEXT;
