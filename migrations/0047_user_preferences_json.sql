-- Store lightweight per-user UI preferences.
-- This powers cross-device account-level preference persistence.

ALTER TABLE users ADD COLUMN preferences_json TEXT DEFAULT NULL;
