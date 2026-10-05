-- Member rooms: a category per member.
--
-- `category_mode` gains a third value, 'per_user': each member who makes a room
-- gets a category of their own, named from `category_name` with `{user}`
-- swapped for their name ("{user}'s rooms" when blank). Their later rooms on
-- the same preset reuse it, and it is deleted once their last room there
-- closes, so the channel list does not fill with empty folders.
--
-- The room row records which per-member category it was put in. That is how
-- the next room finds it and how a close knows whether it was the last one.
-- NULL for rooms under an admin's category or the preset's shared one.

ALTER TABLE managed_channels ADD COLUMN user_category_id TEXT;

CREATE INDEX IF NOT EXISTS idx_managed_channels_user_category
    ON managed_channels(user_category_id, status);
