# Plan: SpaceBot as an interface to Dirac

**Status: plan, not implemented** (2026-07-12). Goalposts, David's words: the local
runner connects into the Dirac Claude system ("I tell it where to look, and it
should kinda find it on its own"), then SpaceBot becomes talkable in VC like
Dirac — but multi-user aware: mostly listens, knows who is speaking, and only
takes commands from allowed people.

## What we're building on (verified 2026-07-12)

- **SpaceBot local runner** (`scripts/local-runner/`): WebSocket to the server,
  `sbr_` token auth, job types (`shell_command`, `system_profile`, …), path
  allowlist, runner home `~/SpaceBot` with markdown memory/journal/inbox. DM AI
  already orchestrates runners via tools (`start_local_runner_task` etc.),
  target user pinned to the authenticated session.
- **Dirac voice stack** (`~/_Workbench/dirac/.claude/patches/discord-voice.patch`
    - reusable `~/_Projects/dirac-voice/src/{stt,tts}.ts`): per-user opus streams
      from Discord, whisper.cpp STT (`ggml-small.en`), Piper TTS, fast-path haiku,
      typing-burst UX. Single-speaker by design today (drops non-owner audio).
- **Key physics**: Discord's voice receiver is _per-user_ — speaker identity is
  the Discord user ID on the stream. No voiceprints needed, identity is exact.
- SpaceBot has **no Anthropic/Claude integration** anywhere yet; its AI is CF
  Workers AI / Ollama. Dirac is reachable only on David's machine.

## Architecture in one paragraph

A new **Dirac provider** lives in the local runner: the runner discovers the
Dirac Claude system on its machine and exposes it to SpaceBot as a first-class
capability (like `shell_command`, but "ask Dirac"). A new **voice worker** —
co-located with the runner on the machine that has whisper/piper — joins VC as
SpaceBot, transcribes _all_ speakers with exact identity, stays passive until
addressed, and routes commands from allowlisted speakers either to the cheap
fast-path or through the Dirac provider for real work. SpaceBot's server stays
the control plane (allowlists, config, logging in D1); all heavy audio/AI stays
local.

## Phase 1 — Dirac provider in the local runner

New job type `dirac_prompt` + runner-side provider module.

1. **Discovery** (the "find it on its own" requirement), tried in order:
    - Explicit hint: `SPACEBOT_DIRAC_HOME` env / `~/.config/spacebot/dirac.json`
      (`{"home": "~/_Workbench/dirac"}`) — David "telling it where to look."
    - Probe: `claude` binary on PATH; `~/.claude/` exists; loopback ports
      47741/47742 listening (Dirac's Amy-watch + voice locks = a live Dirac
      plugin instance); well-known repo path `~/_Workbench/dirac` with the LARA
      CLAUDE.md. Any hit → record what was found (binary, repo, live session)
      into the runner's `SYSTEM.md` and report upstream in the machine profile.
2. **Invocation modes**, picked per request:
    - `headless` (default): `claude -p` in the dirac repo cwd — same pattern as
      the dream/news timers. Stateless, safe, parallel-friendly.
    - `session` (later): deliver into the live dirac session for continuity —
      needs a delivery mechanism; candidates: a files-based inbox the session
      polls via hook, or the remote-control channel if an API appears. Punt
      until headless proves insufficient.
3. **Authority**: `dirac_prompt` jobs accepted only when the requesting user ID
   (pinned server-side from the session) is in the runner's new
   `dirac_allowed_users` config — default: David's ID only. Server-side, the
   tool is superadmin-gated at first. Runner refuses otherwise, logs the
   attempt to its journal (mirrors the pairing-watch pattern).
4. **Safety**: prompt + response logged to runner journal; `--dangerously-skip-
permissions` NOT used — headless runs get a constrained permission mode and
   the dirac repo cwd; Amy's PreToolUse hook stays active in those runs.

Milestone: from SpaceBot DM, "ask Dirac what's in its backlog" returns a real
answer produced by `claude -p` on this machine.

## Phase 2 — Voice worker: SpaceBot in VC, room-aware

New process `scripts/voice-worker/` (bun), managed/launched by the runner,
using SpaceBot's bot token + `@discordjs/voice`. Reuses `dirac-voice`
`stt.ts`/`tts.ts` (whisper.cpp + Piper — different Piper voice so SpaceBot ≠
Dirac's voice). Runs only on a machine whose runner has the binaries (probe at
startup, advertise `voice_capable: true` in the machine profile).

1. **Hear everyone**: subscribe to every speaking user's stream (not just one
   owner). Each utterance → `{userId, username, text, ts}`. Rolling room
   transcript (last ~5 min) kept in memory as conversation context.
2. **Passive by default**: nothing is spoken unless addressed. Addressing =
   wake name ("SpaceBot", configurable per guild) anywhere in the utterance,
   OR a direct follow-up within N seconds of SpaceBot's last reply by the same
   speaker (conversational continuation window).
3. **Authority tiers** (D1 table `voice_commanders`, managed in dashboard):
    - `commander` — can command (David + whoever he adds).
    - `conversational` — can get answers to harmless questions, no actions.
    - everyone else — transcribed for context only; if they address SpaceBot,
      one polite deflection ("that's up to David"), then silence.
      Identity is the stream's Discord user ID — no spoofing surface.
4. **Routing**: addressed utterance from a commander → intent split (same
   ESCALATE pattern as Dirac's fast-path): small talk/quick facts → local
   fast-path (Ollama or haiku); anything needing tools/state/actions →
   `dirac_prompt` through Phase 1, reply TTS'd back into the VC.
5. **Etiquette**: no barge-in — queue replies until the room has a gap; hard
   cap on unsolicited speech (zero); privacy switch `/spacebot voice pause`
   (and a commander voice command "stop listening") that drops all streams.

Milestone: three people in a VC; SpaceBot ignores the chatter, answers only
when named, refuses commands from non-commanders by name, and executes a
Dirac-backed command from David.

## Activation model — "Dirac takeover mode" (David, 2026-07-14)

Refinement of the goal: beyond SpaceBot being _backed by_ Dirac (its own persona,
routing heavy work to `dirac_prompt`), David wants an explicit mode where SpaceBot
**becomes Dirac** for a specific VC session he switches on — Dirac's persona, Dirac's
voice, full session behavior — not SpaceBot-with-a-Dirac-backend. Two distinct
operating modes on the same voice worker:

- **SpaceBot mode** (default, Phase 2): SpaceBot's own name/voice, passive, routes
  commander commands to Dirac headless. Multi-user, community-facing.
- **Dirac takeover mode** (opt-in, per session): David explicitly activates it
  ("SpaceBot, be Dirac" in VC, a `/spacebot dirac on` command, or a DM toggle).
  For that session the worker uses Dirac's Piper voice + persona and routes **all**
  commander utterances through the Dirac provider in **session mode** (live
  continuity, not stateless `claude -p`), so it behaves like Dirac is in the room.
  Ends on explicit "back to SpaceBot" / session leave / runner drop.

**Preconditions (hard gates), all required to enter takeover mode:**

1. The local runner is running on the Dirac machine and its Dirac provider probe
   succeeded (binary + repo + a live session/loopback locks). No runner → mode
   unavailable, worker says so and stays in SpaceBot mode.
2. The activator is a `commander` (David only, by default) — verified by Discord
   user ID off the voice stream, same authority check as everything else here.
3. Explicit per-session activation only — never automatic, never sticky across
   sessions. Default is always SpaceBot mode.

**Implications this surfaces for the phased build:**

- Takeover mode makes **session-mode Dirac delivery a first-class requirement**,
  not the Phase 3 "punt" it is under the headless-first plan — being Dirac in a
  live conversation needs continuity across turns. Headless `claude -p` still
  serves SpaceBot mode; takeover needs the live-session delivery path (files-based
  inbox the session polls, or a remote-control API if one appears).
- Voice identity stays SpaceBot's bot token even in takeover mode (SpaceBot is the
  Discord presence); only the _voice model + persona + routing_ change. Don't run
  two gateways on Dirac's bot token (decision point 2 below).
- Amy still applies: takeover-mode commander utterances run through the same
  PreToolUse hook path as any Dirac work — impersonating the persona doesn't
  bypass the limbic gate.

Status: still plan-only. This section refines the target; the phase order below is
unchanged except that **session-mode delivery graduates from Phase 3 to a Phase 2.5
prerequisite for takeover mode** (SpaceBot mode can ship on headless first).

## Phase 3 — Tighten and integrate

- Persist room transcripts (opt-in per guild) to D1 for recall ("what did we
  decide earlier?").
- Session-mode Dirac delivery (live session continuity instead of headless).
- Amy hook on the voice path: pipe commander utterances through the same
  stress/threat patterns; log to amygdala.log so the scorecard sees real traffic.
- Latency work: stream whisper on 2-3s windows instead of end-of-utterance;
  pre-render common ack phrases per SpaceBot's voice (the phrase-cache idea
  already noted in memory).

## Decision points (flag before building)

1. **Where does the gateway/voice run?** Voice worker must be on the machine
   with whisper/piper (Dirac). If the main gateway bot runs elsewhere, the
   voice worker is a _second_ gateway connection with the same token but only
   voice intents — verify Discord allows the concurrent session cleanly
   (sharding/session limits) or fold voice into the existing gateway process
   if it's co-located anyway.
2. **Token identity**: SpaceBot speaks as SpaceBot (its token), not as Dirac's
   bot — two bots can share a VC; Dirac's 47742 lock is per-plugin and won't
   conflict, but never run both against the same bot token.
3. **Cost/quiet**: fast-path model choice (Ollama gemma vs haiku) decides
   whether idle chatter costs API tokens. Default Ollama, escalate to Claude
   only for commander work.

## Non-goals (for now)

- Voiceprint/speaker-diarization ML — unnecessary; Discord gives exact identity.
- SpaceBot acting on Dirac for anyone but David — multi-tenant Dirac access is
  explicitly out until the single-user path is boringly reliable.
- Wake-word DSP (always-on hotword detection on raw audio) — utterance-level
  name matching in transcripts is enough at this latency.

## Cross-references

- Dirac side: `~/_Workbench/dirac` CLAUDE.md (LARA, Amy, voice patch);
  reusable audio: `~/_Projects/dirac-voice/src/`.
- Runner docs: `docs/local-runner-v2.md` in this repo.
