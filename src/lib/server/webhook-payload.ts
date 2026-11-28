/**
 * Turns an incoming webhook body into the `webhook` template variables.
 *
 * Sender text reaches Discord messages, so two things are done here and nowhere else:
 * - mentions are defused: `@everyone`, `@here` and `<@...>` / `<@&...>` get a zero-width space,
 *   so a sender cannot ping anyone;
 * - the tree is rebuilt with no prototype, only own keys, and only strings, numbers and
 *   booleans at the leaves, so `{webhook.constructor}` or `{webhook.__proto__.x}` read nothing.
 */

export const MAX_BODY_TEXT = 2000;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ARRAY = 50;
const MAX_LEAF = 2000;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

/** Break the parts of a string that Discord would turn into a ping. */
export function defuseMentions(s: string): string {
	return s.replace(/@(?=everyone|here)/gi, '@​').replace(/<@/g, '<@​');
}

function leaf(v: unknown): string | null {
	if (typeof v === 'string') return defuseMentions(v.slice(0, MAX_LEAF));
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	if (typeof v === 'boolean') return String(v);
	return null;
}

/** Copy a parsed JSON value into a safe tree. Returns null for anything that is not usable. */
export function safeTree(v: unknown, depth = 0): any {
	const l = leaf(v);
	if (l !== null) return l;
	if (depth >= MAX_DEPTH || v === null || typeof v !== 'object') return null;
	const out: Record<string, any> = Object.create(null);
	if (Array.isArray(v)) {
		v.slice(0, MAX_ARRAY).forEach((item, i) => {
			const c = safeTree(item, depth + 1);
			if (c !== null) out[String(i)] = c;
		});
		return out;
	}
	let n = 0;
	for (const key of Object.keys(v as object)) {
		if (BLOCKED.has(key) || key.includes('.')) continue;
		if (n++ >= MAX_KEYS) break;
		const c = safeTree((v as any)[key], depth + 1);
		if (c !== null) out[key] = c;
	}
	return out;
}

/**
 * The `webhook` variable object: name, body (text, cut), plus each JSON key at the top level.
 * `name` and `body` win over a same-named JSON key.
 */
export function buildWebhookVariables(hookName: string, rawBody: string, parsed: unknown) {
	const tree = parsed !== undefined ? safeTree(parsed) : null;
	const vars: Record<string, any> = Object.create(null);
	if (tree && typeof tree === 'object') Object.assign(vars, tree);
	vars.name = defuseMentions(hookName);
	vars.body = defuseMentions(rawBody.slice(0, MAX_BODY_TEXT));
	return vars;
}
