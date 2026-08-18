/**
 * "Someone joined, I got the DM, but nothing happened when they accepted the
 * rules."
 *
 * Two distinct blind spots produced that, and the second one is why a member
 * showed "Agreed to Rules ✓" in Discord's own Mod View while the bot had logged
 * nothing at all:
 *
 *  1. `oldMember` is a partial whenever the member was not cached — after a
 *     restart or a shard reconnect — and `pending` is null on a partial, so the
 *     old `oldMember.pending === true` test could never match.
 *  2. Discord has TWO doors. Membership Screening flips `pending`; Onboarding
 *     flips the COMPLETED_ONBOARDING flag and can leave `pending` true forever.
 *     Only the first was ever checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, GuildMemberFlags } from 'discord.js';

vi.mock('../lib/secrets.js', () => ({
	loadSecrets: async () => {},
	getSecret: () => undefined,
	isPlaceholderSecret: () => false,
	REQUIRED_SECRETS: [],
	reportSecretHealth: () => ({ ok: true, missing: [], placeholder: [] }),
}));

const { setupEventHandlers } = await import('../lib/discord/gateway.js');

const GUILD = '1009583217948491928';
type Handler = (...args: any[]) => any | Promise<any>;
let handlers: Record<string, Handler>;
let logged: any[];

/** Minimal client that just captures the handlers setupEventHandlers registers. */
function wire() {
	handlers = {};
	logged = [];
	const client: any = {
		on: (event: string, fn: Handler) => {
			handlers[event] = fn;
		},
		user: { id: 'bot' },
		guilds: { cache: new Map() },
	};
	setupEventHandlers(client, async (event: any) => logged.push(event));
	return client;
}

function member({ pending = false, onboarded = false, partial = false, id = 'u1' } = {}) {
	return {
		partial,
		pending: partial ? null : pending,
		nickname: null,
		user: { id, tag: `${id}#0001`, username: id, bot: false, avatar: null, discriminator: '0' },
		guild: { id: GUILD },
		// discord.js uses Collections, which are Maps that also have .map()
		roles: { cache: Object.assign(new Map(), { map: () => [] }) },
		flags: partial
			? undefined
			: { has: (bit: any) => onboarded && bit === GuildMemberFlags.CompletedOnboarding },
	};
}

const rulesEvents = () => logged.filter((e) => e.details?.rules_accepted === true);

beforeEach(() => wire());

describe('detecting that a member got through the door', () => {
	it('still catches the classic membership-screening transition', async () => {
		await handlers[Events.GuildMemberUpdate](
			member({ pending: true }),
			member({ pending: false })
		);

		expect(rulesEvents()).toHaveLength(1);
		expect(rulesEvents()[0].details.rules_accepted_via).toBe('membership_screening');
	});

	it('catches onboarding completion even though pending never flips', async () => {
		// hehe_42948: COMPLETED_ONBOARDING set, pending stuck true. Previously
		// this produced no `changes` at all, so nothing was logged and no
		// automation ran.
		await handlers[Events.GuildMemberUpdate](
			member({ pending: true, onboarded: false }),
			member({ pending: true, onboarded: true })
		);

		expect(rulesEvents()).toHaveLength(1);
		expect(rulesEvents()[0].details.rules_accepted_via).toBe('onboarding');
	});

	it('survives a partial oldMember by remembering who was pending', async () => {
		// The member joins while pending — that is what we record.
		await handlers[Events.GuildMemberAdd](member({ pending: true, id: 'u2' }));

		// Later the cache has lost them, so discord.js hands us a partial.
		await handlers[Events.GuildMemberUpdate](
			member({ partial: true, id: 'u2' }),
			member({ pending: false, id: 'u2' })
		);

		expect(rulesEvents()).toHaveLength(1);
	});

	it('welcomes them once, not twice, when both signals arrive', async () => {
		await handlers[Events.GuildMemberUpdate](
			member({ pending: true, id: 'u3' }),
			member({ pending: false, id: 'u3' })
		);
		// Onboarding completes afterwards — must not fire a second welcome.
		await handlers[Events.GuildMemberUpdate](
			member({ pending: false, onboarded: false, id: 'u3' }),
			member({ pending: false, onboarded: true, id: 'u3' })
		);

		expect(rulesEvents()).toHaveLength(1);
	});

	it('stays quiet for an ordinary update', async () => {
		await handlers[Events.GuildMemberUpdate](
			member({ pending: false, onboarded: true }),
			member({ pending: false, onboarded: true })
		);

		expect(rulesEvents()).toHaveLength(0);
	});
});
