/**
 * Timezone utility for formatting dates/times
 * 
 * Uses the server-configured timezone if set, otherwise falls back to the user's 
 * browser timezone. All dates stored in the DB are in UTC — this module handles 
 * display conversion only.
 */

/**
 * Parse a date string as UTC.
 * 
 * D1/SQLite stores dates from CURRENT_TIMESTAMP and datetime('now') in
 * "YYYY-MM-DD HH:MM:SS" format without a timezone indicator. JavaScript's
 * `new Date()` would parse these as LOCAL time, which is wrong — the values
 * are UTC. This helper ensures they are always parsed as UTC.
 * 
 * Strings that already carry timezone info (trailing "Z", "+HH:MM", etc.)
 * are left untouched.
 * 
 * @param {string} dateString - A date string, typically from the database
 * @returns {Date|null} - Parsed Date object, or null if invalid
 */
export function parseUTCDate(dateString) {
  if (!dateString) return null;
  const s = dateString.trim();
  // Already has timezone info — parse as-is
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Normalise "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
  const normalized = s.includes('T') ? s + 'Z' : s.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Get the effective timezone for display.
 * @param {string|null} serverTimezone - The server's configured timezone override (IANA name)
 * @returns {string} - IANA timezone name (e.g. 'America/New_York')
 */
export function getTimezone(serverTimezone) {
  if (serverTimezone) return serverTimezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Format a UTC date string for display in the configured timezone.
 * Short format: "Feb 25, 3:42 PM"
 * @param {string} dateString - ISO/UTC date string
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function formatDate(dateString, serverTimezone = null) {
  if (!dateString) return '';
  const date = parseUTCDate(dateString);
  if (!date) return dateString;
  const tz = getTimezone(serverTimezone);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: tz,
  }).format(date);
}

/**
 * Format a UTC date string for display with full detail.
 * "Tuesday, February 25, 2026, 3:42:15 PM EST"
 * @param {string} dateString - ISO/UTC date string
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function formatDateFull(dateString, serverTimezone = null) {
  if (!dateString) return '';
  const date = parseUTCDate(dateString);
  if (!date) return dateString;
  const tz = getTimezone(serverTimezone);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone: tz,
  }).format(date);
}

/**
 * Format a date for chart axis labels: "Feb 25"
 * @param {string} dateString - ISO/UTC date string (can be just YYYY-MM-DD)
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function formatChartDate(dateString, serverTimezone = null) {
  if (!dateString) return '';
  const date = parseUTCDate(dateString);
  if (!date) return dateString;
  const tz = getTimezone(serverTimezone);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(date);
}

/**
 * Format a date as a short date: "Feb 25, 2026"
 * @param {string} dateString - ISO/UTC date string
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function formatDateShort(dateString, serverTimezone = null) {
  if (!dateString) return '';
  const date = parseUTCDate(dateString);
  if (!date) return dateString;
  const tz = getTimezone(serverTimezone);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: tz,
  }).format(date);
}

/**
 * Format relative time: "5 minutes ago", "2 hours ago", etc.
 * Falls back to formatDateFull for old dates.
 * @param {string} dateString - ISO/UTC date string
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function formatRelativeTime(dateString, serverTimezone = null) {
  if (!dateString) return '';
  const date = parseUTCDate(dateString);
  if (!date) return dateString;
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec} seconds ago`;
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return formatDateFull(dateString, serverTimezone);
}

/**
 * Get the timezone abbreviation for display (e.g. "EST", "PST", "UTC")
 * @param {string|null} serverTimezone - Server timezone override
 * @returns {string}
 */
export function getTimezoneAbbreviation(serverTimezone = null) {
  const tz = getTimezone(serverTimezone);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
      timeZone: tz,
    }).formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || tz;
  } catch {
    return tz;
  }
}

/**
 * Common IANA timezone list for the settings dropdown.
 * Grouped by region with user-friendly labels.
 */
export const TIMEZONE_OPTIONS = [
  { value: '', label: 'Auto-detect (browser timezone)' },
  // UTC
  { value: 'UTC', label: 'UTC — Coordinated Universal Time' },
  // Americas
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)' },
  { value: 'America/Vancouver', label: 'Pacific Time (Canada)' },
  { value: 'America/Halifax', label: 'Atlantic Time (Canada)' },
  { value: 'America/St_Johns', label: 'Newfoundland Time' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Sao_Paulo', label: 'Brasilia Time' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'America/Bogota', label: 'Bogota / Lima' },
  { value: 'America/Santiago', label: 'Santiago' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central European Time' },
  { value: 'Europe/Berlin', label: 'Berlin / Frankfurt' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam' },
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Europe/Rome', label: 'Rome' },
  { value: 'Europe/Zurich', label: 'Zurich' },
  { value: 'Europe/Stockholm', label: 'Stockholm' },
  { value: 'Europe/Helsinki', label: 'Helsinki' },
  { value: 'Europe/Athens', label: 'Athens / Eastern European' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Europe/Istanbul', label: 'Istanbul' },
  { value: 'Europe/Kyiv', label: 'Kyiv' },
  { value: 'Europe/Warsaw', label: 'Warsaw' },
  { value: 'Europe/Bucharest', label: 'Bucharest' },
  // Asia & Pacific
  { value: 'Asia/Dubai', label: 'Dubai / Gulf Standard' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Kathmandu', label: 'Nepal' },
  { value: 'Asia/Dhaka', label: 'Bangladesh' },
  { value: 'Asia/Bangkok', label: 'Bangkok / Indochina' },
  { value: 'Asia/Singapore', label: 'Singapore / Malaysia' },
  { value: 'Asia/Shanghai', label: 'China Standard' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Taipei', label: 'Taipei' },
  { value: 'Asia/Tokyo', label: 'Japan' },
  { value: 'Asia/Seoul', label: 'Korea' },
  { value: 'Asia/Manila', label: 'Philippines' },
  { value: 'Asia/Jakarta', label: 'Jakarta / Western Indonesia' },
  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne' },
  { value: 'Australia/Brisbane', label: 'Brisbane (no DST)' },
  { value: 'Australia/Perth', label: 'Perth' },
  { value: 'Australia/Adelaide', label: 'Adelaide' },
  { value: 'Australia/Darwin', label: 'Darwin' },
  { value: 'Pacific/Auckland', label: 'New Zealand' },
  { value: 'Pacific/Fiji', label: 'Fiji' },
  // Africa & Middle East
  { value: 'Africa/Johannesburg', label: 'South Africa' },
  { value: 'Africa/Cairo', label: 'Cairo' },
  { value: 'Africa/Lagos', label: 'Lagos / West Africa' },
  { value: 'Africa/Nairobi', label: 'Nairobi / East Africa' },
  { value: 'Asia/Jerusalem', label: 'Israel' },
  { value: 'Asia/Riyadh', label: 'Saudi Arabia' },
];
