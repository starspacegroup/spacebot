import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	const calls: Record<string, any[]> = {};
	const state = { shiritoriFails: false };
	const spy =
		(name: string, value: any = { ok: true }) =>
		(...args: any[]) => {
			calls[name] = args;
			return typeof value === 'function' ? value(...args) : value;
		};
	return { calls, state, spy };
});
const { calls } = h;

vi.mock('$lib/db/managed-channels.js', () => ({
	listRoomsForReaping: h.spy('listRoomsForReaping', [{ id: 1 }, { id: 2 }]),
}));
vi.mock('$lib/server/managed-channel-reaper.js', () => ({
	reapManagedChannels: h.spy('reapManagedChannels', { reaped: 1 }),
}));
vi.mock('$lib/server/quorum.js', () => ({ sweepQuorum: h.spy('sweepQuorum', { closed: 0 }) }));
vi.mock('$lib/server/timebox.js', () => ({ sweepTimebox: h.spy('sweepTimebox', { moved: 0 }) }));
vi.mock('$lib/server/game.js', () => ({ sweepGame: h.spy('sweepGame', { resolved: 2 }) }));
vi.mock('$lib/server/shiritori-game.js', () => ({
	sweepShiritori: h.spy('sweepShiritori', () =>
		h.state.shiritoriFails
			? Promise.reject(new Error('boom'))
			: Promise.resolve({ timedOut: 1 })
	),
}));
vi.mock('$lib/discord/rest-client.js', () => ({
	createDiscordRestClient: (token: string) => ({ token }),
}));
vi.mock('$lib/discord/commands.js', () => ({
	sweepCommandSync: h.spy('sweepCommandSync', { checked: 3, synced: 1 }),
}));

import {
	executeWorkflowOperation,
	hasWorkflowOperation,
} from '../lib/server/superadmin-workflow-operations.js';
import { OPERATION_TEMPLATES } from '../lib/server/superadmin-workflow-presets.js';

const db = { tag: 'db' };
const ctx = (extra: Record<string, any> = {}) => ({
	db,
	botToken: 'tok',
	platform: { env: { DISCORD_CLIENT_ID: 'c' } },
	variables: {} as Record<string, any>,
	data: {},
	...extra,
});

beforeEach(() => {
	for (const k of Object.keys(calls)) delete calls[k];
	h.state.shiritoriFails = false;
});

describe('minute sweep operations', () => {
	it('registers every operation a preset names', () => {
		for (const t of OPERATION_TEMPLATES as any[]) {
			for (const node of t.canvas_json.nodes) {
				const op = node.data?.operation;
				if (op) expect(hasWorkflowOperation(op), `${t.slug}:${node.id} → ${op}`).toBe(true);
			}
		}
	});

	it('counts open rooms and reaps them', async () => {
		const c = ctx();
		expect(await executeWorkflowOperation('listRoomsForReaping', c)).toEqual({ count: 2 });
		expect(c.variables.rooms_open).toBe(2);
		expect(await executeWorkflowOperation('reapManagedChannels', ctx())).toEqual({ reaped: 1 });
		expect(calls.reapManagedChannels).toEqual([db, 'tok']);
	});

	it('runs the timebox and quorum sweeps with the bot token', async () => {
		await executeWorkflowOperation('sweepTimebox', ctx());
		await executeWorkflowOperation('sweepQuorum', ctx());
		expect(calls.sweepTimebox).toEqual([db, 'tok']);
		expect(calls.sweepQuorum).toEqual([db, 'tok']);
	});

	it('runs the game sweep and Shiritori, and survives a Shiritori failure', async () => {
		expect(await executeWorkflowOperation('sweepGame', ctx())).toEqual({
			resolved: 2,
			shiritori: { timedOut: 1 },
		});
		expect(calls.sweepShiritori).toEqual([db, { token: 'tok' }]);
		h.state.shiritoriFails = true;
		expect(await executeWorkflowOperation('sweepGame', ctx())).toEqual({
			resolved: 2,
			shiritori: { error: 'boom' },
		});
	});

	it('syncs commands with the platform env, else process.env', async () => {
		expect(await executeWorkflowOperation('syncCommands', ctx())).toEqual({
			checked: 3,
			synced: 1,
		});
		expect(calls.sweepCommandSync).toEqual([db, { DISCORD_CLIENT_ID: 'c' }]);
		await executeWorkflowOperation('syncCommands', ctx({ platform: undefined }));
		expect(calls.sweepCommandSync[1]).toBe(process.env);
	});

	it('refuses the token-bound sweeps without a bot token', async () => {
		for (const op of [
			'reapManagedChannels',
			'sweepTimebox',
			'sweepGame',
			'sweepQuorum',
			'syncCommands',
		]) {
			await expect(executeWorkflowOperation(op, ctx({ botToken: null }))).rejects.toThrow(
				'Bot token not configured'
			);
		}
	});
});
