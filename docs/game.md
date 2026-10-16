# Game — the hidden-agent round

A round for everyone in a voice channel. All but one player are told a secret
word; one is the **agent** and is not. They talk in voice, anyone can call a
vote, and the table ejects who it thinks the agent is. It is the Among Us shape,
kept small. It is **off until a server turns it on** (dashboard → Activity), and
it is played in the [Activity](activity.md), not in Discord messages: nothing in
a voice channel's text chat can be a secret.

Design history and the reasons behind each rule: `planning/IDEAS.md` in the
workspace repo, "Voice games" (issue #54). Migrations `0076_game.sql` and `0077_game_command_play.sql`. The command is `/play`, because `/game` belongs to the *Space Game integration.

## Playing

1. **Lobby.** `/play start` in a voice channel, or _Open a lobby_ in the Activity's
   Game tab. A card posts in the voice channel's text chat with Join, Leave,
   Start and Cancel; the Activity shows the same lobby. Only someone in that voice
   channel can join. One live round per voice channel.
2. **Start.** The person who opened it (or Crew, from the card) starts it once
   enough players are in the voice channel (default 4). Anyone who left the voice
   channel since joining is dropped. The deal picks one agent at random, and a word.
3. **The round.** Each player opens the Activity and sees their own card first:
   the agent is told they are the agent and not the word, with how they win;
   everyone else is told the word (hold _Hold to hide_ to cover it). _Got it_ puts
   the card away and shows the round: the clock, the other players, and the vote
   button. Default length is five minutes.
4. **Calling a vote.** After a lock (default 60 s) any living player can call one
   vote (default one per player). A public line posts in the voice channel. Every
   living player picks a player, or Skip, in the Activity and can change their
   pick until it closes. Their own pick shows as a red _Your vote_ banner; the
   other players show as _Voted_ or _Deciding_, never for whom. It closes when
   everyone has voted or after 30 s.
5. **The count.** The most votes is ejected. A tie, or Skip on top, ejects nobody.
   Who voted for whom is never shown.
6. **The end.**
    - The agent is ejected: **the players win**.
    - The clock runs out with the agent still in: **the agent wins**. A vote open
      when the clock runs out finishes first.
    - Only the agent and one other are left: **the agent wins** (one player cannot
      outvote them).
    - Cancelled by the starter or Crew, or abandoned (the voice channel stayed
      empty for 3 minutes), or a lobby nobody started for 30 minutes.

The result posts in the voice channel with the agent and the word revealed, and
the Activity shows the roles for ten minutes.

## What an ejected player loses

Server-muted (not deafened: they still hear the argument), if the server leaves
that on. They cannot vote or call. Nothing else: no name change, no
posting block, no camera block (planned, see below).

The mute follows the member, not the channel, so the game **restores exactly the
mute they had before**. A player a moderator had already muted is left muted and
never unmuted. If Discord refuses the unmute because the player left voice, the
minute sweep retries every minute for six hours. Nothing the game did to a
member outlives the round that did it.

## Settings

Dashboard → Activity → Game settings. They are copied into a round when its
lobby opens, so changing them never changes a round in progress.

| Setting                                    | Default      | Limits                        |
| ------------------------------------------ | ------------ | ----------------------------- |
| Name of the hidden role / of everyone else | Agent / Crew | 1–20 chars, plain words       |
| Players needed to start                    | 4            | 3–15                          |
| Round length                               | 300 s        | 120–1800                      |
| Votes locked for the first                 | 60 s         | 0–600, shorter than the round |
| A vote stays open                          | 30 s         | 15–120                        |
| Votes each player may call                 | 1            | 1–5                           |
| Server-mute an ejected player              | on           |                               |

The role names are per-server so a server can call them `Impostor` and `Fed`. They
are restricted to letters, numbers, spaces, apostrophes and hyphens, so they cannot
carry a mention or markdown into messages.

## How it works

Everything is in `src/lib/server/game.ts` (rules, state, Discord side effects),
`activity-game.ts` (what the Activity may see and do) and `game-words.ts`.

- **State** is D1: `game_rounds`, `game_players`, `game_meetings`, `game_votes`,
  `game_settings`. A partial unique index allows one live round per voice
  channel and one open vote per round.
- **Every transition is a guarded update** (`WHERE status = …`, checked by the
  number of rows changed), so two clicks cannot both count: a double start deals
  once, two close attempts eject once, two end attempts post one result.
- **No sub-minute timer.** Anything overdue is resolved by whoever looks next:
  the Activity's poll (every 2.5 s), a button, or the minute sweep. The sweep
  (`sweep_game`, workflow preset `minute-game-sweep`) also closes stale lobbies,
  ends rounds in an emptied voice channel, applies a mute that had to wait for an
  ejected player to be in voice, and retries lifts Discord refused.
- **Secrets.** The server's view for a viewer carries their own role, and the word
  only if they are not the agent. Other players' roles are not sent until the round
  has ended. The word is never sent to the agent. During a vote it sends who has
  voted (`voted_ids`), never the targets.
- **What else the view carries** (for the Activity's roster): each player's avatar
  and whether they are in the round's voice channel and muted, read from the
  gateway's `live_voice_states` (what anyone in the channel already sees; an avatar
  is passed only if it is on `cdn.discordapp.com`); the round's settings; and the
  last vote's number and when it closed, so a result shows for a minute.
- **Discord gets** the lobby card, a line when a vote is called, the vote's
  outcome, and the result. `/play stop` and `/play status` are in Discord too.

## Honest limits

- It is an honour system. A player who is out can DM someone still playing, and
  no Discord permission prevents it.
- The Activity has to be open to play. A player who cannot open it can join the
  lobby but sees nothing of their role.
- A player who leaves the voice channel mid-round stays a player (they can come
  back); the round only ends if everyone leaves.
- Moderators above the bot's role cannot be muted, so an ejected moderator keeps
  their mic.

## Not yet

From the design in `planning/IDEAS.md`: the agent's take cooldown and cap, the
rest of the out treatment (the `Stream` deny, a bot role without `SEND_MESSAGES`,
a name marker), day & night format and its sub-minute scheduler, the agent guessing
the word to win, non-player spectating, custom word lists, and the Activity showing
a round's history.
