-- Stats accuracy (2026-11-09).
-- NULL means "this row was built before the column existed"; readers fall back to the old total.
-- server_stats.source is "event" for a count nudged by a join or leave; NULL for a Discord reading.
ALTER TABLE voice_sessions ADD COLUMN is_bot INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN message_human_count INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN message_human_unique_users INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN member_human_joins INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN member_human_leaves INTEGER;
ALTER TABLE server_stats ADD COLUMN source TEXT;
