-- /help lists what you can actually run.
--
-- It used to answer with a fixed embed naming three commands, which was wrong
-- on any server with commands of its own — which is every server that uses
-- SpaceBot for anything. The interaction handler builds the list per member
-- now, from the guild's real command set, filtered by that member's own
-- permissions, and replies ephemerally.
--
-- The stored row keeps a description worth reading in Discord's own command
-- picker, and `ephemeral` is set so anything that falls back to the generic
-- command path is private too. `response_embed` is cleared: it described a
-- reply nothing sends any more, and leaving it would be a second answer to the
-- same question waiting to drift.

UPDATE commands
SET description = 'List the commands you can use here',
    ephemeral = 1,
    response_type = 'action_only',
    response_content = NULL,
    response_embed = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE guild_id = '__built_in__' AND name = 'help';

-- A guild that had turned /help off gets it back. It is the only way a member
-- can ask what the bot does, so it is not a guild's to remove.
DELETE FROM built_in_command_overrides
WHERE command_id IN (SELECT id FROM commands WHERE guild_id = '__built_in__' AND name = 'help')
  AND enabled = 0
  AND default_member_permissions IS NULL;

UPDATE built_in_command_overrides
SET enabled = 1, updated_at = CURRENT_TIMESTAMP
WHERE command_id IN (SELECT id FROM commands WHERE guild_id = '__built_in__' AND name = 'help')
  AND enabled = 0;
