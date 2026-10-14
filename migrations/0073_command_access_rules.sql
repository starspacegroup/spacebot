-- Who may run a command, beyond its permission level.
--
-- `access_rules` is a JSON object on the command (custom commands) and on the
-- per-server override (built-in commands). Today it holds
-- `{"allow_roles": ["<role id>", ...], "deny_roles": [...]}`:
--
--   * a member holding a `deny_roles` role is refused, whatever else they have;
--   * otherwise a member is allowed if they meet the permission level
--     (`default_member_permissions`) OR hold an `allow_roles` role;
--   * server administrators are always allowed.
--
-- It is a JSON column, not one column per rule, because the next rules (specific
-- members, channels, categories, time windows) are more keys in the same object
-- rather than more migrations. NULL means no rules, which is every existing row.

ALTER TABLE commands ADD COLUMN access_rules TEXT;
ALTER TABLE built_in_command_overrides ADD COLUMN access_rules TEXT;
