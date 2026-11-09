-- Stats accuracy (2026-11-09).
-- NULL means "this row was built before the column existed"; readers fall back to the old total.
ALTER TABLE voice_sessions ADD COLUMN is_bot INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN message_human_count INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN message_human_unique_users INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN member_human_joins INTEGER;
ALTER TABLE aggregated_stats ADD COLUMN member_human_leaves INTEGER;
