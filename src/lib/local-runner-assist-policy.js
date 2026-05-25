import { getGuildSettings, normalizeLocalRunnerAssistPolicy } from "$lib/db/settings.js";

function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,20}$/.test(value) ? value : null;
}

export async function evaluateLocalRunnerAssistAccess(db, { guildId, userId }) {
  const normalizedGuildId = normalizeGuildId(guildId);
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
