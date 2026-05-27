-- Extend user workflow policies with execution strategy and model routing preferences.

ALTER TABLE user_workflows
    ADD COLUMN runner_strategy TEXT NOT NULL DEFAULT 'pinned';

ALTER TABLE user_workflows
    ADD COLUMN allowed_runner_token_ids_json TEXT DEFAULT NULL;

ALTER TABLE user_workflows
    ADD COLUMN allowed_runner_instance_ids_json TEXT DEFAULT NULL;

ALTER TABLE user_workflows
    ADD COLUMN model_preferences_json TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_workflows_user_strategy
    ON user_workflows(user_id, runner_strategy, updated_at DESC);