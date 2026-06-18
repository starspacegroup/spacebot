const encoder = new TextEncoder();
export const LIVE_UPDATE_TOKEN_TTL_SECONDS = 60 * 60 * 2;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

async function signMessage(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function signLiveUpdateAccess(guildId, userId, expiresAt, secret) {
  return signMessage(`${guildId}|${userId}|${expiresAt}`, secret);
}

export async function verifyLiveUpdateAccess(guildId, userId, expiresAt, signature, secret) {
  if (!guildId || !userId || !expiresAt || !signature || !secret) {
    return false;
  }

  const expiresAtNumber = Number(expiresAt);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expiresAtNumber) || expiresAtNumber < now || expiresAtNumber > now + LIVE_UPDATE_TOKEN_TTL_SECONDS + 300) {
    return false;
  }

  const expected = await signLiveUpdateAccess(guildId, userId, expiresAtNumber, secret);
  return constantTimeEqual(expected, signature);
}