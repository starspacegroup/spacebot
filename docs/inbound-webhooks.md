# Incoming webhooks

An incoming webhook is a URL an outside service POSTs to. Each call fires the server's automations
that use the **Webhook received** trigger. (The older "webhooks" in the automation editor are
**outgoing**: endpoints an automation calls.) A server can have several; make one per sender so you
can turn one off or rotate its secret alone. Manage them at Admin → Settings → Incoming webhooks
(Manage Server only). Plan: `planning/INBOUND_WEBHOOKS_PLAN.md` in the workspace repo.

## Calling one

```
POST https://<host>/api/hooks/<public_id>
Authorization: Bearer sbw_...
Content-Type: application/json

{"title": "Deploy finished", "status": "ok"}
```

The secret is shown once at creation or rotation; only its SHA-256 hash is stored.

| Answer                                 | Meaning                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| 202 `{success, automations_triggered}` | Accepted                                                                       |
| 401                                    | Unknown hook, disabled hook, missing or wrong secret (one answer for all four) |
| 413                                    | Body over 64 KB                                                                |
| 429 + `Retry-After`                    | More than 60 calls in the current minute for this hook                         |

The accept/refuse rule is the proved core `dafny/WebhookGate.dfy` (compiled by
`node scripts/build-dafny.mjs` into `src/lib/server/generated/webhook-gate-core.js`; rerun it after
editing the `.dfy`). The wrapper is `src/lib/server/webhook-gate.ts`.

## Using it in an automation

Trigger: **Webhook received** (`WEBHOOK_RECEIVED`). Optional filter **Webhook name(s)**: comma-separated
names, empty means any. Variables in any action text:

- `{webhook.name}`: the hook's name
- `{webhook.body}`: the raw request text, first 2,000 characters
- `{webhook.title}`, `{webhook.data.user.name}`, `{webhook.items.0.id}`: fields of a JSON body

A missing path renders empty. Objects render empty. Strings, numbers and booleans render.

**Mentions are defused.** `@everyone`, `@here` and `<@...>` in sent text get a zero-width space, so a
caller cannot ping anyone. (An address like `a@here.com` also gets one, invisibly.) The log keeps the
hook name, size and top-level key names, not the payload.

## Plan limits

`max_inbound_webhooks`: Starter 3, Pro 25, Ultimate 25 (limits only; nothing charges). A stored
`server_plans.max_inbound_webhooks` overrides the tier default.

## For API keys and MCP

Scopes: `webhooks:read`, `webhooks:write` (set per key on the API keys page).

| REST                                     | MCP tool                        | Scope |
| ---------------------------------------- | ------------------------------- | ----- |
| `GET /api/v1/webhooks`                   | `list_inbound_webhooks`         | read  |
| `GET /api/v1/webhooks/:id`               | `get_inbound_webhook`           | read  |
| `POST /api/v1/webhooks`                  | `create_inbound_webhook`        | write |
| `POST /api/v1/webhooks/:id/rotate`       | `rotate_inbound_webhook_secret` | write |
| `PATCH /api/v1/webhooks/:id` `{enabled}` | `set_inbound_webhook_enabled`   | write |

Reads never include a secret. Create and rotate return it once, so over MCP it lands in the client's
chat history; rotate again if that matters. There is no delete: it breaks live senders, so it is a
dashboard action. Writes are logged as `API_WEBHOOK_CREATED` / `_ROTATED` / `_TOGGLED` under the key's name.
