-- Record which integration command template a command was applied from.
--
-- Applying a template clones it into the guild's own commands; there is still
-- no live link (editing the command never touches the template, and re-applying
-- makes a fresh copy). These columns are provenance only, so the integrations
-- page can show "you already created these from this template" and link to them
-- instead of leaving the admin to guess whether they'd applied it before.
--
-- NULL for every command created any other way (hand-made, imported, seeded).
ALTER TABLE commands ADD COLUMN source_integration_slug TEXT;
ALTER TABLE commands ADD COLUMN source_template_key TEXT;

-- Looking up "commands in this guild from this integration's templates" is the
-- only access pattern; guild_id leads so the index also serves the per-guild
-- listing.
CREATE INDEX IF NOT EXISTS idx_commands_source_template
    ON commands(guild_id, source_integration_slug, source_template_key);
