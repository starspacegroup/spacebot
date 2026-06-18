/**
 * Generate a random URL-safe hash ID
 * Uses crypto.getRandomValues for cryptographic randomness
 * @param {number} length - Length of the ID (default: 12)
 * @returns {string} - Random alphanumeric ID
 */
export function generateHashId(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(length);
  
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    for (let i = 0; i < length; i++) {
      randomValues[i] = Math.floor(Math.random() * 256);
    }
  }
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
