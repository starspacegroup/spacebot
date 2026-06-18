/**
 * Minimal 5-field cron expression matcher (minute granularity, UTC).
 *
 * Supported syntax per field: "*", "*\/n", "a", "a,b,c", "a-b", "a-b/n".
 * Fields: minute hour day-of-month month day-of-week (0 or 7 = Sunday).
 * Standard cron semantics: when both day-of-month and day-of-week are
 * restricted, the expression matches if either one matches.
 */

const FIELD_RANGES = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 7 },
];

function parseField(field, { min, max }) {
  const values = new Set();
  const raw = String(field || "").trim();
  if (!raw) return null;

  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) return null;

    const [rangeToken, stepToken] = token.split("/");
    const step = stepToken === undefined ? 1 : Number(stepToken);
    if (!Number.isInteger(step) || step < 1) return null;

    let start;
    let end;
    if (rangeToken === "*") {
      start = min;
      end = max;
    } else if (rangeToken.includes("-")) {
      const [a, b] = rangeToken.split("-").map((x) => Number(x));
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      start = a;
      end = b;
    } else {
      const value = Number(rangeToken);
      if (!Number.isInteger(value)) return null;
      start = value;
      end = stepToken === undefined ? value : max;
    }

    if (start < min || end > max || start > end) return null;
    for (let v = start; v <= end; v += step) {
      values.add(v);
    }
  }

  return values;
}

/**
 * Parse a cron expression. Returns null when invalid.
 */
export function parseCronExpression(expression) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed = [];
  for (let i = 0; i < 5; i += 1) {
    const values = parseField(fields[i], FIELD_RANGES[i]);
    if (!values) return null;
    parsed.push({ values, wildcard: fields[i].trim().startsWith("*") && !fields[i].includes("/") ? fields[i].trim() === "*" : fields[i].trim() === "*" });
  }

  return {
    minute: parsed[0].values,
    hour: parsed[1].values,
    dayOfMonth: parsed[2].values,
    month: parsed[3].values,
    dayOfWeek: parsed[4].values,
    domWildcard: fields[2].trim() === "*",
    dowWildcard: fields[4].trim() === "*",
  };
}

/**
 * Whether the expression matches the given Date (UTC), at minute granularity.
 */
export function cronMatches(expression, date = new Date()) {
  const parsed = parseCronExpression(expression);
  if (!parsed) return false;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dowRaw = date.getUTCDay(); // 0 = Sunday

  if (!parsed.minute.has(minute)) return false;
  if (!parsed.hour.has(hour)) return false;
  if (!parsed.month.has(month)) return false;

  const domMatch = parsed.dayOfMonth.has(dom);
  const dowMatch = parsed.dayOfWeek.has(dowRaw) || (dowRaw === 0 && parsed.dayOfWeek.has(7));

  // Standard cron: both restricted → OR; otherwise both must match
  if (!parsed.domWildcard && !parsed.dowWildcard) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

/**
 * Whether the expression is syntactically valid.
 */
export function isValidCronExpression(expression) {
  return parseCronExpression(expression) !== null;
}
