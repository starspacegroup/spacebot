# Cloudflare Pages Deployment Guide

This guide walks you through deploying SpaceBot to Cloudflare Pages from the GitHub repository.

## Prerequisites

- A GitHub account with access to this repository
- A Cloudflare account ([sign up free](https://dash.cloudflare.com/sign-up))
- A Discord Application ([create one](https://discord.com/developers/applications))

## Step 1: Prepare Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Note down these values (you'll need them later):
    - **Application ID** (from General Information)
    - **Public Key** (from General Information)
    - **Client Secret** (from OAuth2 → General)
    - **Bot Token** (from Bot section)

### Configure Discord Bot

1. Go to the **Bot** section
2. Click "Reset Token" to get your bot token (save it securely!)
3. Enable these intents if needed:
    - Server Members Intent (optional)
    - Message Content Intent (optional)

### Configure OAuth2

1. Go to **OAuth2** → **General**
2. Add redirect URLs:
    - `https://your-project-name.pages.dev/api/auth/discord/callback`
    - (Replace `your-project-name` with your actual Cloudflare Pages URL)

## Step 2: Deploy to Cloudflare Pages

### Connect GitHub Repository

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages**
3. Click **Create application** → **Pages** → **Connect to Git**
4. Authorize Cloudflare to access your GitHub account
5. Select the **starspacegroup/spacebot** repository
6. Click **Begin setup**

### Configure Build Settings

Enter the following build configuration:

- **Project name**: `spacebot` (or your preferred name)
- **Production branch**: `main` (or your default branch)
- **Build command**: `bun run db:migrate:smart && bun run build`
- **Build output directory**: `.svelte-kit/cloudflare`
- **Root directory**: `/` (leave empty)

### Set Environment Variables

Click on **Environment variables** and add the following:

| Variable Name           | Value                       | Notes                                            |
| ----------------------- | --------------------------- | ------------------------------------------------ |
| `DISCORD_PUBLIC_KEY`    | Your Discord public key     | From Discord Developer Portal                    |
| `DISCORD_CLIENT_ID`     | Your Discord application ID | From Discord Developer Portal                    |
| `DISCORD_CLIENT_SECRET` | Your Discord client secret  | From OAuth2 settings                             |
| `DISCORD_BOT_TOKEN`     | Your Discord bot token      | From Bot settings                                |
| `ADMIN_USER_IDS`        | Your Discord user ID(s)     | Comma-separated list for multiple admins         |
| `CLOUDFLARE_API_TOKEN`  | Your Cloudflare API token   | Needs D1 edit permissions for auto-migrations    |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID  | Required for D1 migrations during build          |
| `BUN_VERSION`           | `1.2`                       | Tells Cloudflare Pages to use Bun as the runtime |

Optional roadmap integrations:

| Variable Name                       | Purpose                                     |
| ----------------------------------- | ------------------------------------------- |
| `PUBLIC_SUPPORT_DISCORD_URL`        | Public support server CTA                   |
| `PUBLIC_BOT_VOTE_URL`               | Public voting CTA                           |
| `PUBLIC_BOT_REVIEW_URL`             | Public review CTA                           |
| `SENTRY_DSN`                        | Enables Sentry client/server error tracking |
| `SENTRY_ENVIRONMENT`                | Sentry environment tag                      |
| `SENTRY_TRACES_SAMPLE_RATE`         | Sentry trace sample rate                    |
| `RATE_LIMIT_ENABLED`                | Enables D1-backed API rate limiting         |
| `RATE_LIMIT_DEFAULT_WINDOW_SECONDS` | Default API rate-limit window               |
| `RATE_LIMIT_DEFAULT_MAX_REQUESTS`   | Default max API requests per window         |

HTTP/3 is a Cloudflare zone-level setting. See `docs/http3.md` and verify with `bun run verify:http3 -- https://your-domain.example`.

**How to get your Discord User ID:**

1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click your username in Discord
3. Click "Copy User ID"

### Deploy

1. Click **Save and Deploy**
2. Wait for the build to complete (usually 2-3 minutes)
3. Once deployed, note your Cloudflare Pages URL (e.g., `https://spacebot.pages.dev`)

## Step 3: Configure Discord Interactions Endpoint

1. Go back to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Go to **General Information**
4. Find **Interactions Endpoint URL**
5. Enter: `https://your-project-name.pages.dev/api/discord/interactions`
    - Replace `your-project-name` with your actual Cloudflare Pages URL
6. Click **Save Changes**

Discord will verify the endpoint by sending a test request. If configured correctly, you'll see a success message.

## Step 4: Register Discord Commands

You need to register slash commands with Discord. You can do this locally or via Cloudflare Workers:

### Option A: Register Locally

```bash
# Clone the repository
git clone https://github.com/starspacegroup/spacebot.git
cd spacebot

# Install dependencies
bun install

# Register commands
DISCORD_CLIENT_ID=your_client_id DISCORD_BOT_TOKEN=your_bot_token bun scripts/register-commands.ts
```

### Option B: Register via Cloudflare Worker

Create a temporary Cloudflare Worker to register commands:

```javascript
export default {
	async fetch(request, env) {
		const commands = [
			{ name: 'ping', description: 'Check if the bot is responsive', type: 1 },
			{ name: 'stats', description: 'View bot statistics', type: 1 },
			{ name: 'help', description: 'Get help with bot commands', type: 1 },
		];

		const url = `https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/commands`;

		const response = await fetch(url, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
			},
			body: JSON.stringify(commands),
		});

		return new Response(await response.text(), { status: response.status });
	},
};
```

## Step 5: Invite Bot to Your Server

1. Go to Discord Developer Portal → Your Application → **OAuth2** → **URL Generator**
2. Select scopes:
    - ✅ `bot`
    - ✅ `applications.commands`
3. Select bot permissions as needed:
    - ✅ Send Messages
    - ✅ Use Slash Commands
    - ✅ (Add others as needed)
4. Copy the generated URL
5. Open the URL in your browser
6. Select a server and authorize the bot

## Step 6: Test Your Bot

1. Go to your Discord server
2. Type `/` to see available commands
3. Try `/ping` - the bot should respond with "Pong! 🏓"
4. Visit your Cloudflare Pages URL to see the web dashboard

## Automatic Deployments

Cloudflare Pages automatically deploys your site when you push to the configured branch:

- **Push to main branch** → Deploys to production
- **Push to other branches** → Creates preview deployments

The AI queue consumer worker is deployed separately by GitHub Actions on every push to `main`.

Workflow file:

- `.github/workflows/deploy-orchestrator-worker.yml`

Required GitHub repository secrets for this workflow:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `ORCHESTRATOR_SPACEBOT_API_BASE` (for example `https://spacebot.pages.dev`)
- `AI_AUTOPILOT_INTERNAL_KEY` (must match the same value configured in Cloudflare Pages)

Recommended rollout for first enablement:

1. Deploy Pages with the new API routes and queue producer binding.
2. Deploy the orchestrator worker and confirm queue consumption is healthy.
3. Set `DM_AUTOPILOT_ENABLED=true` in Pages.

### Durable workflow runs queue (one-time setup)

Superadmin workflow runs execute as Cloudflare Workflow instances driven
through the `spacebot-workflow-runs` queue. The queue must exist **before**
the orchestrator worker deploys (a consumer binding for a missing queue fails
the deploy):

```bash
bunx wrangler queues create spacebot-workflow-runs
```

The worker also needs the `CRON_SECRET` secret (same value as the Pages app)
to call the run advance/fail endpoints. To disable durable execution anywhere
(runs execute inline instead), set `WORKFLOW_DURABLE_EXECUTION=false` on the
Pages app.

Database migrations run automatically during builds only when migration SQL files changed in the commit (before the SvelteKit build step). Set `DB_MIGRATE_FORCE=1` to force migrations regardless of git diff. If a migration fails, the build will fail and the deploy will be blocked.

## Troubleshooting

### Interactions Endpoint Verification Failed

- Ensure `DISCORD_PUBLIC_KEY` environment variable is set correctly
- Check Cloudflare Pages build logs for errors
- Verify the endpoint URL is correct and accessible

### Bot Not Responding to Commands

- Ensure commands are registered (run the register script)
- Check that the bot is online and invited to your server
- Verify the bot has necessary permissions in your server

### OAuth Login Not Working

- Check that OAuth redirect URL is added in Discord Developer Portal
- Verify `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set correctly
- Ensure the redirect URL matches your Cloudflare Pages domain

### Build Failures

- Check Cloudflare Pages build logs in the dashboard
- Ensure all dependencies are in `package.json`
- Verify Node.js version compatibility

## Viewing Logs

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Select your project
3. Go to **Functions** tab to view real-time logs
4. Use `console.log()` in your code for debugging

## Custom Domain (Optional)

1. Go to your Cloudflare Pages project
2. Click **Custom domains**
3. Add your domain
4. Update DNS records as instructed
5. Update Discord OAuth redirect URL with your custom domain

## Gateway Bot (Production)

The Discord gateway bot and Cloudflare production tunnel run as long-lived processes on your server, managed by **PM2** using **Bun** as the runtime. The startup script automatically installs missing dependencies (cloudflared, pm2).

### Prerequisites

- [Bun](https://bun.sh/) installed (`curl -fsSL https://bun.sh/install | bash`)
- On Windows: [winget](https://learn.microsoft.com/en-us/windows/package-manager/) (for auto-installing cloudflared)
- On macOS: [Homebrew](https://brew.sh/) (for auto-installing cloudflared)
- On Linux: `apt` with `lsb_release` (for auto-installing cloudflared)

PM2 and cloudflared are installed automatically by the startup script if not already present.

### Install Dependencies

```bash
bun install
```

### Environment Variables & Secrets

Secrets can be managed two ways:

**Option A: `.env` file (simple, single-server)**

Ensure a `.env` file exists in the project root with at least:

```
DISCORD_BOT_TOKEN=your_bot_token
API_BASE=https://your-production-url.pages.dev
```

**Option B: GCP Secret Manager (scalable, multi-instance)**

For production on GCP, secrets are loaded from Secret Manager automatically:

```bash
# 1. Enable the API
gcloud services enable secretmanager.googleapis.com

# 2. Grant your VM's service account access
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:YOUR_SA@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 3. Push secrets from your local .env to GCP (dry run first)
bun run secrets:setup:dry
bun run secrets:setup
```

When running on a GCP instance, secrets are fetched from Secret Manager at startup. If GCP is unavailable (e.g., local dev), it falls back to `.env` / `process.env` automatically.

### Production Tunnel Setup (One-Time)

The production environment uses a Cloudflare tunnel to expose the server at `https://spacebot.starspace.group`.

```bash
# Authenticate with Cloudflare (one-time)
cloudflared tunnel login

# Create the tunnel
cloudflared tunnel create spacebot

# Configure DNS routing
cloudflared tunnel route dns spacebot spacebot.starspace.group
```

Then create or update `~/.cloudflared/config.yml` to include the `spacebot` tunnel configuration, pointing to your local production service (e.g., `http://localhost:4269`).

### Start Production

```bash
bun run gateway
```

This runs `scripts/prod-start.ts` which:

1. Checks for `cloudflared` and installs it if missing
2. Checks for `pm2` and installs it if missing
3. Starts `spacebot-gateway`, `spacebot-tunnel`, `spacebot-deploy`, and `spacebot-cron` via PM2

`spacebot-cron` is required for scheduled jobs (hourly aggregation, daily refresh, and scheduled message delivery). The Discord gateway process does not run these cron jobs directly.

After startup, verify all four processes are online:

```bash
pm2 status
pm2 logs spacebot-cron --lines 50
```

### Auto-Deploy on Push

The production server now polls `origin/main` from the existing `spacebot-cron` PM2 process every minute and self-deploys when a new commit appears. The `spacebot-deploy` webhook listener on port 9090 remains available as a fast-path trigger, and the gateway app exposes `POST /deploy` as a local proxy to that listener so GitHub can hit the main hostname directly.

When a new commit is detected, the server automatically:

1. `git fetch origin main`
2. Validates the remote revision in a temporary git worktree with `bun install --frozen-lockfile` and `bun run build`
3. Fast-forwards the live checkout only if validation succeeds
4. `bun install --frozen-lockfile` (if `package.json` or `bun.lock` changed)
5. `bun run db:migrate` (if migration files changed)
6. `pm2 restart ecosystem.config.cjs --update-env`

**Setup (one-time):**

1. Set `DEPLOY_WEBHOOK_SECRET` in your environment (e.g., in `.env` or PM2 env config):

    ```bash
    export DEPLOY_WEBHOOK_SECRET="your-secret-here"
    ```

2. Configure the GitHub webhook to call `https://spacebot.starspace.group/deploy`.
   The gateway app now handles that path directly and proxies it to the internal deploy listener, so a separate Cloudflare ingress rule for `/deploy` is no longer required.

3. Add a GitHub webhook at **Settings > Webhooks** for the `spacebot` repo:
    - **Payload URL:** `https://spacebot.starspace.group/deploy`
    - **Content type:** `application/json`
    - **Secret:** same value as `DEPLOY_WEBHOOK_SECRET`
    - **Events:** Just the `push` event

### PM2 Commands

```bash
bun run gateway:status    # Check process status
bun run gateway:logs      # Tail live logs
bun run gateway:restart   # Restart all services
bun run gateway:stop      # Stop all services
```

### PM2 Startup (Auto-start on Reboot)

```bash
pm2 startup
# Follow the printed command, then:
pm2 save
```

This ensures the gateway bot restarts automatically if the server reboots.

### Log Files

PM2 writes logs to the `logs/` directory:

- `logs/gateway-out.log` — Standard output
- `logs/gateway-error.log` — Errors
- `logs/deploy-out.log` — Deploy webhook logs
- `logs/deploy-error.log` — Deploy webhook errors
- `logs/cron-out.log` — Scheduler logs
- `logs/cron-error.log` — Scheduler errors

### Monitoring

```bash
pm2 monit              # Real-time dashboard
pm2 describe spacebot-gateway  # Detailed process info
pm2 describe spacebot-cron     # Scheduler process info
```

## Security Best Practices

- ✅ Never commit `.env` files to Git
- ✅ Store all secrets in Cloudflare environment variables
- ✅ Use HTTPS only (Cloudflare Pages provides this automatically)
- ✅ Regularly rotate your Discord bot token
- ✅ Limit admin access to trusted user IDs only

## Support

- [SvelteKit Documentation](https://kit.svelte.dev)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages)
- [Discord Developer Documentation](https://discord.com/developers/docs)
- [GitHub Repository Issues](https://github.com/starspacegroup/spacebot/issues)
