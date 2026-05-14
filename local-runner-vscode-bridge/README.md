# SpaceBot Local Runner VS Code Bridge

This extension starts a localhost HTTP bridge for the SpaceBot local runner.

## Endpoints

- `POST /v1/discover` -> list workspace/editor context
- `POST /v1/open-workspace` -> open a file/folder/workspace
- `POST /v1/copilot-message` -> best-effort send message to chat panel

## Environment Variables

- `SPACEBOT_VSCODE_BRIDGE_PORT` (default `49372`)
- `SPACEBOT_VSCODE_BRIDGE_TOKEN` (optional; random token generated if omitted)

## Security

Only accepts requests from loopback and requires bearer token auth.
