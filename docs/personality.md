# /personality

Links to free online personality tests, for servers that want them. A built-in command, **off
until a server turns it on** (Commands, or Personality tests on the dashboard). SpaceBot only
links: it never runs a test or sees anyone's answers, and every reply says the quizzes are for
curiosity, not a diagnosis.

## What members can do

- `/personality list` shows every test this server shows, grouped by kind, names and links.
- `/personality list category:Autism & neurodiversity` shows one kind with a note on each test.
- `/personality find search:enneagram` finds a test by name or topic (`mbti`, `autism`, `kink`,
  `big five`, `attachment`...). Up to six results, best match first.

## The catalog

About forty tests in nine kinds: type & temperament (Myers-Briggs style, Enneagram, DISC,
socionics), Big Five & traits (including HEXACO), autism & neurodiversity (AQ, RAADS-R, CAT-Q,
Aspie Tests), relationships & intimacy (BDSM test, attachment style, love languages), dark
traits, career & strengths, values & politics, just for fun, and hubs with many more.

**Every test shows by default.** The BDSM test is marked 🔞. Paid tests are not listed. The list
is in `src/lib/server/personality-tests.ts`. Every link was opened and its title checked on
2026-11-19. Before adding one, or after a long gap, run `bun run check:personality-links`.

## What Manage Server can do

- `/personality hide test:BDSM Test` and `/personality show test:BDSM Test` choose which built-in
  tests appear. Give the full name if more than one matches.
- `/personality reset` shows every built-in test again. Own links are not touched.
- `/personality add name: link: [category:] [note:]` adds the server's own link (https only, a
  public site; no logins in the address, no local or private hosts). Up to 50.
- `/personality remove number:3` and `/personality manage` (what is hidden, and your links with
  their numbers).

Replies from these are visible only to the person who used them.

## Dashboard

`/admin/<server>/personality`: the on/off switch, a tick box for every test grouped by kind (All
and None per group, Show every test), and your own links (add, remove). Every write needs
Manage Server on that server, checked against Discord.

## Data

Migration `0102_personality_command.sql`: the command row (disabled), `personality_hidden`
(one row per hidden built-in test per server; none means it shows) and `personality_custom`.
