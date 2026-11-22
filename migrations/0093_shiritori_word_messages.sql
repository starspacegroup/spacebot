-- A reaction of ❓ on a word in the Shiritori game makes the bot post that word's definition.
-- To find the word from the message, a round's words now remember the Discord message they
-- came in on (a chain's words already do: shiritori_words.message_id, 0081). Words played
-- before this migration have no message id and are not looked up.
ALTER TABLE shiritori_round_words ADD COLUMN message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_shiritori_round_words_message ON shiritori_round_words(message_id);
CREATE INDEX IF NOT EXISTS idx_shiritori_words_message ON shiritori_words(message_id);
