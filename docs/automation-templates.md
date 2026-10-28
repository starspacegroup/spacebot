# Automation templates

Admin → Automations → **Templates** lists ready-made automations. Pick one and
SpaceBot creates it as a normal automation, **switched off**, and opens it in the
editor. Choose its channel or role, check the message, then turn it on.

The catalog is `src/lib/automation/templates.ts`. A template has the same parts
the builder saves: trigger events, optional filters, and stacked actions. It also
lists what the admin must still choose (`setup`: `channel` or `role`).

## Rules

- A template never runs by itself. It is created disabled, so an unfinished one
  cannot post to a wrong channel or give a wrong role.
- A template may only use events, actions and filters that exist. A test checks
  every template against `DISCORD_EVENT_TYPES`, `ACTION_TYPES` and `FILTER_TYPES`.
- Using a template copies it. Editing the new automation does not change the
  template.

## Add one

Add an entry to `AUTOMATION_TEMPLATES`. Leave `channel_id: ''` or `role_ids: []`
where the admin must choose, and put `channel` or `role` in `setup`. The tests
fail if you forget.
