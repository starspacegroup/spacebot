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
- **Build command**: `npm run build`
- **Build output directory**: `.svelte-kit/cloudflare`
- **Root directory**: `/` (leave empty)

### Set Environment Variables

Click on **Environment variables** and add the following:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `DISCORD_PUBLIC_KEY` | Your Discord public key | From Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Your Discord application ID | From Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | Your Discord client secret | From OAuth2 settings |
| `DISCORD_BOT_TOKEN` | Your Discord bot token | From Bot settings |
| `ADMIN_USER_IDS` | Your Discord user ID(s) | Comma-separated list for multiple admins |

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
npm install

# Register commands
DISCORD_CLIENT_ID=your_client_id DISCORD_BOT_TOKEN=your_bot_token node scripts/register-commands.js
```

### Option B: Register via Cloudflare Worker

Create a temporary Cloudflare Worker to register commands:

```javascript
export default {
  async fetch(request, env) {
    const commands = [
      { name: 'ping', description: 'Check if the bot is responsive', type: 1 },
      { name: 'stats', description: 'View bot statistics', type: 1 },
      { name: 'help', description: 'Get help with bot commands', type: 1 }
    ];
    
    const url = `https://discord.com/api/v10/applications/${env.DISCORD_CLIENT_ID}/commands`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`
      },
      body: JSON.stringify(commands)
    });
    
    return new Response(await response.text(), { status: response.status });
  }
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
