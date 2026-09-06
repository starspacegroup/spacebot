import { describe, expect, it } from 'vitest';
import { getCommandByName } from '../lib/db/commands.js';

/**
 * Two-step D1 stand-in: `getCommandByName` looks for a guild command first,
 * then falls back to the built-in join. This returns null then the built-in row.
 */
function fakeDb(builtInRow: any) {
	let call = 0;
	return {
		prepare: () => ({
			bind: () => ({
				first: async () => {
					call += 1;
					return call === 1 ? null : builtInRow;
				},
			}),
		}),
	} as any;
}

const baseRow = {
	id: 12,
	guild_id: '__built_in__',
	name: 'room',
	enabled: 1,
	is_built_in: 1,
	options: '[]',
	action_config: '{}',
	action_type: 'MULTIPLE',
	default_member_permissions: null,
};

describe('getCommandByName on built-in commands', () => {
	it("applies a guild's tightened permission override", async () => {
		const command = await getCommandByName(
			fakeDb({ ...baseRow, override_member_permissions: '16' }),
			'room',
			'guild1'
		);

		// Enforced at dispatch, not only in Discord's own command UI.
		expect(command.default_member_permissions).toBe('16');
	});

	it('keeps the built-in default when the guild set no override', async () => {
		const command = await getCommandByName(
			fakeDb({
				...baseRow,
				default_member_permissions: '8',
				override_member_permissions: null,
			}),
			'room',
			'guild1'
		);

		expect(command.default_member_permissions).toBe('8');
	});
});
