/**
 * Option-driven response visibility (ephemeral) refs.
 *
 * Pure parsing/formatting for the `commands.ephemeral_option` column, shared by
 * the resolver (`src/lib/db/commands.ts`), integration-manifest validation
 * (`src/lib/integrations/registry.ts`) and the dashboard command builder. No DB
 * or runtime imports live here so Svelte components can import it safely.
 *
 * Ref grammar:
 *   ref       := condition (';' condition)*
 *   condition := ['!'] ['option:'] <name> ['=' <value> (',' <value>)*]
 *
 * A command's reply is ephemeral when **any** condition matches (OR). Conditions
 * whose option the invoking user omitted are skipped; if every condition is
 * skipped the command's static `ephemeral` boolean decides.
 *
 *   "private"                          → boolean option, private iff truthy
 *   "!public"                          → negated boolean (a "make it public" toggle)
 *   "visibility=private"               → choice option, private iff that choice
 *   "visibility=private,secret"        → private iff one of the listed choices
 *   "publicity=draft,community;anon"   → private iff publicity is draft/community
 *                                        OR the `anon` boolean is on
 *
 * Because `!`, `option:`, `=`, `,` and `;` are structural, an option name or
 * choice value containing `=`, `,` or `;` cannot be referenced.
 */

/** Separates conditions within one stored ref. Conditions are OR'd. */
export const EPHEMERAL_CONDITION_SEPARATOR = ';';

/**
 * @typedef {Object} EphemeralCondition
 * @property {string} name - Referenced option name
 * @property {boolean} negate - Leading '!' — invert this condition's match
 * @property {string[]|null} values - Lower-cased match values for the equality
 *   form, or null for the boolean (truthiness) form
 */

/**
 * Coerce a Discord option value into a boolean. BOOLEAN options (type 5)
 * already arrive as real booleans; string/number options are accepted
 * leniently so a "yes"/"1"/"on" toggle works too. Anything unset is false.
 * @param {*} value
 * @returns {boolean}
 */
export function coerceOptionBoolean(value) {
	if (value === undefined || value === null) return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') {
		const v = value.trim().toLowerCase();
		return v === 'true' || v === 'yes' || v === '1' || v === 'on';
	}
	return false;
}

/**
 * Parse a single condition (no `;` separator handling).
 * Split on the FIRST `=` only — Discord option names cannot contain '='.
 *
 * @param {string} part
 * @returns {EphemeralCondition|null}
 */
function parseCondition(part) {
	let rest = String(part ?? '').trim();
	let negate = false;
	if (rest.startsWith('!')) {
		negate = true;
		rest = rest.slice(1).trim();
	}
	if (rest.startsWith('option:')) rest = rest.slice(7).trim();
	if (!rest) return null;

	const eq = rest.indexOf('=');
	if (eq === -1) {
		return { name: rest, negate, values: null };
	}

	const name = rest.slice(0, eq).trim();
	if (!name) return null;
	const values = rest
		.slice(eq + 1)
		.split(',')
		.map((v) => v.trim().toLowerCase())
		.filter((v) => v.length > 0);
	return { name, negate, values };
}

/**
 * Parse an `ephemeral_option` ref into its OR'd conditions. Unparseable
 * conditions (empty, or an orphan `=value`) are dropped; a ref that yields no
 * usable condition returns an empty array.
 *
 * @param {string} ref
 * @returns {EphemeralCondition[]}
 */
export function parseEphemeralOptionConditions(ref) {
	if (!ref || typeof ref !== 'string') return [];
	return ref
		.split(EPHEMERAL_CONDITION_SEPARATOR)
		.map((part) => parseCondition(part))
		.filter((cond) => cond !== null);
}

/**
 * Parse the FIRST condition of a ref. Retained for callers that only care about
 * the single-condition form; use {@link parseEphemeralOptionConditions} to see
 * every condition.
 *
 * @param {string} ref
 * @returns {EphemeralCondition|null}
 */
export function parseEphemeralOptionRef(ref) {
	return parseEphemeralOptionConditions(ref)[0] ?? null;
}

/**
 * Serialize conditions back into a stored ref. Conditions without a name — and
 * equality-form conditions with no values selected — are dropped as incomplete,
 * so a half-filled builder row never persists. Returns null when nothing
 * usable remains (meaning: fall back to the static `ephemeral` boolean).
 *
 * @param {Array<{name?: string, negate?: boolean, values?: string[]|null}>} conditions
 * @returns {string|null}
 */
export function formatEphemeralOptionRef(conditions) {
	if (!Array.isArray(conditions)) return null;

	const parts = [];
	for (const cond of conditions) {
		const name = String(cond?.name ?? '').trim();
		if (!name) continue;

		const values = Array.isArray(cond?.values)
			? cond.values.map((v) => String(v).trim()).filter((v) => v.length > 0)
			: null;
		// An equality-form row with nothing ticked matches nothing — drop it
		// rather than storing a ref that can never fire.
		if (values !== null && values.length === 0) continue;

		const prefix = cond?.negate ? '!' : '';
		parts.push(values === null ? `${prefix}${name}` : `${prefix}${name}=${values.join(',')}`);
	}

	return parts.length ? parts.join(EPHEMERAL_CONDITION_SEPARATOR) : null;
}
