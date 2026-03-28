/**
 * Helpers for generating and fetching stats widget images for action delivery.
 */

import { signWidgetUrl, WIDGET_TYPES } from "./stats-widget.js";

const VALID_PERIODS = new Set(["7d", "30d"]);

/**
 * Resolve the app origin used to fetch signed widget images.
 * @returns {string}
 */
export function resolveWidgetOrigin() {
  return process.env.APP_URL || process.env.API_BASE || "http://localhost:4269";
}

/**
 * Fetch a stats widget PNG from the signed widget endpoint.
 * @param {Object} params
 * @param {string} params.guildId
 * @param {string} [params.type]
 * @param {string} [params.period]
 * @param {string} params.secret
 * @param {string} [params.origin]
 * @returns {Promise<{pngData: Uint8Array, filename: string, widgetInfo: {name: string, description: string}, periodLabel: string}>}
 */
export async function fetchSignedWidgetPng({
  guildId,
  type = "voice_time",
  period = "30d",
  secret,
  origin = resolveWidgetOrigin(),
}) {
  const widgetInfo = WIDGET_TYPES[type];
  if (!widgetInfo) {
    throw new Error(`Invalid widget type: ${type}`);
  }

  if (!VALID_PERIODS.has(period)) {
    throw new Error(`Invalid widget period: ${period}`);
  }

  if (!secret) {
    throw new Error("Widget signing secret is not configured");
  }

  const baseOrigin = origin.replace(/\/$/, "");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signWidgetUrl(guildId, type, period, timestamp, secret);
  const widgetUrl = `${baseOrigin}/api/stats/${guildId}/widget?type=${type}&period=${period}&t=${timestamp}&sig=${signature}`;

  const response = await fetch(widgetUrl);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to fetch widget image (${response.status}): ${errorText || "Unknown error"}`);
  }

  const pngData = new Uint8Array(await response.arrayBuffer());
  return {
    pngData,
    filename: `stats-${type}-${period}.png`,
    widgetInfo,
    periodLabel: period === "7d" ? "Last 7 Days" : "Last 30 Days",
  };
}
