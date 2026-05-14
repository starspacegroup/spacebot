# Local Runner V2 (Typed Jobs)

This document covers the typed local-runner capabilities added for cross-platform host automation.

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
