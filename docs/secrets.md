# Secrets

## Where they actually come from

`src/lib/secrets.ts` reads GCP Secret Manager and falls back to environment
variables. **On the production VM the fallback is the only path that has ever
run.** Two things independently prevent the Secret Manager path from working on
`instance-20260320-025632` (project `starspace-390723`):

1. `secretmanager.googleapis.com` is **not enabled** on the project.
2. The instance's service account has the default scopes and **not**
   `cloud-platform`, which Secret Manager access requires. Scopes cannot be
   changed on a running instance.

So production runs on the VM's `.env`. The loader used to report `✅ 0 secrets
from GCP` and carry on, which read like success; it now says plainly when Secret
Manager is unreachable for every secret.

## Checking what is configured

```bash
bun run secrets:status
```

Prints every managed secret as `set` / `PLACEHOLDER` / `MISSING`, where it came
from, and its length. **No values are printed** — length alone is enough to spot
a truncated paste. Exits non-zero if a required secret is unusable, so it works
as a health check.

Required means "its absence silently degrades the bot rather than crashing it":
`DISCORD_BOT_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Missing
either Cloudflare value leaves the DM assistant with **no tools at all** — it
cannot create events, read logs or answer anything about a server.

## Setting one on the VM, safely

SSH in, then:

```bash
# Prompted, not typed as an argument: keeps the value out of shell history,
# out of `ps` output, and out of any command log.
read -rs -p "CLOUDFLARE_API_TOKEN: " VALUE && echo

cd /path/to/spacebot
umask 077                                   # new file is 0600, not world-readable
grep -v '^CLOUDFLARE_API_TOKEN=' .env > .env.new
printf 'CLOUDFLARE_API_TOKEN=%s\n' "$VALUE" >> .env.new
mv .env.new .env
unset VALUE

chmod 600 .env && ls -l .env                # confirm 0600 and correct owner
bun run secrets:status                      # confirm it reads back as `set`
pm2 restart spacebot-gateway
```

Then watch it come up clean:

```bash
pm2 logs spacebot-gateway --lines 50 --nostream | grep -iE "MCP enabled|Required secrets"
```

Rules that matter more than the mechanics:

- **Never** pass a secret as a command argument — it lands in `~/.bash_history`
  and is visible in `ps` to every user on the box.
- **Never** commit one. `.env` is gitignored; `.env.example` holds names only.
- If a value has ever been pasted somewhere it shouldn't be, rotate it rather
  than hoping. Cloudflare tokens roll in seconds.

## Pushing from `.env` in bulk

`bun run secrets:setup` (dry run) / `--confirm` syncs `.env` → Secret Manager.
It **refuses to run** if any value is still a placeholder, because `.env` begins
life as a copy of `.env.example` and pushing `your_api_token` over a working
production secret would take the bot down on the next restart.

This is only useful once Secret Manager is actually provisioned — see below.

## If you want Secret Manager for real

It is not currently doing anything. Enabling it properly requires **stopping the
VM**, because service-account scopes are immutable while an instance runs:

```bash
PROJECT=starspace-390723
ZONE=us-east4-b
VM=instance-20260320-025632
SA=162339999710-compute@developer.gserviceaccount.com

gcloud services enable secretmanager.googleapis.com --project "$PROJECT"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor

# Downtime starts here — the bot goes offline until it is back up.
gcloud compute instances stop  "$VM" --zone "$ZONE" --project "$PROJECT"
gcloud compute instances set-service-account "$VM" --zone "$ZONE" \
  --project "$PROJECT" --service-account "$SA" --scopes cloud-platform
gcloud compute instances start "$VM" --zone "$ZONE" --project "$PROJECT"
```

Then create each secret from stdin (never as an argument):

```bash
read -rs -p "value: " V && printf %s "$V" | \
  gcloud secrets create CLOUDFLARE_API_TOKEN --data-file=- --project "$PROJECT"
unset V
```

Weigh it against retiring the VM entirely — see the Durable Objects discussion
in `planning/DECISIONS.md`. Moving to Workers replaces all of this with
`wrangler secret put` against the same store the Pages app already uses, which
is the split that caused this outage in the first place.
