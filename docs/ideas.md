---
title: Idea box
layout: default
---

# Idea box

Anyone signed in with Discord can tell SpaceBot how to get better. Every idea keeps who sent
it and when. The superadmin reads them in one ranked list and decides what to build. An idea is
not a promise: nothing on the public page says an idea "will be built".

Plan and reasons: `planning/IDEA_BOX_PLAN.md` in the workspace repo. Code: `src/lib/db/ideas.ts`,
`src/lib/server/idea-scoring.ts`, `idea-intake.ts`, `idea-ai.ts`, `idea-command.ts`,
`src/routes/ideas/`, `src/routes/admin/superadmin/ideas/`. Migrations 0095 (tables) and 0096
(the command).

## Sending

- **The page, `/ideas`** (footer link). Sign in with Discord first; there are no anonymous
  ideas. The form has the idea (20 to 2000 characters), an optional title and one area. The same
  page lists the sender's own ideas with their status.
- **The command, `/idea text:…`**, built in, on for every server, no permission gate. It also
  takes an optional `area` and `title`. The reply is private ("Saved") and mentions are off. The
  idea carries the server it was sent from. A server owner can switch the command off on the
  Commands page like any built-in.

Both go through `submitIdea`, so the rules are the same:

- Signed-in senders only; a blocked sender gets "Ideas are closed for this account".
- One idea a minute and ten a day per person (`consumeQuota`, group `idea`).
- The same text from the same person within a day is saved once, and the sender is told "Saved"
  either way.
- Text is stored as plain text: HTML, mentions and links are never rendered. Control characters
  are stripped.

## Statuses, and what the sender sees

`new` → `reviewing` → `planned` → `shipped`, or `declined`, or `duplicate`. The sender sees only
the status, worded as: Received, Being looked at, Planned, Shipped, Not planned for now, Already
suggested. They never see the superadmin's note, scores or AI draft.

## How the ranking works

**score = impact (1–5) × reach (1–5) × confidence (50, 80 or 100 %) ÷ effort in days.**
Effort is a size: XS 0.5, S 1, M 3, L 8, XL 20 days. A small change that helps many people ranks
above a big change that helps a few. Example: 4 × 5 at 80 % that takes a day scores 16; 5 × 2 at
80 % that takes 8 days scores 1. Scores keep two decimals (the lowest real score is 0.025, which
one decimal would round to 0 and make look unscored).

Two sets of numbers sit side by side:

- **AI draft** (`ai_*` columns): when an idea arrives, after it is saved, the model gives a
  one-sentence summary, the four numbers with a short reason, a risk flag (billing, privacy,
  member data) and likely duplicates among the open ideas. It uses the same Workers AI transport
  as the listing drafter (`callAI`), is given a short fixed brief about the product
  (`PRODUCT_BRIEF` in `idea-ai.ts`, keep it true) and the idea inside marked delimiters, told it
  is data. Its reply is clamped to the allowed ranges before it is stored. A slow, failing or
  confused model leaves the idea saved with no draft; it never shows the sender an error. The
  superadmin can ask for a new draft from the detail panel.
- **Final** (`impact`, `reach`, `effort`, `confidence`): the superadmin's call. Once all four are
  set, the rank uses them; until then it uses the AI draft and the row is marked **AI**.

`score` and `score_source` (`admin`, `ai` or empty) are stored on the row so the list sorts on an
index. They are recomputed whenever a draft or a review is saved (`rerank`).

## The superadmin screen

Superadmin → **Ideas** (`/admin/superadmin/ideas`). Only superadmins; every action checks again.

- Counts: new this week, waiting for your score, planned, shipped.
- Filters: status (default new and reviewing), area, effort, needs my score, has duplicates, text
  search; sort by best score or newest. Filters stay in the address.
- A row: score (with an AI mark for a draft), title, effort, impact × reach, area, sender and
  date, status. Quick actions on a row: set the effort, decline or reopen.
- The detail panel: full text, sender (link to the user), the AI draft with its reasons and
  duplicate suggestions, the four score controls, status, a note only you see, "repeats…" for a
  duplicate, "where it shipped" for a shipped idea. `j` and `k` step through the list.
- On a phone the list collapses to cards and an open idea fills the screen.
- **Blocked senders**: one button on an idea stops that person sending; the list of blocked
  senders is at the bottom with an "Allow again" button.
- **Remove their name** clears the sender's ID and name from one idea and keeps the text.

## Privacy and retention

The form and the command reply say what is kept: Discord name and ID, the server (command only)
and the time. The privacy page has a section (3.8) and a retention line in both languages.
Only the superadmin can read ideas. The text may go to Workers AI for the draft.

Today an idea is kept until the sender asks for their name to be removed; then the superadmin
uses **Remove their name**. **Not built:** the automatic rule from the plan (keep 12 months after
shipped or declined, then clear the name). Add it as a sweep when ideas pile up.

## Not built yet

- Votes, a public "what people are asking for" page, and a "reviewer" role (David, 2026-11-07:
  no voting for now, superadmin only).
- The weekly digest message.

## Command slots

Discord allows 100 slash commands per server and each one counts, so `/idea` takes one. On
2026-11-07 the most commands any production server had was 4 custom ones plus 5 built-ins, so
nobody is near the limit. The sync sends the whole list in one bulk replace, so a server that did
reach 100 would fail to sync until it removed a command (the error shows in `guild_command_sync`).
