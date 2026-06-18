import { getGuildSettings, normalizeLocalRunnerAssistPolicy } from "$lib/db/settings.js";

function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,20}$/.test(value) ? value : null;
}

export async function evaluateLocalRunnerAssistAccess(db, { guildId, userId }) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const guildRequested = String(guildId || "").trim().length > 0;

  // A guild WAS supplied but is malformed (not a 17-20 digit snowflake). Do NOT
  // collapse this into "no_guild_context" — callers (e.g. the AI-job runner
  // fallback) treat no_guild_context as a personal, ownership-authorized job and
  // skip the guild policy. A malformed guild must be denied, not treated as
  // personal, so it gets its own reason that callers gate on.
  if (guildRequested && !normalizedGuildId) {
    return {
      allowed: false,
      reason: "invalid_guild",
      guildId: null,
      policy: normalizeLocalRunnerAssistPolicy(null),
    };
  }

  if (!db || !normalizedGuildId || !userId) {
    return {
      allowed: false,
      reason: "no_guild_context",
      guildId: normalizedGuildId,
      policy: normalizeLocalRunnerAssistPolicy(null),
    };
  }

  const settings = await getGuildSettings(db, normalizedGuildId);
  const policy = normalizeLocalRunnerAssistPolicy(settings?.permission_settings?.localRunnerAssist);

  if (!policy.enabled) {
    return {
      allowed: false,
      reason: "guild_not_enabled",
      guildId: normalizedGuildId,
      policy,
    };
  }

  if (policy.allowedUserIds.length > 0 && !policy.allowedUserIds.includes(String(userId))) {
    return {
      allowed: false,
      reason: "user_not_allowed",
      guildId: normalizedGuildId,
      policy,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    guildId: normalizedGuildId,
    policy,
  };
}
