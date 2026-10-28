import { describe, expect, it } from 'vitest';
import {
	AUTOMATION_TEMPLATES,
	TEMPLATE_CATEGORIES,
	getTemplate,
	templateToAutomation,
} from '../lib/automation/templates.js';
import { ACTION_TYPES, FILTER_TYPES } from '../lib/db/automations.js';
import { DISCORD_EVENT_TYPES } from '../lib/discord/event-metadata.js';

describe('automation templates', () => {
	it('have unique ids and a known category', () => {
		const ids = AUTOMATION_TEMPLATES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const t of AUTOMATION_TEMPLATES) expect(TEMPLATE_CATEGORIES[t.category]).toBeTruthy();
	});

	it('only use events, actions and filters the builder knows', () => {
		for (const t of AUTOMATION_TEMPLATES) {
			expect(t.trigger_events.length, t.id).toBeGreaterThan(0);
			for (const e of t.trigger_events)
				expect(DISCORD_EVENT_TYPES[e], `${t.id} ${e}`).toBeTruthy();
			for (const f of Object.keys(t.trigger_filters ?? {}))
				expect(FILTER_TYPES[f], `${t.id} ${f}`).toBeTruthy();
			expect(t.actions.length, t.id).toBeGreaterThan(0);
			for (const a of t.actions)
				expect(ACTION_TYPES[a.type], `${t.id} ${a.type}`).toBeTruthy();
		}
	});

	it('say what is left to choose when an action needs a channel or a role', () => {
		for (const t of AUTOMATION_TEMPLATES) {
			const json = JSON.stringify(t.actions);
			if (json.includes('"channel_id":""')) expect(t.setup, t.id).toContain('channel');
			if (json.includes('"role_ids":[]')) expect(t.setup, t.id).toContain('role');
			if (Object.values(t.trigger_filters ?? {}).includes(''))
				expect(t.setup, t.id).toContain('channel');
		}
	});

	it('become a switched-off automation that does not share state with the template', () => {
		const t = getTemplate('welcome-message')!;
		const a = templateToAutomation(t, '100000000000000001', '200000000000000001');
		expect(a).toMatchObject({
			guild_id: '100000000000000001',
			enabled: false,
			trigger_events: ['MEMBER_JOIN'],
			action_type: 'SEND_MESSAGE',
			created_by: '200000000000000001',
		});
		expect(a.action_config.actions).toHaveLength(1);
		(a.action_config.actions[0].config as any).content = 'changed';
		expect((t.actions[0].config as any).content).not.toBe('changed');
	});

	it('returns nothing for an unknown id', () => {
		expect(getTemplate('nope')).toBeNull();
		expect(getTemplate(undefined)).toBeNull();
	});
});
