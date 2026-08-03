/**
 * End-to-end cover for the reported failure: DMing the bot to publish an event
 * produced a fully formatted event description and created nothing.
 *
 * These drive the real `generateChatResponse` with the model and D1 stubbed at
 * `fetch`, so the tool loop, the native-tool-call path and the guard are all
 * exercised together rather than asserted in isolation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChatResponse } from '../lib/ai/chat.js';

const ENV = {
	CLOUDFLARE_ACCOUNT_ID: 'acct',
	CLOUDFLARE_AI_TOKEN: 'ai-token',
	CLOUDFLARE_API_TOKEN: 'api-token',
};

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

/** Reply as Workers AI would: prose, native tool calls, or both. */
function aiReply({ text = '', toolCalls = null }: { text?: string; toolCalls?: any } = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			result: { response: text, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
		}),
		text: async () => '',
	};
}

/**
 * @param scripted Sequential AI responses. D1 calls are answered generically.
 */
function stubBackends(scripted: any[]) {
	const aiRequests: any[] = [];
	let index = 0;
	globalThis.fetch = (async (url: any, init: any) => {
		const href = String(url);
		if (href.includes('/ai/run/') || href.includes('gateway.ai.cloudflare.com')) {
			aiRequests.push(JSON.parse(init.body));
			const reply = scripted[Math.min(index, scripted.length - 1)];
			index++;
			return reply;
		}
		// D1 query API — enough for a tool to "succeed".
		return {
			ok: true,
			status: 200,
			json: async () => ({ success: true, result: [{ results: [], success: true }] }),
			text: async () => '',
		};
	}) as any;
	return { aiRequests, aiCallCount: () => index };
}

const ASK = 'publish that on the *Space server';

// The exact reply shape from the report.
const NARRATED = `Sure, here is the event information for "Ammoura.me Launch/Listening Party" in Space:

Event: Ammoura.me Launch/Listening Party
Location: Space
Date: September 11th
Time: 9:11 PM`;

describe('native tool calling', () => {
	it('sends the tools array so the model can actually call functions', async () => {
		const { aiRequests } = stubBackends([aiReply({ text: 'hello' })]);
		await generateChatResponse({ message: 'hey there', userName: 'David' }, ENV);

		expect(aiRequests[0].tools).toBeInstanceOf(Array);
		const names = aiRequests[0].tools.map((t: any) => t.function.name);
		expect(names).toContain('preview_scheduled_event');
		// Prose-only requests must still be well-formed function schemas.
		expect(aiRequests[0].tools[0].function.parameters.type).toBe('object');
	});

	it('executes a native tool_calls reply that carries no prose at all', async () => {
		const { aiRequests } = stubBackends([
			aiReply({ toolCalls: [{ name: 'get_scheduled_events', arguments: { guildId: '1' } }] }),
			aiReply({ text: 'Here are your events.' }),
		]);

		const result: any = await generateChatResponse(
			{ message: 'what events are scheduled?', userName: 'David' },
			ENV
		);

		expect(result.success).toBe(true);
		expect(result.toolsUsed).toContain('get_scheduled_events');
		// An empty assistant turn would confuse the follow-up; it must be described.
		const followUp = aiRequests[1].messages.find((m: any) => m.role === 'assistant');
		expect(followUp.content).toContain('get_scheduled_events');
	});
});

describe('an action must never silently no-op', () => {
	it('does not return prose describing an event it never created', async () => {
		// Model narrates, is told to act, and narrates again.
		const { aiCallCount } = stubBackends([
			aiReply({ text: NARRATED }),
			aiReply({ text: NARRATED }),
		]);

		const result: any = await generateChatResponse({ message: ASK, userName: 'David' }, ENV);

		expect(result.actionNotPerformed).toBe(true);
		// The critical property: the confident description is NOT handed back.
		expect(result.response).not.toContain('Ammoura.me Launch/Listening Party');
		expect(result.response).toMatch(/wasn't able to actually do that/i);
		expect(result.response).toMatch(/nothing has been created/i);
		// It retried before giving up.
		expect(aiCallCount()).toBeGreaterThanOrEqual(2);
	});

	it('recovers when the retry does call the tool', async () => {
		const { aiRequests } = stubBackends([
			aiReply({ text: NARRATED }), // first attempt: prose only
			aiReply({
				toolCalls: [
					{
						name: 'preview_scheduled_event',
						arguments: { guildId: '1', name: 'Launch' },
					},
				],
			}),
			aiReply({ text: 'Here is the preview — confirm and I will create it.' }),
		]);

		const result: any = await generateChatResponse({ message: ASK, userName: 'David' }, ENV);

		expect(result.actionNotPerformed).toBeUndefined();
		expect(result.toolsUsed).toContain('preview_scheduled_event');
		expect(result.response).toMatch(/preview/i);
		// The retry must be an explicit instruction to act, not a repeat.
		const nudge = aiRequests[1].messages.at(-1).content;
		expect(nudge).toMatch(/did not actually perform/i);
	});

	it('leaves read-only questions alone even when no tool runs', async () => {
		// A false positive here would tell the user something failed for no reason.
		const { aiCallCount } = stubBackends([aiReply({ text: 'You have three events.' })]);

		const result: any = await generateChatResponse(
			{ message: 'what events are scheduled?', userName: 'David' },
			ENV
		);

		expect(result.actionNotPerformed).toBeUndefined();
		expect(result.response).toBe('You have three events.');
		expect(aiCallCount()).toBe(1); // no retry
	});

	it('still fires when the model looked something up but never acted', async () => {
		// The subtle version: fetches channels, then narrates.
		const { aiCallCount } = stubBackends([
			aiReply({
				toolCalls: [{ name: 'get_voice_and_stage_channels', arguments: { guildId: '1' } }],
			}),
			aiReply({ text: NARRATED }),
			aiReply({ text: NARRATED }),
		]);

		const result: any = await generateChatResponse({ message: ASK, userName: 'David' }, ENV);

		expect(result.actionNotPerformed).toBe(true);
		expect(aiCallCount()).toBeGreaterThanOrEqual(3);
	});
});

describe('preview/confirm handshake', () => {
	it('reports a pending confirmation so a preview is not mistaken for a result', async () => {
		const { aiRequests } = stubBackends([
			aiReply({
				toolCalls: [
					{
						name: 'preview_scheduled_event',
						arguments: { guildId: '1', name: 'Launch' },
					},
				],
			}),
			aiReply({ text: 'Does this look right?' }),
		]);

		const result: any = await generateChatResponse({ message: ASK, userName: 'David' }, ENV);

		expect(result.pendingConfirmation).toBeTruthy();
		expect(result.pendingConfirmation.confirmationTool).toBe('confirm_scheduled_event');

		// And the model is told, in the results it reads, that nothing exists yet.
		const toolResultsTurn = aiRequests[1].messages.at(-1).content;
		expect(toolResultsTurn).toMatch(/PREVIEW ONLY/);
		expect(toolResultsTurn).toMatch(/NOTHING HAS BEEN CREATED/i);
		expect(toolResultsTurn).toContain('confirm_scheduled_event');
	});
});
