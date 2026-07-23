-- Let a command's response visibility (ephemeral) be driven by one of its own
-- options at invocation time instead of a fixed boolean.
--
-- When `ephemeral_option` names an option (optionally negated with a leading
-- '!', e.g. "!public"), the response is ephemeral iff that option resolves
-- truthy for the invocation. If the option is omitted by the user, the boolean
-- `ephemeral` column is the fallback default. NULL keeps the classic static
-- behavior (the `ephemeral` boolean alone decides).
ALTER TABLE commands ADD COLUMN ephemeral_option TEXT;
