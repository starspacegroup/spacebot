import { describe, expect, it } from 'vitest';
import { toDiscordCommand } from '../lib/db/commands.js';

describe('toDiscordCommand with subcommands', () => {
	const command = {
		name: 'room',
		description: 'Manage your room',
		dm_permission: false,
		options: [
			{
				name: 'create',
				description: 'Create a room',
				type: 1,
				options: [
					{ name: 'name', description: 'Room name', type: 3, required: true },
					{
						name: 'limit',
						description: 'User limit',
						type: 4,
						required: false,
						min_value: 0,
						max_value: 99,
					},
				],
			},
			{
				name: 'owner',
				description: 'Ownership',
				type: 2,
				options: [
					{
						name: 'transfer',
						description: 'Hand the room over',
						type: 1,
						options: [
							{ name: 'user', description: 'New owner', type: 6, required: true },
						],
					},
				],
			},
		],
	};

	it('registers subcommand children instead of dropping them', () => {
		const payload: any = toDiscordCommand(command);
		const create = payload.options.find((o) => o.name === 'create');

		expect(create.options.map((o) => o.name)).toEqual(['name', 'limit']);
		expect(create.options[0].required).toBe(true);
	});

	it('recurses through a subcommand group', () => {
		const payload: any = toDiscordCommand(command);
		const transfer = payload.options
			.find((o) => o.name === 'owner')
			.options.find((o) => o.name === 'transfer');

		expect(transfer.options.map((o) => o.name)).toEqual(['user']);
	});

	it('omits `required` on containers, which Discord rejects', () => {
		const payload: any = toDiscordCommand(command);
		expect(payload.options[0].required).toBeUndefined();
		expect(payload.options[1].required).toBeUndefined();
	});

	it('passes numeric bounds through on leaf options', () => {
		const payload: any = toDiscordCommand(command);
		const limit = payload.options[0].options[1];
		expect(limit.min_value).toBe(0);
		expect(limit.max_value).toBe(99);
	});
});
