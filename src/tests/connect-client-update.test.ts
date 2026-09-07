import { beforeEach, describe, expect, it } from 'vitest';
import { updateConnectClient } from '../lib/db/connect-clients.js';

/**
 * Widening a registered client without rotating its secret.
 *
 * Before this existed the only way to add a scope was delete-and-recreate,
 * which mints a new secret — so growing a live integration meant editing its
 * environment and redeploying it, and in practice meant not growing it.
 */

function fakeDb(row: Record<string, unknown> | null) {
	const state = { row, lastSql: '', lastBinds: [] as unknown[], throwOnUpdate: false };
	const db: any = {
		state,
		prepare(sql: string) {
			const stmt = {
				_binds: [] as unknown[],
				bind(...args: unknown[]) {
					stmt._binds = args;
					return stmt;
				},
				async first() {
					return state.row;
				},
				async run() {
					if (state.throwOnUpdate) throw new Error('d1 down');
					state.lastSql = sql;
					state.lastBinds = stmt._binds;
					return { meta: { changes: 1 } };
				},
			};
			return stmt;
		},
	};
	return db;
}

const CLIENT = {
	client_id: 'starspace-website',
	name: '*Space',
	description: null,
	redirect_uris: JSON.stringify(['https://starspace.group/admin/spacebot/callback']),
	allowed_scopes: JSON.stringify(['voice:read', 'stats:read']),
	enabled: 1,
	client_secret_hash: 'never-touched',
};

let db: any;
beforeEach(() => {
	db = fakeDb({ ...CLIENT });
});

describe('updateConnectClient', () => {
	it('replaces the scopes and leaves the secret alone', async () => {
		const result = await updateConnectClient(db, 'starspace-website', {
			scopes: ['voice:read', 'stats:read', 'channels:read', 'commands:read'],
		});

		expect(result.success).toBe(true);
		expect(db.state.lastSql).toContain('allowed_scopes = ?');
		expect(db.state.lastSql).not.toContain('client_secret_hash');
		expect(JSON.parse(db.state.lastBinds[0] as string)).toEqual([
			'voice:read',
			'stats:read',
			'channels:read',
			'commands:read',
		]);
	});

	it('replaces rather than merges, so a scope can be taken away', async () => {
		await updateConnectClient(db, 'starspace-website', { scopes: ['voice:read'] });
		expect(JSON.parse(db.state.lastBinds[0] as string)).toEqual(['voice:read']);
	});

	it('drops a duplicate scope', async () => {
		await updateConnectClient(db, 'starspace-website', {
			scopes: ['voice:read', 'voice:read', 'stats:read'],
		});
		expect(JSON.parse(db.state.lastBinds[0] as string)).toEqual(['voice:read', 'stats:read']);
	});

	it('refuses a scope SpaceBot does not define', async () => {
		const result = await updateConnectClient(db, 'starspace-website', {
			scopes: ['voice:read', 'everything:always'],
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('everything:always');
	});

	it('refuses to leave a client with no scopes at all', async () => {
		// It would still be registered, still be enabled, and never work.
		const result = await updateConnectClient(db, 'starspace-website', { scopes: [] });
		expect(result).toMatchObject({ success: false });
		expect(result.error).toMatch(/never be used/);
	});

	it('validates redirect URIs exactly as registration does', async () => {
		expect(
			await updateConnectClient(db, 'starspace-website', {
				redirectUris: ['http://evil.test/steal'],
			})
		).toMatchObject({ success: false });

		expect(
			await updateConnectClient(db, 'starspace-website', {
				redirectUris: ['https://starspace.group/admin/spacebot/callback'],
			})
		).toMatchObject({ success: true });
	});

	it('refuses to leave a client with no redirect URI', async () => {
		expect(
			await updateConnectClient(db, 'starspace-website', { redirectUris: [] })
		).toMatchObject({ success: false });
	});

	it('can rename without touching anything else', async () => {
		const result = await updateConnectClient(db, 'starspace-website', { name: 'Star Space' });
		expect(result.success).toBe(true);
		expect(db.state.lastSql).toContain('name = ?');
		expect(db.state.lastSql).not.toContain('allowed_scopes');
	});

	it('refuses an unknown client rather than inserting one', async () => {
		const missing = fakeDb(null);
		const result = await updateConnectClient(missing, 'nope', { scopes: ['voice:read'] });
		expect(result.success).toBe(false);
		expect(missing.state.lastSql).toBe('');
	});

	it('refuses a call with nothing to change', async () => {
		expect(await updateConnectClient(db, 'starspace-website', {})).toMatchObject({
			success: false,
			error: 'Nothing to update',
		});
	});

	it('needs a database and a client id', async () => {
		expect(await updateConnectClient(null, 'x', { scopes: ['voice:read'] })).toMatchObject({
			success: false,
		});
		expect(await updateConnectClient(db, '', { scopes: ['voice:read'] })).toMatchObject({
			success: false,
		});
	});

	it('reports a write failure rather than throwing', async () => {
		db.state.throwOnUpdate = true;
		expect(
			await updateConnectClient(db, 'starspace-website', { scopes: ['voice:read'] })
		).toMatchObject({ success: false });
	});
});
