import { describe, expect, it } from 'vitest';
import {
	JSON_RETRY_NUDGE,
	buildListingPrompt,
	extractJsonObject,
	generateListingDraft,
	parseListingDraft,
} from '../lib/ai/listing-draft.js';
import {
	inviteUrlFromCode,
	isPermanentInvite,
	pickExistingInvite,
	pickInviteChannels,
	resolvePermanentInvite,
} from '../lib/discord/invites.js';
import { MAX_DESCRIPTION, MAX_HEADLINE, MAX_TAGS } from '../lib/db/server-listings.js';

describe('buildListingPrompt', () => {
	it('grounds the model in the guild’s own data', () => {
		const { system, user } = buildListingPrompt({
			name: 'Orbital Workshop',
			description: 'A builders guild',
			memberCount: 4821,
			channelNames: ['general', 'build-logs', 'help'],
		});
		expect(user).toContain('Orbital Workshop');
		expect(user).toContain('A builders guild');
		expect(user).toContain('build-logs');
		expect(system).toContain('JSON');
		// The category list must be in the prompt or the model can't pick a valid one.
		expect(system).toContain('gaming');
		expect(system).toContain('community');
	});

	it('tells the model not to invent facts', () => {
		const { system } = buildListingPrompt({ name: 'X' });
		expect(system.toLowerCase()).toContain('do not invent');
	});

	it('degrades gracefully when almost nothing is known', () => {
		// A name is still a fact, so the prompt uses it and skips the fallback…
		const named = buildListingPrompt({ name: 'Bare Server' });
		expect(named.user).toContain('Bare Server');
		expect(named.user).not.toContain('No details are available');

		// …and only with nothing at all does it tell the model so, rather than
		// handing it an empty fact list and inviting invention.
		expect(buildListingPrompt({}).user).toContain('No details are available');
	});

	it('caps channel names so a huge server cannot blow up the prompt', () => {
		const channelNames = Array.from({ length: 200 }, (_, i) => `channel-${i}`);
		const { user } = buildListingPrompt({ name: 'Big', channelNames });
		expect(user).not.toContain('channel-100');
	});
});

describe('extractJsonObject', () => {
	it('reads plain JSON', () => {
		expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
	});

	it('reads JSON out of a fenced block', () => {
		expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	});

	it('reads JSON wrapped in the chatter small models add', () => {
		expect(extractJsonObject('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({
			a: 1,
		});
	});

	it('returns null for junk rather than throwing', () => {
		expect(extractJsonObject('no json here')).toBeNull();
		expect(extractJsonObject('')).toBeNull();
		expect(extractJsonObject('[1,2,3]')).toBeNull(); // an array is not a draft
	});
});

describe('parseListingDraft', () => {
	it('accepts a well-formed draft', () => {
		const result = parseListingDraft(
			JSON.stringify({
				headline: 'A friendly place for builders',
				description: 'We run weekly build jams.',
				category: 'tech',
				tags: ['hardware', 'diy'],
			})
		);
		expect(result.ok).toBe(true);
		expect(result.draft).toMatchObject({
			headline: 'A friendly place for builders',
			category: 'tech',
			tags: ['hardware', 'diy'],
		});
	});

	it('clamps the model to the same limits a human gets', () => {
		const result = parseListingDraft(
			JSON.stringify({
				headline: 'x'.repeat(400),
				description: 'y'.repeat(4000),
				category: 'community',
				tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
			})
		);
		expect(result.draft!.headline).toHaveLength(MAX_HEADLINE);
		expect(result.draft!.description).toHaveLength(MAX_DESCRIPTION);
		expect(result.draft!.tags).toHaveLength(MAX_TAGS);
	});

	it('falls back to a real category when the model invents one', () => {
		const result = parseListingDraft(
			JSON.stringify({ headline: 'hi', description: 'x', category: 'cryptocurrency-scams' })
		);
		expect(result.draft!.category).toBe('community');
	});

	it('accepts a category in the wrong case', () => {
		const result = parseListingDraft(
			JSON.stringify({ headline: 'hi', description: 'x', category: 'Gaming' })
		);
		expect(result.draft!.category).toBe('gaming');
	});

	it('collapses newlines injected into the single-line headline', () => {
		const result = parseListingDraft(
			JSON.stringify({ headline: 'one\n\ntwo   three', description: 'x' })
		);
		expect(result.draft!.headline).toBe('one two three');
	});

	it('fails cleanly on unusable output instead of producing an empty listing', () => {
		expect(parseListingDraft('the model rambled').ok).toBe(false);
		expect(parseListingDraft(JSON.stringify({ headline: '', description: '' })).ok).toBe(false);
	});

	it('tolerates tags arriving as a comma string', () => {
		const result = parseListingDraft(
			JSON.stringify({ headline: 'hi', description: 'x', tags: 'a, b, c' })
		);
		expect(result.draft!.tags).toEqual(['a', 'b', 'c']);
	});
});

describe('invite helpers', () => {
	it('only builds discord.gg URLs from a sane code', () => {
		expect(inviteUrlFromCode('abc123')).toBe('https://discord.gg/abc123');
		expect(inviteUrlFromCode('')).toBeNull();
		expect(inviteUrlFromCode(null)).toBeNull();
		expect(inviteUrlFromCode('../evil')).toBeNull();
		expect(inviteUrlFromCode('a/b')).toBeNull();
	});

	it('treats only never-expiring unlimited invites as permanent', () => {
		expect(isPermanentInvite({ max_age: 0, max_uses: 0 })).toBe(true);
		expect(isPermanentInvite({ max_age: 86400, max_uses: 0 })).toBe(false);
		expect(isPermanentInvite({ max_age: 0, max_uses: 5 })).toBe(false);
		expect(isPermanentInvite({})).toBe(false);
	});

	it('reuses a permanent invite, preferring one the bot made', () => {
		const invites = [
			{ code: 'temp', max_age: 3600, max_uses: 0 },
			{ code: 'theirs', max_age: 0, max_uses: 0, inviter: { id: '999' } },
			{ code: 'ours', max_age: 0, max_uses: 0, inviter: { id: 'bot' } },
		];
		expect(pickExistingInvite(invites, 'bot')!.code).toBe('ours');
		expect(pickExistingInvite(invites, null)!.code).toBe('theirs');
		expect(
			pickExistingInvite([{ code: 'temp', max_age: 3600, max_uses: 0 }], 'bot')
		).toBeNull();
		expect(pickExistingInvite([], 'bot')).toBeNull();
	});

	it('prefers rules, then system, then plain text channels', () => {
		const channels = [
			{ id: '3', type: 0, position: 0, name: 'general' },
			{ id: '2', type: 0, position: 5, name: 'welcome' },
			{ id: '1', type: 0, position: 9, name: 'rules' },
		];
		const ranked = pickInviteChannels(channels, {
			rulesChannelId: '1',
			systemChannelId: '2',
		});
		expect(ranked.map((c) => c.id)).toEqual(['1', '2', '3']);
	});

	it('never offers a category or thread as an invite target', () => {
		const channels = [
			{ id: 'cat', type: 4, position: 0 },
			{ id: 'thread', type: 11, position: 1 },
			{ id: 'text', type: 0, position: 2 },
			{ id: 'voice', type: 2, position: 3 },
			{ id: 'forum', type: 15, position: 4 },
		];
		const ids = pickInviteChannels(channels).map((c) => c.id);
		expect(ids).not.toContain('cat');
		expect(ids).not.toContain('thread');
		expect(ids).toEqual(['text', 'voice', 'forum']);
	});

	it('returns nothing when no channel can host an invite', () => {
		expect(pickInviteChannels([{ id: 'cat', type: 4 }])).toEqual([]);
		expect(pickInviteChannels([])).toEqual([]);
	});
});

describe('generateListingDraft retry', () => {
	/** Minimal env that routes through the Ollama branch, with a stubbed fetch. */
	function ollamaEnv() {
		return { AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'test', OLLAMA_BASE_URL: 'http://x' };
	}

	function stubOllama(replies: string[]) {
		const seen: string[] = [];
		const originalFetch = globalThis.fetch;
		let call = 0;
		globalThis.fetch = (async (_url: any, init: any) => {
			seen.push(JSON.parse(init.body).messages.at(-1).content);
			const content = replies[Math.min(call++, replies.length - 1)];
			return { ok: true, json: async () => ({ message: { content } }) } as any;
		}) as any;
		return { seen, restore: () => (globalThis.fetch = originalFetch) };
	}

	it('retries once with a blunter instruction when the first reply is not JSON', async () => {
		const stub = stubOllama([
			'Sure, here is a listing!',
			'{"headline":"Hi","description":"There"}',
		]);
		try {
			const result = await generateListingDraft({ name: 'X' }, ollamaEnv());
			expect(result.ok).toBe(true);
			if (!result.ok || !result.draft) {
				throw new Error(`Expected a generated listing draft, got: ${result.error}`);
			}
			expect(result.draft.headline).toBe('Hi');
			expect(stub.seen).toHaveLength(2);
			expect(stub.seen[0]).not.toContain(JSON_RETRY_NUDGE);
			expect(stub.seen[1]).toContain(JSON_RETRY_NUDGE);
		} finally {
			stub.restore();
		}
	});

	it('does not retry when the first reply already parses', async () => {
		const stub = stubOllama(['{"headline":"Good","description":"First time"}']);
		try {
			const result = await generateListingDraft({ name: 'X' }, ollamaEnv());
			expect(result.ok).toBe(true);
			expect(stub.seen).toHaveLength(1);
		} finally {
			stub.restore();
		}
	});

	it('gives up after the retry rather than looping', async () => {
		const stub = stubOllama(['nope', 'still nope']);
		try {
			const result = await generateListingDraft({ name: 'X' }, ollamaEnv());
			expect(result.ok).toBe(false);
			expect(stub.seen).toHaveLength(2);
		} finally {
			stub.restore();
		}
	});
});

describe('resolvePermanentInvite error messages', () => {
	function stubFetch(status: number, body: any = {}) {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => ({
			ok: false,
			status,
			json: async () => body,
		})) as any;
		return () => (globalThis.fetch = original);
	}

	it('tells the operator, not the admin, when the bot token is rejected', async () => {
		const restore = stubFetch(401, { message: 'Unauthorized' });
		try {
			const r = await resolvePermanentInvite('token', '111111111111111111');
			expect(r.ok).toBe(false);
			// The admin can't act on "401: Unauthorized".
			expect(r.error).not.toMatch(/^401/);
			expect(r.error).toMatch(/bot token/i);
		} finally {
			restore();
		}
	});

	it('tells the admin to check bot membership on a 403/404', async () => {
		const restore = stubFetch(403, { message: 'Missing Access' });
		try {
			const r = await resolvePermanentInvite('token', '111111111111111111');
			expect(r.error).toMatch(/still a member/i);
		} finally {
			restore();
		}
	});

	it('uses a guild vanity URL without calling Discord at all', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error('should not be called');
		}) as any;
		try {
			const r = await resolvePermanentInvite('token', '111111111111111111', {
				vanityUrlCode: 'coworking',
			});
			expect(r).toMatchObject({
				ok: true,
				url: 'https://discord.gg/coworking',
				source: 'vanity',
			});
		} finally {
			globalThis.fetch = original;
		}
	});

	it('rejects a malformed guild id before touching the network', async () => {
		const r = await resolvePermanentInvite('token', 'nope');
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/guild id/i);
	});
});
