import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeToolMock = vi.fn();

vi.mock('../lib/ai/mcp-client.js', () => ({
	getMCPClient: () => ({
		isConfigured: () => true,
		executeTool: executeToolMock,
	}),
	formatToolsForPrompt: () => '',
	MCP_TOOLS: [],
}));

import { detectLocalRunnerIntent, generateChatResponse } from '../lib/ai/chat.js';

describe('local runner grounding in chat responses', () => {
	beforeEach(() => {
		executeToolMock.mockReset();
	});

	it('treats "list my local runners" as visibility, not action', () => {
		const intent = detectLocalRunnerIntent('list my local runners');

		expect(intent.mentionsRunner).toBe(true);
		expect(intent.asksVisibility).toBe(true);
		expect(intent.asksAction).toBe(false);
		expect(intent.isVisibilityQuery).toBe(true);
	});

	it('still detects explicit action requests correctly', () => {
		const intent = detectLocalRunnerIntent('start a local runner task that runs uname -a');

		expect(intent.mentionsRunner).toBe(true);
		expect(intent.asksAction).toBe(true);
		expect(intent.isVisibilityQuery).toBe(false);
	});

	it('returns deterministic tool-grounded runner visibility details', async () => {
		executeToolMock.mockResolvedValueOnce({
			success: true,
			data: [
				{
					id: 1,
					display_name: 'Runner 1',
					hostname: 'host-a',
					is_online: true,
					pending_job_count: 0,
					running_job_count: 1,
				},
				{
					id: 2,
					display_name: 'Runner 2',
					hostname: 'host-b',
					is_online: false,
					pending_job_count: 1,
					running_job_count: 0,
				},
			],
		});

		const result = await generateChatResponse(
			{
				message: 'list my local runners',
				userName: 'David',
				userId: 'user-1',
			},
			{
				CLOUDFLARE_ACCOUNT_ID: 'acct',
				CLOUDFLARE_AI_TOKEN: 'ai-token',
				CLOUDFLARE_API_TOKEN: 'api-token',
			}
		);

		expect(result.success).toBe(true);
		expect(result.toolsUsed).toEqual(['list_local_runners']);
		expect(result.response).toContain(
			'I can see 2 registered local runner system(s) (1 online, 1 offline).'
		);
		expect(result.response).toContain('Runner 1');
		expect(result.response).toContain('Runner 2');
		expect(executeToolMock).toHaveBeenCalledWith(
			'list_local_runners',
			expect.objectContaining({ includeOffline: true, limit: 100, userId: 'user-1' })
		);
	});

	it('reports "no runners" honestly on the visibility path', async () => {
		executeToolMock.mockResolvedValueOnce({ success: true, data: [] });

		const result = await generateChatResponse(
			{ message: 'do you see my runners?', userName: 'David', userId: 'user-1' },
			{
				CLOUDFLARE_ACCOUNT_ID: 'acct',
				CLOUDFLARE_AI_TOKEN: 'ai-token',
				CLOUDFLARE_API_TOKEN: 'api-token',
			}
		);

		expect(result.success).toBe(true);
		expect(result.response).toContain("don't see any registered local runner");
	});

	it('reports lookup failures instead of guessing runner state', async () => {
		executeToolMock.mockResolvedValueOnce({ success: false, error: 'db unavailable' });

		const result = await generateChatResponse(
			{
				message: 'can you see my local runner?',
				userName: 'David',
				userId: 'user-1',
			},
			{
				CLOUDFLARE_ACCOUNT_ID: 'acct',
				CLOUDFLARE_AI_TOKEN: 'ai-token',
				CLOUDFLARE_API_TOKEN: 'api-token',
			}
		);

		expect(result.success).toBe(true);
		expect(result.toolsUsed).toEqual(['list_local_runners']);
		expect(result.response).toContain('lookup failed: db unavailable');
	});
});
