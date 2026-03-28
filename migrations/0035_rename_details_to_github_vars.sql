-- Rename {details.*} template variables to {github.*} in all stored content
-- This covers action_config, trigger_filters, and any other columns that may
-- contain template variable references.

-- Automations: action_config (message content, embed fields, etc.)
UPDATE automations
SET action_config = REPLACE(action_config, '{details.', '{github.'),
    updated_at = datetime('now')
WHERE action_config LIKE '%{details.%';

-- Automations: trigger_filters (color rules and condition variables)
UPDATE automations
SET trigger_filters = REPLACE(trigger_filters, 'details.', 'github.'),
    updated_at = datetime('now')
WHERE trigger_filters LIKE '%details.%';

-- Commands: action_config
UPDATE commands
SET action_config = REPLACE(action_config, '{details.', '{github.'),
    updated_at = datetime('now')
WHERE action_config LIKE '%{details.%';

-- Scheduled messages: message_payload
UPDATE scheduled_messages
SET message_payload = REPLACE(message_payload, '{details.', '{github.'),
    updated_at = datetime('now')
WHERE message_payload LIKE '%{details.%';

-- Button action sets: buttons JSON
UPDATE button_action_sets
SET buttons = REPLACE(buttons, '{details.', '{github.'),
    updated_at = datetime('now')
WHERE buttons LIKE '%{details.%';
