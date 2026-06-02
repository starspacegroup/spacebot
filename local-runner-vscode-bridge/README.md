# SpaceBot Local Runner VS Code Bridge

This extension starts a localhost HTTP bridge for the SpaceBot local runner.

## Endpoints

- `POST /v1/discover` -> list workspace/editor context
- `POST /v1/open-workspace` -> open a file/folder/workspace
- `POST /v1/copilot-message` -> send prompt to chat panel and optionally return a model response

`/v1/copilot-message` request body:

- `message` (string, required)
- `mirrorToChat` (boolean, default `true`) - open Copilot Chat UI with the message
- `includeResponse` (boolean, default `false`) - also run a local model request and return text
- `conversationKey` (string, optional) - preserves context between calls for response mode
- `timeoutMs` (number, optional) - request timeout for response mode

## Environment Variables

- `SPACEBOT_VSCODE_BRIDGE_PORT` (default `49372`)
- `SPACEBOT_VSCODE_BRIDGE_PORT_RANGE` (default `49372-49420`)
- `SPACEBOT_VSCODE_BRIDGE_TOKEN` (optional; random token generated if omitted)

If the preferred port is occupied, the bridge tries the configured range and binds the first free port.
When no token env var is set, the extension persists one in VS Code global state and reuses it across windows.

## Security

Only accepts requests from loopback and requires bearer token auth.
