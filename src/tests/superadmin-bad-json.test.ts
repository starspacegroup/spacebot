/**
 * A malformed or non-object JSON body on a superadmin write route is the
 * caller's mistake, so it must answer 400. It used to throw out of
 * `request.json()` and surface as a 500 (and a Sentry event).
 */
import { describe, expect, it } from 'vitest';
import { POST as postUser } from '../routes/api/superadmin/users/+server.js';
import { PATCH as putUser } from '../routes/api/superadmin/users/[userId]/+server.js';
import { POST as postServer } from '../routes/api/superadmin/servers/+server.js';
import { POST as postWorkflow } from '../routes/api/superadmin/workflows/+server.js';

const platform = { env: { ADMIN_USER_IDS: '1', DB: {} } };
const cookies = { get: () => '1' };
const req = (body: string) => new Request('http://x/', { method: 'POST', body });

const routes: [string, (e: any) => Promise<Response>][] = [
	['users', postUser as any],
	['users/[userId]', putUser as any],
	['servers', postServer as any],
	['workflows', postWorkflow as any],
];

describe('superadmin write routes reject a bad JSON body', () => {
	for (const [name, handler] of routes) {
		for (const body of ['{not json', 'null', '"text"']) {
			it(`${name} answers 400 for ${body}`, async () => {
				const res = await handler({
					cookies,
					platform,
					params: { userId: '2' },
					request: req(body),
				});
				expect(res.status).toBe(400);
			});
		}
	}
});
