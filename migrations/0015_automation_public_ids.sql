-- Add public_id column for URL-safe hash IDs on automations
-- This replaces exposing auto-increment IDs in URLs

-- Step 1: Add the column without UNIQUE constraint
ALTER TABLE automations ADD COLUMN public_id TEXT;

-- Step 2: Generate public_ids for existing automations
-- Uses hex of random bytes to create unique IDs
UPDATE automations 
SET public_id = lower(hex(randomblob(8)))
WHERE public_id IS NULL;

-- Step 3: Create unique index for efficient lookups (enforces uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_public_id ON automations(public_id);
