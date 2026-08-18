import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeToolMock = vi.fn();

vi.mock('../lib/ai/mcp-client.js', () => ({
	getMCPClient: () => ({
		isConfigured: () => true,
		executeTool: executeToolMock,
		// Resolved once per turn to build the time context; these tests don't
		// care about zones, so answer "not set" and let it fall back to UTC.
		getUserTimezone: async () => null,
		getGuildTimezone: async () => null,
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

	it('grounds the local (Ollama) DM path with the runner inventory', async () => {
		// Runner lookup returns one online runner.
		executeToolMock.mockResolvedValueOnce({
			success: true,
			data: [{ id: 7, display_name: 'Dirac', hostname: 'dirac', is_online: true }],
		});

		// Capture the system prompt sent to Ollama and return a canned reply.
		let capturedSystem = '';
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			const body = JSON.parse((init as RequestInit).body as string);
			capturedSystem =
				body.messages.find((m: { role: string }) => m.role === 'system')?.content ?? '';
			return new Response(
				JSON.stringify({ message: { content: 'Yes — Dirac is online.' } }),
				{
					status: 200,
				}
			);
		});

		const result = await generateChatResponse(
			{ message: 'do I have any local runners?', userName: 'David', userId: 'user-1' },
			{
				AI_PROVIDER: 'ollama',
				OLLAMA_MODEL: 'gemma3:4b',
				CLOUDFLARE_ACCOUNT_ID: 'a',
				CLOUDFLARE_AI_TOKEN: 'b',
			}
		);

		expect(result.success).toBe(true);
		// The runner inventory was fetched and injected into the local-model prompt.
		expect(executeToolMock).toHaveBeenCalledWith(
			'list_local_runners',
			expect.objectContaining({ userId: 'user-1' })
		);
		expect(capturedSystem).toContain("USER'S LOCAL RUNNERS");
		expect(capturedSystem).toContain('Dirac');
		fetchSpy.mockRestore();
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
