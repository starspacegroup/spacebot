-- Add customizable embed colors per event category for log messages
-- Stored as JSON object mapping category names to hex color strings
-- e.g. {"member":"#2ecc71","message":"#3498db","moderation":"#e74c3c"}
ALTER TABLE guild_settings ADD COLUMN log_embed_colors TEXT;
