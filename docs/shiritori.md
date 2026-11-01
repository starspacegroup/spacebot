# Shiritori — the word chain

An English take on the Japanese word game. Each word starts with the last letter
of the one before. A word is used once. Plan: `planning/SHIRITORI_PLAN.md` in the
workspace repo. Migration `0081_shiritori.sql`. Rules: `src/lib/server/shiritori.ts`.
Game: `src/lib/server/shiritori-game.ts`.

**Off by default.** A server turns it on under Dashboard → Activity → Shiritori.
Rounds also need the Game command (`/play`) turned on in the same page.

## The rules

- A word is letters only, three or more long, one word per message.
- It must start with the last letter of the previous word. In **hard mode**, with the
  last two letters.
- It must be in the dictionary: SCOWL size 60, about 77,000 words, no proper nouns, built
  into the code (`shiritori-words.generated.ts`). A server can add **community words** and
  **block words**. A block list always wins.
- No repeats. `star` and `stars` count as one word, as do `make` and `making`: a stem
  counts only when it is a real word, so `bus` is not read as `bu`.
- Each game draws one **dead letter** from the server's pool (default `x q j z`). It is
  shown at the start. A word that ends in it is legal, and it has a price.

## Chain mode

A channel the server picks. Anyone posts the next word.

- ✅ on a word that fits. The chain grows.
- ❌ on a word that does not, with the reason. The **chain breaks**: SpaceBot posts the
  length, the longest word and the server record, and starts a new chain from a random
  seed word.
- A word that ends in the dead letter is counted and ends the chain. It does not count
  as a break for the member.
- The same member twice in a row gets a ❌ and a reminder, and the chain does **not** break.
- Anything that is not one word of letters is ignored: several words, links, emoji, a
  number. So is a message that starts with `//`, and a word under three letters.
- There is no timer. A chain can run for days.
- The first word posted after the feature is turned on opens the first chain and shows its
  seed word. That post is not counted.

Crew can reset the chain from the dashboard.

## Round mode — `/play shiritori`

Timed and turn-based, in any text channel except the Chain channel. One round per channel.

1. `/play shiritori` posts a lobby card: Join, Leave, Start, Cancel. 2–12 players.
2. Start deals a random turn order. The first player may say any word. The first turn gets
   10 extra seconds, because the gateway learns of a new round by polling.
3. Type your word in the channel on your turn. Only the player on the clock is read.
4. A word that is wrong, a repeat, blocked, or ends in the dead letter puts you out, as does
   the clock. A dead-letter word still counts. The next player continues from the same letter.
5. The clock starts at the server's setting (5–60 s, default 15) and drops a second every
   full lap, to a floor of 5 s.
6. The last player in wins. The card becomes the result: the chain, the longest word and
   the most used starting letter.

## How it runs

The game lives on the site (D1 and the Discord REST client). The gateway only forwards.

- The gateway polls `GET /api/shiritori/state` every 10 s. It lists the Chain channels and
  the channels of running rounds, with each turn's deadline. A message in a listed channel
  goes to `POST /api/shiritori/{guild}/message`. A message anywhere else costs nothing.
- When a deadline has passed, the gateway calls `POST /api/shiritori/tick`. So a turn times
  out within about 12 seconds. A late word is judged by the time the member **sent** it.
- All three routes need `Authorization: Bot <token>`, the same as `/api/logs/create`.
- The minute sweep (`sweep_game`) is the backstop when the gateway is down: it times out
  turns, closes lobbies nobody started (30 minutes), and prunes word rows of finished games
  after 90 days. Chain and round summaries and member stats stay.
- Every transition is a guarded write. A word's position in a game is a primary key, and a
  word's lemma is a unique index, so two messages that race cannot both count.

## Stats

`shiritori_member_stats` holds words added, chains broken, rounds played and won, and the
longest word, per member. It is incremented as words land, so pruning word rows never changes
a total. The dashboard shows the top ten and the server record.

## Not built yet

Phase 4 of the plan: the Activity strip, Computer as a voice referee, and Computer as a seat
in a round. Text play does not need any of them.

## Rebuilding the word list

Download SCOWL (https://wordlist.aspell.net/), unpack it, then:

```
bun scripts/build-shiritori-words.ts <scowl-dir>/final
```

The generated file is committed, so a normal build never needs the download.
