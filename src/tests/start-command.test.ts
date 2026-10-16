import { describe, it, expect } from 'vitest';
import {
	buildStartCommand,
	resolveStartInteraction,
	START_ACTIVITIES,
} from '../lib/discord/start-command.js';

const timebox = {
	name: 'timebox',
	type: 1,
	options: [
		{ type: 1, name: 'start', options: [{ type: 4, name: 'focus' }] },
		{ type: 1, name: 'stop' },
	],
};
const quorum = {
	name: 'quorum',
	type: 1,
	options: [{ type: 1, name: 'ask', options: [{ type: 3, name: 'question' }] }],
};
const play = { name: 'play', type: 1, options: [{ type: 1, name: 'start' }] };

describe('buildStartCommand', () => {
	it('is absent when no activity is on', () => {
		expect(buildStartCommand([{ name: 'ping', type: 1 }])).toBeNull();
	});

	it('lists only the activities the server has', () => {
		const names = (cmds) => buildStartCommand(cmds)?.options.map((o) => o.name);
		expect(names([timebox])).toEqual(['timebox']);
		expect(names([play])).toEqual(['agent']);
		expect(names([timebox, play])).toEqual(['timebox', 'agent']);
	});

	it('puts /quorum ask under /start quorum', () => {
		const start = buildStartCommand([quorum]);
		expect(start?.options[0].name).toBe('quorum');
		expect(start?.options[0].options).toEqual(quorum.options[0].options);
	});

	it('carries the options of /timebox start, not a copy', () => {
		const start = buildStartCommand([timebox, play]);
		expect(start?.options[0].options).toEqual(timebox.options[0].options);
		expect(start?.options[1].options).toBeUndefined();
	});

	it('ignores context-menu commands of the same name', () => {
		expect(buildStartCommand([{ name: 'play', type: 2 }])).toBeNull();
	});

	it('names every activity once', () => {
		const names = START_ACTIVITIES.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('resolveStartInteraction', () => {
	it('leaves other commands alone', () => {
		const data = { name: 'ping' };
		expect(resolveStartInteraction(data)).toBe(data);
	});

	it('turns /start timebox into /timebox start with its options', () => {
		const out = resolveStartInteraction({
			id: '1',
			name: 'start',
			options: [
				{ type: 1, name: 'timebox', options: [{ name: 'focus', type: 4, value: 25 }] },
			],
		});
		expect(out).toEqual({
			id: '1',
			name: 'timebox',
			options: [{ type: 1, name: 'start', options: [{ name: 'focus', type: 4, value: 25 }] }],
		});
	});

	it('turns /start agent into /play start', () => {
		const out = resolveStartInteraction({
			name: 'start',
			options: [{ type: 1, name: 'agent' }],
		});
		expect(out.name).toBe('play');
		expect(out.options).toEqual([{ type: 1, name: 'start', options: [] }]);
	});

	it('turns /start quorum into /quorum ask', () => {
		const out = resolveStartInteraction({
			name: 'start',
			options: [
				{ type: 1, name: 'quorum', options: [{ name: 'question', value: 'Pizza?' }] },
			],
		});
		expect(out.name).toBe('quorum');
		expect(out.options).toEqual([
			{ type: 1, name: 'ask', options: [{ name: 'question', value: 'Pizza?' }] },
		]);
	});

	it('refuses a subcommand it does not know', () => {
		expect(
			resolveStartInteraction({ name: 'start', options: [{ type: 1, name: 'nope' }] })
		).toBeNull();
		expect(resolveStartInteraction({ name: 'start' })).toBeNull();
	});
});
