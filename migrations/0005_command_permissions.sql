-- Add permission controls for slash commands
-- default_member_permissions: Discord permission bitfield (null = everyone can use)
-- This maps to Discord's default_member_permissions field on application commands

ALTER TABLE commands ADD COLUMN default_member_permissions TEXT;
-- Examples:
-- NULL = No restrictions (everyone can use)
-- '0' = Admin only (no one can use by default, server admin must grant)
-- '8' = Requires Administrator permission (1 << 3)
-- '32' = Requires Manage Server permission (1 << 5)
-- Multiple permissions combined with bitwise OR

-- Optional: dm_permission controls if command can be used in DMs
-- Default is true, but for server-specific commands we typically want false
ALTER TABLE commands ADD COLUMN dm_permission INTEGER DEFAULT 0;

-- Create index for permission-based queries
CREATE INDEX IF NOT EXISTS idx_commands_permissions ON commands(default_member_permissions);
