import { describe, expect, it } from 'vitest';
import {
	applyInteractionOptionsToContext,
	applyInteractionOptionsToEvent,
	flattenInteractionOptions,
	SUBCOMMAND_GROUP_KEY,
	SUBCOMMAND_KEY,
	SUBCOMMAND_PATH_KEY,
} from '../lib/discord/interaction-options.js';

/** `/ping` — no options at all. */
const flatNone = { name: 'ping' };

/** `/greet user:@bob loud:true` */
const flatOptions = {
	name: 'greet',
	options: [
		{ name: 'user', type: 6, value: '111' },
		{ name: 'loud', type: 5, value: true },
	],
};

/** `/room create name:Study limit:4` */
const subcommand = {
	name: 'room',
	options: [
		{
			name: 'create',
			type: 1,
			options: [
				{ name: 'name', type: 3, value: 'Study' },
				{ name: 'limit', type: 4, value: 4 },
			],
		},
	],
};

/** `/room owner transfer user:@bob` */
const groupedSubcommand = {
	name: 'room',
	options: [
		{
			name: 'owner',
			type: 2,
			options: [
				{
					name: 'transfer',
					type: 1,
					options: [{ name: 'user', type: 6, value: '222' }],
				},
			],
		},
	],
};

describe('flattenInteractionOptions', () => {
	it('returns nothing for a command with no options', () => {
		const result = flattenInteractionOptions(flatNone);
		expect(result.leaves).toEqual([]);
		expect(result.subcommand).toBeNull();
		expect(result.subcommandGroup).toBeNull();
		expect(result.subcommandPath).toBeNull();
	});

	it('passes flat options straight through', () => {
		const result = flattenInteractionOptions(flatOptions);
		expect(result.leaves.map((o) => o.name)).toEqual(['user', 'loud']);
		expect(result.subcommand).toBeNull();
	});

	it('walks into a subcommand and records which one was invoked', () => {
		const result = flattenInteractionOptions(subcommand);
		expect(result.leaves.map((o) => o.name)).toEqual(['name', 'limit']);
		expect(result.subcommand).toBe('create');
		expect(result.subcommandGroup).toBeNull();
		expect(result.subcommandPath).toBe('create');
	});

	it('walks into a subcommand group', () => {
		const result = flattenInteractionOptions(groupedSubcommand);
		expect(result.leaves.map((o) => o.name)).toEqual(['user']);
		expect(result.subcommand).toBe('transfer');
		expect(result.subcommandGroup).toBe('owner');
		expect(result.subcommandPath).toBe('owner transfer');
	});

	it('tolerates junk entries', () => {
		const result = flattenInteractionOptions({
			options: [null, 'nope', { name: 'ok', type: 3, value: 1 }],
		});
		expect(result.leaves.map((o) => o.name)).toEqual(['ok']);
	});
});

describe('applyInteractionOptionsToEvent', () => {
	it('reads subcommand option values that the old flattening dropped', () => {
		const event: any = { options: {} };
		applyInteractionOptionsToEvent(event, subcommand);

		expect(event.options.name).toBe('Study');
		expect(event.options.limit).toBe(4);
		// The regression this replaces: `{ create: undefined }`.
		expect(event.options.create).toBeUndefined();
	});

	it('exposes the subcommand under reserved keys so action conditions can branch', () => {
		const event: any = {};
		applyInteractionOptionsToEvent(event, groupedSubcommand);

		expect(event.options[SUBCOMMAND_KEY]).toBe('transfer');
		expect(event.options[SUBCOMMAND_GROUP_KEY]).toBe('owner');
		expect(event.options[SUBCOMMAND_PATH_KEY]).toBe('owner transfer');
		expect(event.subcommand).toBe('transfer');
		expect(event.subcommand_group).toBe('owner');
	});

	it('keeps the legacy first-user-option target_id fallback', () => {
		const event: any = {};
		applyInteractionOptionsToEvent(event, flatOptions);
		expect(event.target_id).toBe('111');
	});

	it('finds the first user option inside a subcommand too', () => {
		const event: any = {};
		applyInteractionOptionsToEvent(event, groupedSubcommand);
		expect(event.target_id).toBe('222');
	});

	it('does not overwrite a target_id already resolved from a context menu', () => {
		const event: any = { target_id: '999' };
		applyInteractionOptionsToEvent(event, flatOptions);
		expect(event.target_id).toBe('999');
	});

	it('lets the reserved subcommand key win over a colliding user option', () => {
		const event: any = {};
		applyInteractionOptionsToEvent(event, {
			options: [
				{
					name: 'create',
					type: 1,
					options: [{ name: SUBCOMMAND_KEY, type: 3, value: 'spoofed' }],
				},
			],
		});
		expect(event.options[SUBCOMMAND_KEY]).toBe('create');
	});
});

describe('applyInteractionOptionsToContext', () => {
	it('adds mention forms for user, channel and role options', () => {
		const context: any = { option: {} };
		applyInteractionOptionsToContext(context, {
			options: [
				{
					name: 'invite',
					type: 1,
					options: [
						{ name: 'user', type: 6, value: '111' },
						{ name: 'chan', type: 7, value: '222' },
						{ name: 'role', type: 8, value: '333' },
					],
				},
			],
		});

		expect(context.option.user_mention).toBe('<@111>');
		expect(context.option.chan_mention).toBe('<#222>');
		expect(context.option.role_mention).toBe('<@&333>');
	});

	it('exposes {subcommand.*} for response templates', () => {
		const context: any = {};
		applyInteractionOptionsToContext(context, groupedSubcommand);

		expect(context.subcommand).toEqual({
			name: 'transfer',
			group: 'owner',
			path: 'owner transfer',
		});
	});

	it('leaves {subcommand.*} blank for a flat command', () => {
		const context: any = {};
		applyInteractionOptionsToContext(context, flatOptions);
		expect(context.subcommand).toEqual({ name: '', group: '', path: '' });
	});
});
