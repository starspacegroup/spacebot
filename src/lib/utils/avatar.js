/**
 * Avatar URL utilities for displaying Discord user avatars
 * Handles both custom avatars and default Discord avatars
 */

/**
 * Generate Discord avatar URL from avatar hash and discriminator
 * @param {string} userId - Discord user ID
 * @param {string|null} avatar - Avatar hash (null for default)
 * @param {string} discriminator - User discriminator (or '0' for new accounts)
 * @param {number} size - Avatar size (32, 64, 128, 256, 512, 1024)
 * @returns {string} Full avatar URL
 */
export function getAvatarUrl(userId, avatar, discriminator = '0', size = 64) {
  if (!userId) return '';

  if (avatar) {
    // Custom avatar
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=${size}`;
  }

  // Default avatar based on discriminator
  let index = 0;
  try {
    if (discriminator === '0') {
      // New system: use user ID to determine default avatar
      index = Number((BigInt(userId) >> 22n) % 6n);
    } else {
      // Legacy system: use discriminator
      index = parseInt(discriminator, 10) % 5;
      if (Number.isNaN(index)) index = 0;
    }
  } catch {
    index = 0;
  }

  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Get the first letter/character for avatar fallback
 * @param {string} name - Username or display name
 * @returns {string} Single character for display
 */
export function getAvatarInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}
