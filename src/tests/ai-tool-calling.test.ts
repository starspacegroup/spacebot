import { describe, expect, it } from 'vitest';
import {
	actionWasAttempted,
	buildFunctionTools,
	detectActionIntent,
	isActionTool,
	normalizeNativeToolCalls,
	toolParamsToJsonSchema,
} from '../lib/ai/tool-calling.js';
import { MCP_TOOLS } from '../lib/ai/mcp-client.js';

describe('toolParamsToJsonSchema', () => {
	it('reads type, requiredness and description out of the prose spec', () => {
		const schema = toolParamsToJsonSchema({
			guildId: 'string (required) - The Discord server ID',
			limit: 'number (optional) - Max logs to return (default: 20, max: 100)',
			generateImage: 'boolean (optional) - Whether to generate an image',
		});
		expect(schema.properties.guildId).toEqual({
			type: 'string',
			description: 'The Discord server ID',
		});
		expect(schema.properties.limit.type).toBe('number');
		expect(schema.properties.generateImage.type).toBe('boolean');
		expect(schema.required).toEqual(['guildId']);
	});

	it('gives arrays an items type so the schema is valid', () => {
		const schema = toolParamsToJsonSchema({ tags: 'array (optional) - Tags' });
		expect(schema.properties.tags).toMatchObject({ type: 'array', items: { type: 'string' } });
	});

	it('degrades an unparseable spec to an optional string rather than dropping it', () => {
		// A dropped param is a tool the model cannot call correctly.
		const schema = toolParamsToJsonSchema({ weird: 'something nobody planned for' });
		expect(schema.properties.weird.type).toBe('string');
		expect(schema.properties.weird.description).toBe('something nobody planned for');
		expect(schema.required).toBeUndefined();
	});

	it('handles a tool with no parameters at all', () => {
		expect(toolParamsToJsonSchema(undefined)).toEqual({ type: 'object', properties: {} });
		expect(toolParamsToJsonSchema(null)).toEqual({ type: 'object', properties: {} });
	});
});

describe('buildFunctionTools', () => {
	it('produces the shape the API expects', () => {
		const [tool] = buildFunctionTools([
			{
				name: 'get_thing',
				description: 'Gets a thing',
				parameters: { id: 'string (required) - id' },
			},
		]);
		expect(tool.type).toBe('function');
		expect(tool.function.name).toBe('get_thing');
		expect(tool.function.description).toBe('Gets a thing');
		expect(tool.function.parameters.required).toEqual(['id']);
	});

	it('skips malformed entries instead of emitting an invalid tool', () => {
		expect(buildFunctionTools([{ description: 'no name' } as any, null as any])).toEqual([]);
	});

	it('converts the real MCP_TOOLS catalogue without throwing', () => {
		const tools = buildFunctionTools(MCP_TOOLS as any);
		expect(tools.length).toBeGreaterThan(20);
		for (const tool of tools) {
			expect(typeof tool.function.name).toBe('string');
			expect(tool.function.parameters.type).toBe('object');
		}
		// The tool whose absence started this: event creation must be callable.
		const names = tools.map((t) => t.function.name);
		expect(names).toContain('preview_scheduled_event');
		expect(names).toContain('confirm_scheduled_event');
		expect(names).toContain('create_scheduled_event');
	});
});

describe('normalizeNativeToolCalls', () => {
	it('reads the Workers AI shape (object arguments)', () => {
		expect(
			normalizeNativeToolCalls([
				{ name: 'create_scheduled_event', arguments: { guildId: '1' } },
			])
		).toEqual([{ tool: 'create_scheduled_event', args: { guildId: '1' } }]);
	});

	it('reads the OpenAI shape (JSON-string arguments)', () => {
		expect(
			normalizeNativeToolCalls([
				{ function: { name: 'get_event_logs', arguments: '{"guildId":"1","limit":5}' } },
			])
		).toEqual([{ tool: 'get_event_logs', args: { guildId: '1', limit: 5 } }]);
	});

	it('survives malformed arguments rather than throwing mid-turn', () => {
		expect(normalizeNativeToolCalls([{ name: 'x', arguments: 'not json' }])).toEqual([
			{ tool: 'x', args: {} },
		]);
		expect(normalizeNativeToolCalls([{ name: 'x', arguments: ['a'] }])).toEqual([
			{ tool: 'x', args: {} },
		]);
	});

	it('ignores entries with no usable name, and non-arrays', () => {
		expect(normalizeNativeToolCalls([{ arguments: {} }])).toEqual([]);
		expect(normalizeNativeToolCalls(null)).toEqual([]);
		expect(normalizeNativeToolCalls(undefined)).toEqual([]);
		expect(normalizeNativeToolCalls('nope' as any)).toEqual([]);
	});
});

describe('action intent', () => {
	it('recognises the request that silently did nothing', () => {
		// Verbatim from the 2026-08-03 report: the bot replied with a fully
		// formatted event description and created no event.
		expect(detectActionIntent('publish that on the *Space server')).toBe(true);
	});

	it('recognises action requests phrased as a polite question', () => {
		expect(detectActionIntent('can you create an event for friday?')).toBe(true);
		expect(detectActionIntent('could you schedule a listening party')).toBe(true);
		expect(detectActionIntent('please send that to #announcements')).toBe(true);
	});

	it('does not fire on read-only questions that merely mention actions', () => {
		// A false positive here tells the user something failed when nothing
		// needed to happen, so these matter.
		expect(detectActionIntent('what events did you create?')).toBe(false);
		expect(detectActionIntent('show me the scheduled events')).toBe(false);
		expect(detectActionIntent('list the automations you made')).toBe(false);
		expect(detectActionIntent('how many messages were posted today')).toBe(false);
		expect(detectActionIntent('who created that automation')).toBe(false);
	});

	it('does not fire on chit-chat or empty input', () => {
		expect(detectActionIntent('hey, how are you')).toBe(false);
		expect(detectActionIntent('thanks!')).toBe(false);
		expect(detectActionIntent('')).toBe(false);
		expect(detectActionIntent(null as any)).toBe(false);
	});
});

describe('action tool classification', () => {
	it('separates tools that change something from tools that answer questions', () => {
		expect(isActionTool('create_scheduled_event')).toBe(true);
		expect(isActionTool('preview_scheduled_event')).toBe(true);
		expect(isActionTool('confirm_scheduled_event')).toBe(true);
		expect(isActionTool('send_channel_message')).toBe(true);
		expect(isActionTool('get_scheduled_events')).toBe(false);
		expect(isActionTool('list_guilds')).toBe(false);
		expect(isActionTool('')).toBe(false);
	});

	it('counts a preview as having acted — previewing is the requested first step', () => {
		expect(actionWasAttempted(['preview_scheduled_event'])).toBe(true);
	});

	it('does not count a lookup as having acted', () => {
		// The subtle failure: model fetches channels, then narrates instead of
		// creating. That must still be treated as "nothing happened".
		expect(actionWasAttempted(['get_voice_and_stage_channels'])).toBe(false);
		expect(actionWasAttempted([])).toBe(false);
		expect(actionWasAttempted(undefined as any)).toBe(false);
	});
});
