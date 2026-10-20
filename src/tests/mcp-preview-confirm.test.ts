import { describe, expect, it } from 'vitest';
import {
	PREVIEW_TTL_MS,
	advertisedTools,
	createPreviewStore,
	writesEnabled,
} from '../../mcp-server/preview-store.js';

const TOOLS = [
	'get_event_logs',
	'preview_scheduled_event',
	'create_scheduled_event',
	'create_multiple_scheduled_events',
	'confirm_scheduled_event',
	'confirm_multiple_scheduled_events',
].map((name) => ({ name }));

const payload = {
	guildId: '1',
	name: 'Launch',
	scheduledStartTime: '2026-11-01T20:00:00Z',
	entityType: 3,
	location: 'x',
};

describe('standalone MCP server write controls', () => {
	it('read-only mode advertises no mutation tools', () => {
		const names = advertisedTools(TOOLS, false).map((t) => t.name);
		expect(names).toEqual(['get_event_logs', 'preview_scheduled_event']);
	});

	it('write mode advertises confirm but never direct create', () => {
		const names = advertisedTools(TOOLS, true).map((t) => t.name);
		expect(names).toContain('confirm_scheduled_event');
		expect(names).not.toContain('create_scheduled_event');
	});

	it('writes are opt-in', () => {
		expect(writesEnabled({})).toBe(false);
		expect(writesEnabled({ SPACEBOT_MCP_WRITE: 'true' })).toBe(true);
	});

	it('confirm needs the preview id and the exact previewed payload, once', () => {
		const store = createPreviewStore();
		expect(store.consume('single', payload).ok).toBe(false);
		const previewId = store.issue('single', payload);
		expect(store.consume('single', { ...payload, name: 'Other', previewId }).ok).toBe(false);
		const id2 = store.issue('single', payload);
		expect(store.consume('single', { ...payload, guildId: '2', previewId: id2 }).ok).toBe(
			false
		);
		const id3 = store.issue('single', payload);
		expect(store.consume('multiple', { ...payload, previewId: id3 }).ok).toBe(false);
		const id4 = store.issue('single', payload);
		expect(store.consume('single', { ...payload, previewId: id4 }).ok).toBe(true);
		expect(store.consume('single', { ...payload, previewId: id4 }).ok).toBe(false);
	});

	it('expired previews are refused', () => {
		let t = 0;
		const store = createPreviewStore(() => t);
		const previewId = store.issue('single', payload);
		t = PREVIEW_TTL_MS + 1;
		expect(store.consume('single', { ...payload, previewId }).ok).toBe(false);
	});
});
