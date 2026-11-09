-- Ideas: "this already exists". When someone sends an idea, a check against the list of
-- what SpaceBot already does may find that it is already there. `ai_exists` holds the
-- name and one-line description of the feature it pointed at (taken from our own list,
-- never from the model's words), so the superadmin can decline it in one click.
ALTER TABLE ideas ADD COLUMN ai_exists TEXT;
