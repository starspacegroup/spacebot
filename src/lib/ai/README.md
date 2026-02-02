# AI Chat Module

This module integrates with Cloudflare Workers AI to provide LLM-based chat functionality for bot managers via DMs.

## Setup

### 1. Get Cloudflare Credentials

1. Log into the [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **AI** > **Workers AI**
3. Click **Use REST API**
4. Create a Workers AI API Token with read/edit permissions
5. Copy your Account ID

### 2. (Optional) Set Up AI Gateway

For analytics, caching, and rate limiting:

1. Navigate to **AI** > **AI Gateway**
2. Create a new gateway
3. Copy the gateway name/ID

### 3. Configure Environment Variables

Add to your `.env` file (for local development with the gateway):

```bash
# Required
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_AI_TOKEN=your_api_token

# Optional
CLOUDFLARE_AI_GATEWAY_ID=your_gateway_id
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
```

For production, set these in the Cloudflare dashboard or via `wrangler secret`.

## How It Works

1. When someone sends a DM to the bot, the gateway checks if they are a manager
2. A "manager" is anyone with **Manage Server** or **Administrator** permissions in any guild where the bot is installed
3. If they are a manager, the message is sent to the LLM for a response
4. The AI responds as "SpaceBot", helping with bot features and server management

## Free Models

Cloudflare offers generous free tiers for Workers AI. The default model is:

- `@cf/meta/llama-3.1-8b-instruct-fast` - Fast, free, good for chat

Other free options:
- `@cf/meta/llama-3.2-1b-instruct` - Smaller, faster
- `@cf/meta/llama-3.2-3b-instruct` - Balance of speed and quality
- `@cf/meta/llama-3.1-8b-instruct` - Higher quality, slightly slower

## Customization

Edit `src/lib/ai/chat.js` to:
- Modify the `SYSTEM_PROMPT` for different bot personality
- Change `DEFAULT_MODEL` for different LLM
- Add conversation history for multi-turn chats
