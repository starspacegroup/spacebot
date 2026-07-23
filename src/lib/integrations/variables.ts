/**
 * Integration Template Variables (Part D)
 *
 * Lets an external integration contribute *per-user template variables* into
 * SpaceBot's message templates — the same `{...}` placeholders that power
 * command responses and automation messages. An integration declares them in
 * its manifest:
 *
 *   "variables": [
 *     {
 *       "key": "agapeverse.account_url",   // MUST be namespaced <slug>.<name>
 *       "label": "Account link",
 *       "description": "Link to the user's AgapeVerse account page",
 *       "scope": "user"                    // "user" (default) | "global"
 *     }
 *   ],
 *   "webhooks": { "variables_handler": "https://.../api/spacebot/variables" }
 *
 * At send time SpaceBot scans the templates about to be resolved, batches all
 * of an integration's referenced keys into ONE call to `variables_handler`
 * (`{ type, integration_slug, guild_id, discord_user_id, keys }` →
 * `{ values: { "<key>": "<value>" } }`), and merges the values into the
 * template context so `processTemplate` resolves them like built-ins.
 *
 * Failure mode is always an empty string, never a blocked send and never a
 * literal `{agapeverse.x}` leaking into chat: any requested key an enabled
 * integration declares is force-merged (value or '') before resolution.
 *
 * This module deliberately does NOT import from ../automation/engine.js so the
 * engine can import it without a cycle (same rule as ./actions.ts).
 */

import { log } from '../log.js';
import { getEnabledGuildIntegrations } from '../db/integrations.js';

/** How long the integration's variables handler has to respond. Tighter than
 *  the 8s action-handler budget — variables decorate a message; they must
 *  never make a send feel stuck. */
const VARIABLES_HANDLER_TIMEOUT_MS = 2000;

/** Resolved values are cached per (integration, guild, user) briefly so
 *  automation bursts (e.g. role-grant sweeps) don't hammer the handler. */
const VARIABLES_CACHE_TTL_MS = 2 * 60 * 1000;
const valueCache = new Map<string, { values: Record<string, string>; expires: number }>();

/** Test hook: clear the module cache between test cases. */
export function _clearVariablesCache() {
	valueCache.clear();
}

/**
 * Given an integration's manifest, return the template variables it declares.
 * Each variable has a namespaced `key` (e.g. "agapeverse.account_url").
 */
export function getIntegrationVariables(integration) {
	const manifest = integration.manifest || integration.manifest_json;
	if (!manifest?.variables || !Array.isArray(manifest.variables)) return [];
	return manifest.variables;
}

/**
 * Extract candidate integration-variable keys from template text.
 *
 * Matches `{slug.path}` where the first segment looks like an integration slug
 * (lowercase/digits/hyphens — mirrors the manifest slug rule). Built-in
 * context roots (`user`, `guild`, `github`, …) match this shape too; callers
 * MUST intersect the result with keys actually declared by enabled
 * integrations before doing anything with it.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractNamespacedVariableKeys(text) {
	const keys = new Set<string>();
	if (!text || typeof text !== 'string') return keys;
	const re = /\{([a-z0-9][a-z0-9-]*\.[A-Za-z0-9_][A-Za-z0-9_.]*)\}/g;
	let m;
	while ((m = re.exec(text)) !== null) keys.add(m[1]);
	return keys;
}

/**
 * Collect one scannable text blob from template-bearing pieces (strings are
 * taken as-is, objects are JSON-stringified so embed fields / action configs
 * are covered without walking their shape).
 */
export function collectTemplateText(...parts) {
	const chunks: string[] = [];
	for (const part of parts) {
		if (!part) continue;
		if (typeof part === 'string') chunks.push(part);
		else {
			try {
				chunks.push(JSON.stringify(part));
			} catch {
				/* circular/hostile — skip */
			}
		}
	}
	return chunks.join('\n');
}

/** Walk a dotted path through the context; true if it resolves to a value. */
function pathPresent(context, key) {
	let value = context;
	for (const part of key.split('.')) {
		if (value === undefined || value === null || typeof value !== 'object') return false;
		value = value[part];
	}
	return value !== undefined;
}

/** Set a dotted path on the context, creating intermediate objects. Never
 *  clobbers an existing non-object midway (built-in roots stay intact). */
function setPath(context, key, value) {
	const parts = key.split('.');
	let node = context;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (node[part] === undefined || node[part] === null) node[part] = {};
		else if (typeof node[part] !== 'object') return; // refuse to clobber
		node = node[part];
	}
	node[parts[parts.length - 1]] = value;
}

/**
 * Resolve integration-declared variables referenced by `text` and merge them
 * into `context` ahead of template processing.
 *
 * - One handler call per integration per invocation (batched keys).
 * - Values cached ~2 min per (integration, guild, user).
 * - Handler missing/slow/down, or user not linked → declared keys merge as ''.
 * - Keys already present in the context (e.g. augmented earlier on the same
 *   invocation) are skipped, so calling this twice is cheap and idempotent.
 *
 * @param {object} opts
 * @param {any} opts.db
 * @param {string} opts.guildId
 * @param {string|null} opts.userId - Discord user ID the user-scoped variables resolve for
 * @param {string} opts.text - scannable template text (see collectTemplateText)
 * @param {object} opts.context - template context to mutate
 * @param {typeof fetch} [opts.fetchImpl] - test seam
 * @returns {Promise<object>} the same context
 */
export async function augmentContextWithIntegrationVariables({
	db,
	guildId,
	userId = null,
	text,
	context,
	fetchImpl = fetch,
}) {
	if (!db || !guildId || !context) return context;

	const referenced = extractNamespacedVariableKeys(text);
	if (referenced.size === 0) return context;

	let enabled;
	try {
		enabled = await getEnabledGuildIntegrations(db, guildId);
	} catch (err) {
		log.error('[IntegrationVariables] Lookup failed:', err);
		return context;
	}

	for (const integration of enabled) {
		const declared = getIntegrationVariables(integration);
		if (declared.length === 0) continue;

		const declaredByKey = new Map<string, any>(
			declared.filter((v) => v?.key && typeof v.key === 'string').map((v) => [v.key, v])
		);

		// Keys this integration owns, referenced by the templates, not already
		// resolved on the context.
		const wanted = [...referenced].filter(
			(key) => declaredByKey.has(key) && !pathPresent(context, key)
		);
		if (wanted.length === 0) continue;

		// User-scoped variables need a target user; without one they resolve ''.
		const scopeOf = (key) => declaredByKey.get(key)?.scope || 'user';
		const fetchable = userId ? wanted : wanted.filter((key) => scopeOf(key) === 'global');
		for (const key of wanted) {
			if (!fetchable.includes(key)) setPath(context, key, '');
		}
		if (fetchable.length === 0) continue;

		const manifest = integration.manifest || integration.manifest_json;
		const handlerUrl = manifest?.webhooks?.variables_handler;
		if (!handlerUrl) {
			log.debug(
				`[IntegrationVariables] ${integration.slug} declares variables but no variables_handler`
			);
			for (const key of fetchable) setPath(context, key, '');
			continue;
		}

		const cacheKey = `${integration.slug}:${guildId}:${userId ?? '-'}`;
		const cached = valueCache.get(cacheKey);
		if (cached && cached.expires > Date.now() && fetchable.every((k) => k in cached.values)) {
			for (const key of fetchable) setPath(context, key, cached.values[key] ?? '');
			continue;
		}

		let values: Record<string, string> = {};
		try {
			const res = await fetchImpl(handlerUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-SpaceBot-Integration': integration.slug,
					'X-SpaceBot-Guild': String(guildId),
				},
				body: JSON.stringify({
					type: 'variables',
					integration_slug: integration.slug,
					guild_id: guildId,
					discord_user_id: userId,
					keys: fetchable,
				}),
				signal: AbortSignal.timeout(VARIABLES_HANDLER_TIMEOUT_MS),
			});
			if (res.ok) {
				const data = await res.json();
				if (data && typeof data.values === 'object' && data.values) {
					values = data.values;
				}
				valueCache.set(cacheKey, {
					values: { ...(cached?.values || {}), ...values },
					expires: Date.now() + VARIABLES_CACHE_TTL_MS,
				});
			} else {
				log.warn(
					`[IntegrationVariables] ${integration.slug} handler returned ${res.status}`
				);
			}
		} catch (err) {
			log.warn(
				`[IntegrationVariables] ${integration.slug} handler unreachable: ${err?.message || err}`
			);
		}

		for (const key of fetchable) {
			const v = values[key];
			setPath(context, key, v !== undefined && v !== null ? String(v) : '');
		}
	}

	return context;
}
