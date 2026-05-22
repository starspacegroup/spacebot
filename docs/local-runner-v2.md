# Local Runner V2 (Typed Jobs)

This document covers the typed local-runner capabilities added for cross-platform host automation.

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

- `RUNNER_ALLOWED_PATHS=/path/one:/path/two`
- `RUNNER_ENABLE_SCREENSHOTS=1`
- `RUNNER_ENABLE_VSCODE_CONTROL=1`
- `RUNNER_ENABLE_COPILOT_CHAT=1`
- `RUNNER_MAX_ARTIFACT_BYTES=2000000`

## VS Code Bridge Setup

A companion extension scaffold is provided in:

- `local-runner-vscode-bridge/`

Bridge defaults:

- URL: `http://127.0.0.1:49372`
- Auth: bearer token from `SPACEBOT_VSCODE_BRIDGE_TOKEN`

Runner bridge settings:

- `RUNNER_VSCODE_BRIDGE_URL=http://127.0.0.1:49372`
- `RUNNER_VSCODE_BRIDGE_TOKEN=<token from extension output>`

## Screenshot Notes

- `mode=all_displays` captures desktop surface.
- `mode=per_display` is implemented as full per-display capture on Windows; other platforms currently fall back to single capture with a structured fallback reason in `result_json`.
- Optional workspace context can be included with `includeWorkspaceContext=true`.

## Artifact Retrieval

Artifact metadata and payload access endpoint:

- `GET /api/account/runners/artifacts/:id`
- `GET /api/account/runners/artifacts/:id?raw=1`

Artifacts are currently stored as inline base64 records in D1 (`local_runner_artifacts`).
