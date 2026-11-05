# Shiritori — the word chain

An English take on the Japanese word game. Each word starts with the last letter
of the one before. A word is used once. Plan: `planning/SHIRITORI_PLAN.md` in the
workspace repo. Migration `0081_shiritori.sql`. Rules: `src/lib/server/shiritori.ts`.
Game: `src/lib/server/shiritori-game.ts`.

**Off by default.** A server turns it on with the Enable switch on its card under Dashboard → Activity → Games; its settings
are in that card's Settings panel.
Rounds also need the Game command (`/game`, synonym `/play`) turned on in the same page.

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

## Voice chat rounds

Run `/game shiritori` (or `/play shiritori`) **inside a voice channel's chat**, while you are in the call, and the
round is a **voice round**. It plays the same, with these differences:

- **People agree to play.** Nobody is added for being in the call. The lobby lists who is in
  the call and has not joined, and they press **Join**. Only someone in the call can join.
- **The call is the table.** Start deals in only the people who joined and are still in the
  call. During the round, a player who leaves the call is **skipped at once** if it is their
  turn, and skipped each time their turn would come. If they are back within 20 seconds, or
  any time before their next turn is skipped for good, they are still in. If they are still
  gone after 20 seconds, they are put out ("left the call"). The grace covers a reconnect.
- **Everyone leaves**: the round closes. **One player is left**: that player wins.
- You cannot open a round in a voice channel's chat from outside the call.
- The gateway ticks a voice round every poll (5 seconds), so a leaver is noticed quickly. The
  call comes from the same live voice table the Timebox and Game use. If the gateway restarts
  mid-round that table is rebuilt, and the 20 seconds is what keeps a restart from skipping
  people.

## ❓ for a definition, or what was meant

React ❓ (or ❔) to a word that was part of the game and the bot replies to that message:

- **A word:** its definition, from the same Wiktionary lookup `/define` uses (see
  [word-commands.md](word-commands.md)). If there is no entry it says so, trying the base word first
  ("tigers", then "tiger"). It works on a word the game accepted and on a real word it turned
  away (the wrong first letter, a repeat), and whether or not the server has `/define` on.
- **Not in the dictionary:** "**eagel** is not in the dictionary. Maybe this was meant: **eagle**?"
  The close spellings come from Datamuse and are filtered to words the game would accept (the
  server's own allow and block lists included). If nothing is close, it says that.

What counts as "part of the game": in the Chain channel, a word addressed to the bot (chat is
ignored); in a channel that has hosted a round, a one-word message from someone who played in it,
**including after the round has ended**. A message is answered once per ten minutes, and one person
gets at most eight lookups a minute. If a word service is down the bot stays quiet, so a later ❓
can try again. Reactions from bots are ignored.

How it travels: the gateway sees every ❓, fetches the message if it was not cached, strips the
bot mention, and posts the text, its author and whether it was addressed to
`/api/shiritori/{guild}/reaction`. The site decides whether it was a game word: first by the
message id of an accepted word (`shiritori_words.message_id`; `shiritori_round_words.message_id`
from migration `0093`), then by the rules above. This needs the gateway restarted to take effect.

## /game help

`/game help` (or `/play help`) is for anyone: a private message with the rules, built from this
server's settings and including the chain as it stands (length, last word, next letter, dead
letter), how the ❓ works, and a line about the hidden-agent game. It is the same text a manager
pins with `rules:True`. If Shiritori is off in the server it says so and still shows the rules.
Migration `0094` adds the subcommand.

## The turn prompt

Every round, text or voice, keeps **one short message at the bottom of the chat** for whoever
is on the clock: who, the letter, the time left, the dead letter, and the last three words. It
pings the player. Each turn posts a new one and deletes the last, so it is always where people
are looking. The round card above holds who is in and out and is edited only when that
changes. The last prompt is deleted when the round ends.

## Chain mode

A channel the server picks. Anyone posts the next word.

Pick it in the dashboard (Activity, "Chain channel"), or from Discord with
`/game shiritori channel:#name`. The slash option turns Shiritori on and sets the channel in
one step. It opens no round. It works only for people who hold the dashboard's **manage
commands** permission: Manage Server by default, or whatever level the server set for it on the
Settings page. Administrators always pass. (The Settings page sets a level, not roles; a role
list saved in the database is honoured, but nothing in the dashboard writes one.) Everyone else gets a private refusal and nothing
changes. Only text and announcement channels are accepted. The handler is `setChainChannel` in `src/lib/server/shiritori-game.ts`.
To turn the chain off, run `/game shiritori off:True` (same permission, and it keeps
rounds working), or clear the channel in the dashboard. Giving `channel` and `off`
together is refused.

To post the rules, run `/game shiritori rules:True` in the channel (same permission). It posts a
rules message built from the server's settings (hard mode, dead letters, turn clock) and pins
it; if the bot cannot pin, it says so and the message still stands. One of `channel`, `off` and
`rules` per command. Migrations `0086`, `0087` and `0088` add the three options.

**The rules message stays current.** The bot remembers which message it posted (migration `0090`:
`rules_channel_id`, `rules_message_id`) and keeps a "Right now" section at its foot: the chain's
length, the last word and who played it, the letter the next word starts with, the dead letter,
and the longest chain so far. It is edited after every word that lands, every break or end, a
dashboard reset, and when the chain channel is set or turned off. A chat message or a refused
word does not edit it. Run `rules:True` again and the bot refreshes that message instead of
posting a second. If someone deletes it, the bot stops tracking it and carries on; run
`rules:True` to post a new one. A message posted before 0090 is not tracked: delete it and run
the command once more. The edit uses the plain client, so a failed edit never shows up as a
Shiritori health notice.

- ✅ on a word that fits. The chain grows. If the bot cannot add reactions (Add Reactions
  missing in the channel), it replies in words instead: "✅ **word**. The next word starts with
  **x**."
- ❌ on a word that does not. The **chain breaks**: SpaceBot posts the
  length, the longest word and the server record, and starts a new chain from a random
  seed word.
- **Mention the bot to play.** A word counts only when the message starts with a mention of
  the bot: `@SpaceBot eagle`. Everything else in the channel is chat. It gets no reaction
  and no reply, it never breaks the chain, and it does not use a turn. The gateway strips the
  mention and sends the word with an `addressed` flag; the site ignores a Chain message
  without it. Typing `@SpaceBot` offers two mentions, the bot and the bot's own role, and
  either one counts. Round mode (`/game shiritori`) does not need a mention.
- A word on the server's block list gets a ❌ and a reason, and **nothing else**: the chain
  does not break. A block list matches stems, so it can catch an innocent word, and one
  member must not be able to end a chain on purpose with a word the filter refuses.
- A word that ends in the dead letter is counted and ends the chain. It does not count
  as a break for the member.
- The same member twice in a row gets a ❌ and a reminder, and the chain does **not** break.
- After the mention, anything that is not one word of letters is ignored: several words,
  links, emoji, a number. So is a message that starts with `//`, and a word under three letters.
- There is no timer. A chain can run for days.
- The first mentioned word posted after the feature is turned on opens the first chain and shows its
  seed word. That post is not counted.

Crew can reset the chain from the dashboard.

## Round mode — `/game shiritori`

Timed and turn-based, in any text channel except the Chain channel. One round per channel.

1. `/play shiritori` posts a lobby card: Join, Leave, Start, Cancel. 2–12 players.
2. Start deals a random turn order. The first player may say any word. The first turn gets
   10 extra seconds, because the gateway learns of a new round by polling.
3. Type your word in the channel on your turn. Only the player on the clock is read. The turn
   prompt at the bottom of the chat says who it is.
4. A word that is wrong, or a repeat, or ends in the dead letter puts you out, as does
   the clock. A blocked word is turned away with a ❌ and you can try again. A dead-letter word still counts. The next player continues from the same letter.
5. The clock starts at the server's setting (5–60 s, default 15) and drops a second every
   full lap, to a floor of 5 s.
6. The last player in wins. The card becomes the result: the chain, the longest word and
   the most used starting letter.

## How it runs

The game lives on the site (D1 and the Discord REST client). The gateway only forwards.

- The gateway asks `GET /api/shiritori/state` which channels to listen to. It lists the Chain
  channels, and the lobbies and running rounds with each turn's deadline. It is **one read**.
  Idle (no lobby or round anywhere) the gateway asks once a minute, so a server that turns
  Shiritori on or sets a Chain channel is noticed within a minute. While a lobby or round
  is open it asks every 5 seconds, and the bot's own lobby card appearing wakes it at once.
- The gateway forwards only a message in a Chain channel or a **running** round's channel,
  and only if it could be a move: one word of letters, three or more. Chat costs no request.
  A forwarded word goes to `POST /api/shiritori/{guild}/message`.
- When a deadline has passed, the gateway calls `POST /api/shiritori/tick`. So a turn times
  out within about 8 seconds. A late word is judged by the time the member **sent** it. The
  first turn of a round gets 10 extra seconds, so a round is always noticed before it starts.
- The gateway sends a channel's words one at a time, in the order they were sent, so two
  quick words cannot race and break the chain.
- All three routes need `Authorization: Bot <token>`, the same as `/api/logs/create`.
- The minute sweep (`sweep_game`) is the backstop when the gateway is down: it times out
  turns and closes lobbies nobody started (30 minutes). An idle minute is one read. Once an
  hour it prunes word rows of finished games older than 90 days. Chain and round summaries and member stats stay.
- Every transition is a guarded write. A word's position in a game is a primary key, and a
  word's lemma is a unique index, so two messages that race cannot both count.

## When SpaceBot cannot post

If SpaceBot loses Send Messages, Add Reactions or Read Message History in a channel, the game
would otherwise fail without a word: a chain breaks, or a word gets no reaction. Every failed
post, edit or reaction is recorded (once a minute per server), and the dashboard shows it
above the settings with the channel, Discord's error and what to grant. Saving the settings
clears the notice. The game itself carries on.

## Who can change it

Every form action on the Activity page (the Shiritori settings and chain reset, and the
Timebox, Game and module settings) needs Administrator on the server, or a superadmin. The
check runs in the action itself, because an action does not run the page's load.

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

## Name on this server

A server can rename Shiritori and give it an icon (dashboard → Activity →
Shiritori card → _Name on this server_; rules in [activity.md](activity.md)).
Round cards use the name, and the custom icon replaces the 🔗/🎙️ mark; the
`/play shiritori` description says "Start <name> in this channel". The command
itself stays `/play shiritori`.
