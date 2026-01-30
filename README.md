# spacebot

A Discord bot built with SvelteKit, hosted on Cloudflare Pages+Workers.

## Features

- 🤖 **Discord Bot**: Responds to slash commands and menu interactions
- 🌐 **Web Frontend**: Public stats page and admin dashboard
- 🔐 **Discord OAuth**: User authentication via Discord
- ⚡ **Cloudflare Pages**: Deployed on Cloudflare's edge network
- 🎯 **Admin Panel**: Manage bot settings and view detailed statistics

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Discord Application
  ([create one here](https://discord.com/developers/applications))
- A Cloudflare account ([sign up here](https://dash.cloudflare.com/sign-up))

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/starspacegroup/spacebot.git
   cd spacebot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy `.env.example` to `.env` and fill in your Discord credentials:
   ```bash
   cp .env.example .env
   ```

   Get your Discord credentials from the
   [Discord Developer Portal](https://discord.com/developers/applications):
   - `DISCORD_PUBLIC_KEY`: Found in your app's "General Information"
   - `DISCORD_CLIENT_ID`: Your application's Client ID
   - `DISCORD_CLIENT_SECRET`: Found under OAuth2 settings
   - `DISCORD_BOT_TOKEN`: Found under "Bot" settings
   - `ADMIN_USER_IDS`: Your Discord user ID (right-click your name with
     Developer Mode enabled)

4. **Register Discord commands**
   ```bash
   DISCORD_CLIENT_ID=xxx DISCORD_BOT_TOKEN=xxx node scripts/register-commands.js
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:5173`

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Go to "Bot" and enable the bot
4. Under "Privileged Gateway Intents", enable:
   - Server Members Intent (if needed)
   - Message Content Intent (if needed)
5. Go to "OAuth2" → "URL Generator"
   - Select scopes: `bot`, `applications.commands`
   - Select bot permissions as needed
   - Use the generated URL to invite the bot to your server

### OAuth2 Code Grant Flow

SpaceBot supports the full OAuth2 Code Grant flow for bot installation. This is
required when your application needs multiple scopes and you want to ensure the
bot doesn't join before your application is granted a token.

**Why use OAuth2 Code Grant for bots?**

- Ensures your application receives an access token before the bot joins the
  server
- Allows you to store refresh tokens for later API calls on behalf of the user
- Provides user identity along with bot installation in a single flow

**Available OAuth2 flows:**

1. **Login only** (`/api/auth/discord`):
   - Scopes: `identify guilds`
   - Just authenticates the user without adding a bot

2. **Bot installation** (`/api/auth/discord?flow=install`):
   - Scopes: `identify guilds bot applications.commands`
   - Authenticates user AND adds bot to selected server
   - Returns access token, refresh token, and guild info

**Query parameters for install flow:**

- `flow=install` - Required for bot installation
- `guild_id=<id>` - Pre-select a specific guild
- `permissions=<bitfield>` - Custom permission bitfield (default: Administrator)

### Setting up Interactions Endpoint

Once deployed to Cloudflare Pages:

1. Get your Cloudflare Pages URL (e.g., `https://spacebot.pages.dev`)
2. Go to Discord Developer Portal → Your Application → "General Information"
3. Set "Interactions Endpoint URL" to:
   `https://your-domain.pages.dev/api/discord/interactions`
4. Discord will send a test request to verify the endpoint

## Deployment to Cloudflare Pages

### Option 1: Deploy via Cloudflare Dashboard (Recommended)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Connect to Cloudflare Pages**
   - Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Go to "Workers & Pages" → "Create application" → "Pages" → "Connect to Git"
   - Select your GitHub repository
   - Configure build settings:
     - **Build command**: `npm run build`
     - **Build output directory**: `.svelte-kit/cloudflare`
     - **Root directory**: `/` (leave empty if at root)

3. **Set Environment Variables**

   In Cloudflare Pages dashboard, go to Settings → Environment Variables and
   add:
   - `DISCORD_PUBLIC_KEY`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `DISCORD_BOT_TOKEN`
   - `ADMIN_USER_IDS`

4. **Deploy**
   - Click "Save and Deploy"
   - Cloudflare will automatically build and deploy your site
   - Future pushes to main branch will auto-deploy

### Option 2: Deploy via Wrangler CLI

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
npm run build
wrangler pages deploy .svelte-kit/cloudflare
```

## Project Structure

```
spacebot/
├── src/
│   ├── lib/
│   │   └── discord/
│   │       └── commands.js        # Discord command definitions
│   ├── routes/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── discord/       # Discord OAuth endpoints
│   │   │   └── discord/
│   │   │       └── interactions/  # Discord bot interaction handler
│   │   ├── admin/                 # Admin dashboard
│   │   ├── login/                 # Login page
│   │   └── +page.svelte          # Public homepage
│   └── app.html                   # HTML template
├── scripts/
│   └── register-commands.js       # Command registration script
├── static/                        # Static assets
├── .env.example                   # Environment variable template
├── svelte.config.js              # SvelteKit config (Cloudflare adapter)
├── package.json
└── README.md
```

## Available Commands

### Discord Bot Commands

- `/ping` - Check if the bot is responsive
- `/stats` - View bot statistics
- `/help` - Get help with bot commands

### npm Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `node scripts/register-commands.js` - Register Discord commands

## Environment Variables

| Variable                | Description                                        | Required |
| ----------------------- | -------------------------------------------------- | -------- |
| `DISCORD_PUBLIC_KEY`    | Your Discord app's public key                      | Yes      |
| `DISCORD_CLIENT_ID`     | Your Discord app's client ID                       | Yes      |
| `DISCORD_CLIENT_SECRET` | Your Discord OAuth client secret                   | Yes      |
| `DISCORD_BOT_TOKEN`     | Your Discord bot token                             | Yes      |
| `ADMIN_USER_IDS`        | Comma-separated Discord user IDs with admin access | No       |

## Security Notes

- Never commit `.env` file to version control
- Store all secrets in Cloudflare Pages environment variables
- The Discord interactions endpoint verifies requests using your public key
- OAuth tokens should be stored securely (use Cloudflare KV or D1)

## Next Steps

- [ ] Implement session storage with Cloudflare KV or D1
- [ ] Add more Discord commands
- [ ] Implement proper admin authentication
- [ ] Add database for storing bot statistics
- [ ] Implement rate limiting
- [ ] Add monitoring and logging
- [ ] Create automated tests

## Resources

- [SvelteKit Documentation](https://kit.svelte.dev)
- [Discord.js Guide](https://discordjs.guide)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages)
- [Discord Developer Portal](https://discord.com/developers/docs)

## License

MIT
