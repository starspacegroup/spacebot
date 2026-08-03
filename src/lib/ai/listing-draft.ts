/**
 * AI-drafted copy for a public server browser listing.
 *
 * Deliberately not routed through `generateChatResponse`: that path is the
 * conversational DM assistant, with MCP tools, runner inventory and a large
 * system prompt. This is one bounded completion that has to come back as JSON,
 * so it uses the shared `callAI` transport (model fallback + AI Gateway) and
 * nothing else.
 *
 * Prompt construction and parsing are pure functions so they can be tested
 * without a model — the parsing is where the real risk lives, since a small
 * model's "JSON" routinely arrives wrapped in prose or fences.
 */

import { DEFAULT_OLLAMA_MODEL, callAI, callOllamaChat, isOllamaSelected } from './chat.js';
import {
	LISTING_CATEGORIES,
	LISTING_CATEGORY_VALUES,
	MAX_DESCRIPTION,
	MAX_HEADLINE,
	MAX_TAGS,
	parseTags,
} from '../db/server-listings.js';

export interface ListingDraftContext {
	name?: string | null;
	description?: string | null;
	memberCount?: number | null;
	features?: string[] | null;
	channelNames?: string[] | null;
	existingHeadline?: string | null;
	existingDescription?: string | null;
}

/** Channel names are the strongest signal about what a server is actually for. */
const MAX_CHANNELS_IN_PROMPT = 25;

export function buildListingPrompt(context: ListingDraftContext): {
	system: string;
	user: string;
} {
	const categoryList = LISTING_CATEGORIES.map((c) => `${c.value} (${c.label})`).join(', ');

	const system = [
		'You write short, concrete directory listings for Discord communities.',
		'',
		'Reply with ONLY a JSON object, no prose and no code fences, shaped exactly:',
		'{"headline": string, "description": string, "category": string, "tags": string[]}',
		'',
		`- headline: one sentence, at most ${MAX_HEADLINE} characters. What this server is, plainly.`,
		`- description: 2-4 sentences, at most ${MAX_DESCRIPTION} characters. Who it is for and what happens there.`,
		`- category: exactly one of: ${categoryList}`,
		`- tags: up to ${MAX_TAGS} short lowercase topic words. No "#".`,
		'',
		'Write in a warm, plain voice. Do not invent facts that are not supported by the',
		'details given — no member numbers, no events, no claims about moderation or',
		'history. If the details are thin, stay general rather than making things up.',
		'Do not use marketing hype ("the best", "amazing community").',
	].join('\n');

	const facts: string[] = [];
	if (context.name) facts.push(`Server name: ${context.name}`);
	if (context.description)
		facts.push(`Server description set on Discord: ${context.description}`);
	if (context.memberCount) facts.push(`Approximate member count: ${context.memberCount}`);
	if (context.features?.length) {
		facts.push(`Discord features enabled: ${context.features.slice(0, 10).join(', ')}`);
	}
	if (context.channelNames?.length) {
		facts.push(
			`Channel names: ${context.channelNames.slice(0, MAX_CHANNELS_IN_PROMPT).join(', ')}`
		);
	}
	if (context.existingHeadline) {
		facts.push(
			`The admin's current headline (improve on it, keep its intent): ${context.existingHeadline}`
		);
	}
	if (context.existingDescription) {
		facts.push(
			`The admin's current description (improve on it, keep its intent): ${context.existingDescription}`
		);
	}

	const user = [
		'Write the listing for this Discord server.',
		'',
		facts.length ? facts.join('\n') : 'No details are available beyond the server name.',
	].join('\n');

	return { system, user };
}

/**
 * Pull a JSON object out of whatever the model returned.
 *
 * Small models wrap JSON in ```json fences, prefix it with "Sure!", or trail a
 * closing remark, so scanning for the outermost braces is more reliable than
 * trusting the response to parse as-is.
 */
export function extractJsonObject(text: string): Record<string, any> | null {
	const raw = String(text || '').trim();
	if (!raw) return null;

	const candidates: string[] = [];
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) candidates.push(fenced[1].trim());

	const first = raw.indexOf('{');
	const last = raw.lastIndexOf('}');
	if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
	candidates.push(raw);

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
		} catch {
			// try the next candidate
		}
	}
	return null;
}

/**
 * Coerce a model response into a listing draft.
 *
 * Everything is clamped to the same limits a human submission gets — the draft
 * goes into the same form and through the same `validateListing` on save, so
 * the model gets no more latitude than a person typing.
 */
export function parseListingDraft(text: string): {
	ok: boolean;
	draft?: { headline: string; description: string; category: string; tags: string[] };
	error?: string;
} {
	const parsed = extractJsonObject(text);
	if (!parsed) return { ok: false, error: 'The AI response could not be read as JSON.' };

	const headline = String(parsed.headline ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_HEADLINE);
	const description = String(parsed.description ?? '')
		.trim()
		.slice(0, MAX_DESCRIPTION);
	const rawCategory = String(parsed.category ?? '')
		.trim()
		.toLowerCase();
	const category = LISTING_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : 'community';
	const tags = parseTags(parsed.tags).map((tag) => tag.toLowerCase());

	if (!headline && !description) {
		return { ok: false, error: 'The AI returned an empty draft.' };
	}

	return { ok: true, draft: { headline, description, category, tags } };
}

/** A blunter restatement for the retry, after the model ignored the format once. */
export const JSON_RETRY_NUDGE =
	'Your previous reply was not valid JSON. Reply with the JSON object and nothing else — ' +
	'no explanation, no code fences, starting with { and ending with }.';

/**
 * Generate a listing draft. Never throws — returns a typed failure instead.
 *
 * Retries once when the reply doesn't parse. Asking a model for JSON in one shot
 * is not reliable — observed live against a small local model, which returned
 * prose on its second call — and a retry is far cheaper than showing the admin
 * an error for something that usually works the next time.
 */
export async function generateListingDraft(
	context: ListingDraftContext,
	env: any,
	{ attempts = 2 }: { attempts?: number } = {}
) {
	const { system, user } = buildListingPrompt(context);
	let lastError = 'The AI service did not respond.';

	for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
		const userContent = attempt === 0 ? user : `${user}\n\n${JSON_RETRY_NUDGE}`;
		let text: string;
		try {
			// Honour the same provider switch the rest of the app uses. `isAIEnabled`
			// counts Ollama as configured, so routing everything through callAI (which
			// is Workers-AI only) would pass the gate and then fail on a dev box with
			// AI_PROVIDER=ollama.
			if (isOllamaSelected(env)) {
				text = await callOllamaChat({
					system,
					messages: [{ role: 'user', content: userContent }],
					model: env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
					baseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
				});
			} else {
				text = await callAI(
					[
						{ role: 'system', content: system },
						{ role: 'user', content: userContent },
					],
					env
				);
			}
		} catch (error: any) {
			// A transport failure won't be fixed by rephrasing the prompt.
			return { ok: false as const, error: error?.message || lastError };
		}

		const parsed = parseListingDraft(text);
		if (parsed.ok) return parsed;
		lastError = parsed.error || lastError;
	}

	return { ok: false as const, error: lastError };
}
