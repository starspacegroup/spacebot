import { describe, it, expect, vi } from 'vitest';

const createRun = vi.fn(async () => ({ success: false, error: 'Workflow not found' }));

vi.mock('$lib/db/superadmin-workflows.js', () => ({
	createSuperadminWorkflowRun: (...a: unknown[]) => (createRun as any)(...a),
	getSuperadminWorkflowRun: vi.fn(),
	getSuperadminWorkflowTemplate: vi.fn(),
	listSuperadminWorkflowRuns: vi.fn(),
}));
vi.mock('$lib/server/superadmin-workflow-advance.js', () => ({
	driveSuperadminWorkflowRunInline: vi.fn(),
}));
vi.mock('$lib/server/superadmin-workflow-queue.js', () => ({
	enqueueWorkflowRunStart: vi.fn(),
	runInBackground: vi.fn(),
}));

import { POST } from '../routes/api/superadmin/workflows/[id]/runs/+server.js';

const platform = { env: { ADMIN_USER_IDS: 'admin1', DB: {} } };

function event(body: string) {
	return {
		request: new Request('http://localhost/x', { method: 'POST', body }),
		cookies: { get: (n: string) => (n === 'discord_user_id' ? 'admin1' : undefined) },
		platform,
		params: { id: '3' },
		fetch,
	} as any;
}

describe('/api/superadmin/workflows/:id/runs request body', () => {
	for (const bad of ['not json', 'null', '7', '[]']) {
		it(`POST answers 400 for body ${JSON.stringify(bad)}`, async () => {
			createRun.mockClear();
			const res = await POST(event(bad));
			expect(res.status).toBe(400);
			expect(createRun).not.toHaveBeenCalled();
		});
	}

	it('POST treats an empty body as no options', async () => {
		createRun.mockClear();
		const res = await POST(event(''));
		expect(res.status).toBe(404);
		expect(createRun).toHaveBeenCalledOnce();
	});
});
