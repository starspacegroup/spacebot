# Quorum — decisions that close themselves

`/quorum` puts a yes/no question to a server with one command. The question
closes itself at a deadline, posts a RESULT card naming an owner and a due
date, and nudges that owner once when the date arrives. Below quorum it says
"no quorum" instead of declaring a winner. The gap it fills over Discord's
native polls is the self-close, the quorum rule, and the posted, owned result.

Filed as [spacebot#84](https://github.com/starspacegroup/spacebot/issues/84).

## Commands

| Command                                                    | Who               | What                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/quorum ask question: closes: quorum: owner: due: class:` | anyone            | Posts the pinned card with Yes / No / Abstain and "Remind me before close". `closes` is a duration (`24h`, `90m`, `2d`); `quorum` the votes needed; `owner` a member or role (the asker if blank); `due` how long after closing the owner has (default 7d); `class` what kind of decision it is |
| `/quorum close [id]`                                       | asker or Crew     | Ends a question early. Without `id`, the latest open one in the channel                                                                                                                                                                                                                         |
| `/quorum results`                                          | anyone            | Reposts the channel's last RESULT card                                                                                                                                                                                                                                                          |
| `/quorum log`                                              | anyone, ephemeral | Past decisions, newest first, with their status: done, stale, open, no quorum, tie, vetoed                                                                                                                                                                                                      |
| `/quorum veto id: reason:`                                 | server owner      | Marks a decision vetoed, posts the reason on the result, logs it                                                                                                                                                                                                                                |
| `/quorum settings …`                                       | Crew              | Per-channel `closes` and `quorum` defaults; server-wide `footer`, `announce` channel and `protect` list; `lock` (owner only)                                                                                                                                                                    |

**Crew** is anyone with Manage Server or Manage Messages. Administrators always
qualify. The built-in's own enable/disable and permission gate come from the
usual built-in command override (Server Settings → Commands), like `/room`.

`/quorum` reaches a server the next time its command set is pushed to Discord:
saving any command, or Commands → Register, on that server's admin page. That
is the same path `/room` took (see the roadmap note from 2026-09-07).

## The round

1. `ask` writes the question row and replies with the card as the interaction's
   own message, so the channel shows who asked. The reply goes back at once;
   the card's message id is fetched afterwards via the webhook's `@original`
   and the card is pinned (`waitUntil`).
2. A button press records the vote and answers with `UPDATE_MESSAGE`, so the
   bar and counts change inside the same round trip. A second press changes the
   vote. Counts are recomputed from the vote rows on every press, so they always
   sum to the votes cast.
3. The minute sweep (`sweep_quorum`, a superadmin workflow preset beside the
   room reaper) closes anything past its deadline: it freezes the counts, deletes
   the vote rows, nulls the salt, disables the card's buttons, unpins it, posts
   the RESULT card, and mirrors it to the announce channel if one is set.
4. At the due date the sweep posts one "done?" in the channel the question was
   asked in, with Done / Not yet buttons the owner or Crew can press. An
   unanswered nudge goes stale after three days. There is no DM in this step.

"Remind me before close" is the one DM: a member who pressed it gets a message
15 minutes before the deadline. Those ids are kept only until the reminders go
out.

## Privacy

The database holds counts, never who voted.

- While a question is open, `quorum_votes` holds `HMAC-SHA256(salt, user_id)`
  with the current choice. The salt is per question and random.
- On close the vote rows are deleted and the salt is set to NULL, so the hashes
  could not be recomputed even if the rows had survived.
- `quorum_reminders` holds user ids for the reminder DM only — a thing the
  member asked for, unrelated to how they voted — and is emptied as the DMs go
  out, or on close.
- Nothing in the event log ties a user to a choice. The gateway's generic
  `BUTTON_CLICK` log records that a button was pressed, which it does for every
  button in every bot; the custom id names the question, not the choice's
  effect on any count. (Note that `custom_id` does contain the choice word.
  Servers that want zero trace should turn off button-click logging; this is
  the one place the choice passes through a log.)

## Results

A RESULT card always carries **Decision**, **Owner** and **Due**. Its footer is
the server's configured wording, "Advisory to the server owner" by default, so
no vote reads as binding on the owner. Below quorum the decision is "No
quorum"; a tie is "Tie — no result". Abstentions count toward quorum but not
toward the decision.

## Protected classes and veto

Some questions are never opened. `class` on `ask` tags the question, and a
class in the server's protected list — `owner-only`, `money`, `access`, `legal`
by default — is refused with an ephemeral "this is an owner decision". Crew edit
the list with `/quorum settings protect:`; the owner can `lock:` it.

Vetoing after the fact is for the rare case. It is declared up front (the
footer), public and reasoned (the reason is posted on the result and kept in
the log), and owner-only.

## Tables (migration 0069)

- `quorum_questions` — one row per question, open or settled: counts, timing,
  owner, status, result, follow-up state, and the result message id.
- `quorum_votes` — the uniqueness check while open. Gone on close.
- `quorum_reminders` — who asked for the reminder DM. Gone once sent.
- `quorum_settings` — per channel, with `channel_id = ''` as the guild default.

Code: `src/lib/server/quorum.ts` (commands, buttons, cards, the sweep), wired
from the interactions route and the cron route. Tests: `src/tests/quorum.test.ts`
run against the real migration in SQLite.
