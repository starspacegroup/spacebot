# Local Runner V2 (Typed Jobs)

This document covers the typed local-runner capabilities added for cross-platform host automation.

## Standalone Binary (Linux)

The runner can be compiled into a single self-contained binary (Bun runtime, TUI, and the
opentui native library are all embedded — no checkout or `bun install` needed on the target
machine):

- `bun run runner:build` — produces `dist/spacebot-runner` (`bun build --compile`, target `bun-linux-x64`).
- `bun run runner:install` — builds and installs to `~/.local/bin/spacebot-runner`.
- `spacebot-runner --version` — prints the version and whether it is a compiled build.
- `spacebot-runner --headless` — headless mode, same as `bun run runner:headless`.

Compiled builds disable the source code-watcher (there is no checkout to watch), and the
TUI/autostart service re-exec the binary itself instead of `bun run`.

## Runner Home (first-run setup)

On first launch the runner asks where its **home directory** should live (default
`~/SpaceBot`; headless launches fall back to the default silently). The choice is persisted
in `~/.config/spacebot/runner-home.json` and can be overridden with `SPACEBOT_RUNNER_HOME`.

The home is the runner's persistent workspace, all plain markdown:

| Path | Purpose |
| --- | --- |
| `README.md` | Explains the layout and how to interact. |
| `SYSTEM.md` | What the runner knows about the machine. The block between the auto markers is rewritten on every start; notes outside it are preserved. A legacy `~/.spacebot/SYSTEM.md` is migrated automatically. |
| `MEMORY.md` | One-line index of stored memories. |
| `memory/` | One markdown file per remembered fact. |
| `journal/YYYY-MM-DD.md` | Daily activity log: connections, jobs, detected system changes (new tools, displays, OS upgrades, …). |
| `inbox/` | Markdown interaction (see below). |
| `outbox/` | Runner-initiated notes. |
| `.state/` | Internal bookkeeping (profile cache, inbox hashes). Safe to delete. |

The system profile is re-gathered on every start and diffed against the cached one, so the
runner's knowledge of the machine keeps accumulating; changes land in the journal. Stored
memories and the system summary are injected as context into `dm` jobs and inbox answers.

## Markdown Inbox

Drop any `.md` file into `<home>/inbox/` while the runner is running (headless, or the
TUI's runner child):

- The runner appends a `## SpaceBot Response (timestamp)` section to the same file within
  a few seconds — edit the file again below the response to continue the thread.
- A file whose first line is `remember: <title>` is stored under `memory/` and indexed in
  `MEMORY.md` instead of being answered.
- Answers go through the SpaceBot server assistant when a runner token is configured, and
  fall back to the local provider chain (Ollama/Copilot) with memory context otherwise.

> **Default local LLM:** the runner defaults to **Ollama** with the **`gemma3:4b`** model
> (`localhost:11434`) when nothing is configured — just run `ollama pull gemma3:4b` and start the
> runner. Override with `OLLAMA_MODEL` / `OLLAMA_HOST` / `OLLAMA_PORT`, force a provider with
> `SPACEBOT_LLM_PROVIDER=ollama|copilot`, or pick a model in the TUI. (The dashboard/gateway DM AI
> separately uses Workers AI in production; set `AI_PROVIDER=ollama` in local `.env` to use Ollama there too.)

## Startup Experience

- `bun run runner` now opens an interactive OpenTUI dashboard when launched from a real terminal.
- If `SPACEBOT_RUNNER_TOKEN` is missing, press `k` in the dashboard to negotiate a token from the production site.
- The negotiation flow opens your browser to `/api/account/runners/negotiate`, reuses your logged-in website session, creates a runner token, and sends it back to a localhost callback.
- On first interactive launch, the runner checks for an existing auto-start entry on the current machine:
	- Linux: user-level `systemd` service
	- macOS: `LaunchAgent`
	- Windows: Startup folder entry
- If none is present, the TUI offers three paths:
	- install auto-start now
	- skip for this session
	- don't ask again
- Installed auto-start entries persist the current `SPACEBOT_*` and `RUNNER_*` environment variables so the runner can reconnect without a shell profile.
- Headless contexts still work by launching `bun run runner:headless` or `bun run scripts/local-runner/index.ts --headless`.

## Supported Job Types

- `shell_command` (legacy default)
- `system_profile`
- `screenshot_capture`
- `vscode_discover_instances`
- `vscode_open_workspace`
- `vscode_send_copilot_message`

## Required Runner Environment

- `SPACEBOT_RUNNER_TOKEN=sbr_...`
- `SPACEBOT_API_URL=https://spacebot.starspace.group` (or local environment)

## Optional Security/Feature Flags

- `SPACEBOT_RUNNER_HOME=/path/to/home` (overrides the persisted runner-home choice)
- `RUNNER_ALLOWED_PATHS=/path/one:/path/two`
- `RUNNER_ENABLE_SCREENSHOTS=1`
- `RUNNER_ENABLE_VSCODE_CONTROL=1`
- `RUNNER_ENABLE_COPILOT_CHAT=1`
- `RUNNER_MAX_ARTIFACT_BYTES=8000000`

## VS Code Bridge Setup

A companion extension scaffold is provided in:

- `local-runner-vscode-bridge/`

Bridge defaults:

- URL: `http://127.0.0.1:49372` (falls back to next free port in `49372-49420`)
- Auth: bearer token from `SPACEBOT_VSCODE_BRIDGE_TOKEN`

Runner bridge settings:

- `RUNNER_VSCODE_BRIDGE_URL=http://127.0.0.1:49372`
- `RUNNER_VSCODE_BRIDGE_URLS=http://127.0.0.1:49372,http://127.0.0.1:49373,...` (optional explicit multi-window list)
- `RUNNER_VSCODE_BRIDGE_TOKEN=<token from extension output>`
- `RUNNER_VSCODE_BRIDGE_PORT_RANGE=49372-49420` (bridge scan range used by discover/open/chat jobs)

`vscode_send_copilot_message` payload supports:

- `conversationKey` (string) to keep local Copilot context between messages
- `includeResponse` (boolean) to return response text back to the DM flow
- `mirrorToChat` (boolean, default true) to keep prompts visible in normal VS Code chat UI
- `timeoutMs` (number) for the model request timeout when `includeResponse=true`

## Screenshot Notes

- `mode=all_displays` captures desktop surface.
- `mode=per_display` is implemented as full per-display capture on Windows; other platforms currently fall back to single capture with a structured fallback reason in `result_json`.
- Optional workspace context can be included with `includeWorkspaceContext=true`.

## Artifact Retrieval

Artifact metadata and payload access endpoint:

- `GET /api/account/runners/artifacts/:id`
- `GET /api/account/runners/artifacts/:id?raw=1`

Artifacts are currently stored as inline base64 records in D1 (`local_runner_artifacts`).
