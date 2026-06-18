const { Client } = require('pg');
const fetch = require('node-fetch');

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Discord API setup
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is not set in environment variables.');
  process.exit(1);
}

// Fetch Discord user profile
async function fetchDiscordUserProfile(userId) {
  const response = await fetch(`${DISCORD_API_BASE}/users/${userId}`, {
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch user ${userId}: ${response.statusText}`);
    return null;
  }

  return response.json();
}

// Update database with avatar URLs
async function updateAvatarInDatabase(userId, avatarUrl) {
  try {
    await client.query(
      `UPDATE users SET avatar = $1 WHERE id = $2`,
      [avatarUrl, userId]
    );
    console.log(`Updated avatar for user ${userId}`);
  } catch (err) {
    console.error(`Failed to update avatar for user ${userId}:`, err);
  }
}

// Main backfill function
async function backfillAvatars() {
  try {
    await client.connect();

    // Fetch all users from the database
    const res = await client.query('SELECT id FROM users WHERE avatar IS NULL');
    const users = res.rows;

    console.log(`Found ${users.length} users to backfill.`);

    for (const user of users) {
      const userId = user.id;
      const profile = await fetchDiscordUserProfile(userId);

      if (profile && profile.avatar) {
        const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${profile.avatar}.png`;
        await updateAvatarInDatabase(userId, avatarUrl);
      } else {
        console.log(`No custom avatar for user ${userId}`);
      }
    }
  } catch (err) {
    console.error('Error during backfill:', err);
  } finally {
    await client.end();
  }
}

// Run the backfill
backfillAvatars();