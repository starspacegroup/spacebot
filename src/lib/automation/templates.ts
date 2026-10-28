/**
 * Ready-made automations a server can start from. A template is data in the same
 * shape the builder saves: trigger events, optional filters, and stacked actions.
 * Using one creates a normal automation, switched off, with the channel or role
 * left for the admin to pick in the editor. Nothing here runs by itself.
 */

export type TemplateCategory = 'welcome' | 'logging' | 'moderation' | 'voice';

export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; blurb: string }> = {
	welcome: { label: 'Welcome', blurb: 'Greet people and set them up when they arrive.' },
	logging: {
		label: 'Logging',
		blurb: 'Keep a record of what happens in a channel of your choice.',
	},
	moderation: { label: 'Moderation', blurb: 'Flag the things a moderator wants to see.' },
	voice: { label: 'Voice', blurb: 'Follow who comes and goes in voice channels.' },
};

export interface AutomationTemplate {
	id: string;
	category: TemplateCategory;
	name: string;
	description: string;
	trigger_events: string[];
	trigger_filters?: Record<string, string>;
	actions: Array<{ type: string; config: Record<string, unknown> }>;
	/**
	 * What the admin must still choose in the editor before turning it on. A filter left
	 * empty (`channel_id: ''`) matches nothing, so an unfinished template stays quiet.
	 */
	setup: Array<'channel' | 'role'>;
}

const logTo = (content: string) => ({
	type: 'LOG_TO_CHANNEL',
	config: { channel_id: '', content, include_details: true },
});

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
	{
		id: 'welcome-message',
		category: 'welcome',
		name: 'Welcome message',
		description: 'Greets each new member in a channel you pick.',
		trigger_events: ['MEMBER_JOIN'],
		actions: [
			{
				type: 'SEND_MESSAGE',
				config: {
					channel_source: 'configured',
					channel_id: '',
					content:
						'Welcome {user.mention} to {guild.name}! You are member {guild.member_count}.',
				},
			},
		],
		setup: ['channel'],
	},
	{
		id: 'welcome-dm',
		category: 'welcome',
		name: 'Welcome DM',
		description: 'Sends each new member a private hello.',
		trigger_events: ['MEMBER_JOIN'],
		actions: [
			{
				type: 'SEND_DM',
				config: {
					target_user: 'actor',
					content:
						'Welcome to {guild.name}, {user.name}! Say hello when you have a moment.',
				},
			},
		],
		setup: [],
	},
	{
		id: 'auto-role',
		category: 'welcome',
		name: 'Role on join',
		description: 'Gives every new member a starting role.',
		trigger_events: ['MEMBER_JOIN'],
		actions: [{ type: 'ADD_ROLE', config: { target_user: 'actor', role_ids: [] } }],
		setup: ['role'],
	},
	{
		id: 'goodbye-message',
		category: 'welcome',
		name: 'Goodbye note',
		description: 'Posts a short note when someone leaves.',
		trigger_events: ['MEMBER_LEAVE'],
		actions: [
			{
				type: 'SEND_MESSAGE',
				config: {
					channel_source: 'configured',
					channel_id: '',
					content: '{user.name} left the server.',
				},
			},
		],
		setup: ['channel'],
	},
	{
		id: 'join-leave-log',
		category: 'logging',
		name: 'Join and leave log',
		description: 'Records every arrival and departure in one channel.',
		trigger_events: ['MEMBER_JOIN', 'MEMBER_LEAVE'],
		actions: [logTo('{user.mention} — {trigger.event}')],
		setup: ['channel'],
	},
	{
		id: 'deleted-message-log',
		category: 'logging',
		name: 'Deleted message log',
		description: 'Records when a message is deleted, and where.',
		trigger_events: ['MESSAGE_DELETE', 'MESSAGE_BULK_DELETE'],
		actions: [logTo('A message was deleted in {channel.mention}.')],
		setup: ['channel'],
	},
	{
		id: 'role-change-log',
		category: 'logging',
		name: 'Role change log',
		description: 'Records roles being created, changed, deleted, given or taken.',
		trigger_events: [
			'ROLE_CREATE',
			'ROLE_UPDATE',
			'ROLE_DELETE',
			'MEMBER_ROLE_ADD',
			'MEMBER_ROLE_REMOVE',
		],
		actions: [logTo('{trigger.event}')],
		setup: ['channel'],
	},
	{
		id: 'channel-change-log',
		category: 'logging',
		name: 'Channel change log',
		description: 'Records channels being created, changed or deleted.',
		trigger_events: ['CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE'],
		actions: [logTo('{trigger.event}: {channel.name}')],
		setup: ['channel'],
	},
	{
		id: 'mod-action-log',
		category: 'moderation',
		name: 'Ban, kick and timeout log',
		description: 'Records every ban, unban, kick and timeout in a mod channel.',
		trigger_events: ['MEMBER_BAN', 'MEMBER_UNBAN', 'MEMBER_KICK', 'MEMBER_TIMEOUT'],
		actions: [logTo('{trigger.event}: {target.mention}')],
		setup: ['channel'],
	},
	{
		id: 'new-account-alert',
		category: 'moderation',
		name: 'New account alert',
		description: 'Flags an account younger than a week when it joins, so a mod can look.',
		trigger_events: ['MEMBER_JOIN'],
		trigger_filters: { max_account_age_days: '7' },
		actions: [logTo('New account joined: {user.mention} (under 7 days old).')],
		setup: ['channel'],
	},
	{
		id: 'rules-accepted-welcome',
		category: 'welcome',
		name: 'Welcome after rules',
		description:
			'Greets a member once they accept the server rules, not when they first arrive.',
		trigger_events: ['MEMBER_UPDATE'],
		trigger_filters: { member_update_type: 'rules_accepted' },
		actions: [
			{
				type: 'SEND_MESSAGE',
				config: {
					channel_source: 'configured',
					channel_id: '',
					content: 'Welcome {user.mention}! Tell us a little about yourself.',
				},
			},
		],
		setup: ['channel'],
	},
	{
		id: 'rules-accepted-log',
		category: 'logging',
		name: 'Rules accepted log',
		description: 'Records each member who accepts the server rules.',
		trigger_events: ['MEMBER_UPDATE'],
		trigger_filters: { member_update_type: 'rules_accepted' },
		actions: [logTo('{user.mention} accepted the rules.')],
		setup: ['channel'],
	},
	{
		id: 'introduction-reactions',
		category: 'welcome',
		name: 'React to introductions',
		description:
			'Adds a reaction to every human message in the channel you pick, such as an introductions channel.',
		trigger_events: ['MESSAGE_CREATE'],
		trigger_filters: { channel_id: '', bot_filter: 'only_humans' },
		actions: [{ type: 'ADD_REACTION', config: { emoji: '👋' } }],
		setup: ['channel'],
	},
	{
		id: 'voice-activity-log',
		category: 'voice',
		name: 'Voice activity log',
		description: 'Records who joins, leaves or moves between voice channels.',
		trigger_events: ['VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_MOVE'],
		actions: [logTo('{user.mention} — {trigger.event}')],
		setup: ['channel'],
	},
	{
		id: 'mute-on-entry',
		category: 'voice',
		name: 'Mute on entry',
		description:
			'Server-mutes anyone who joins or moves into the voice channel you pick, such as a listen-only room.',
		trigger_events: ['VOICE_JOIN', 'VOICE_MOVE'],
		trigger_filters: { channel_id: '' },
		actions: [
			{
				type: 'SERVER_MUTE',
				config: { target_user: 'actor', reason: 'This room is listen-only.' },
			},
		],
		setup: ['channel'],
	},
	{
		id: 'stream-announcement',
		category: 'voice',
		name: 'Stream announcement',
		description: 'Tells a channel when someone starts sharing their screen.',
		trigger_events: ['VOICE_STREAM_START'],
		actions: [
			{
				type: 'SEND_MESSAGE',
				config: {
					channel_source: 'configured',
					channel_id: '',
					content: '{user.mention} started sharing their screen in {channel.mention}.',
				},
			},
		],
		setup: ['channel'],
	},
];

export function getTemplate(id: unknown): AutomationTemplate | null {
	return AUTOMATION_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** The record to save for a template. Always created switched off. */
export function templateToAutomation(
	t: AutomationTemplate,
	guildId: string,
	createdBy?: string | null
) {
	const actions = t.actions.map((a) => ({ type: a.type, config: structuredClone(a.config) }));
	return {
		guild_id: guildId,
		name: t.name,
		description: t.description,
		enabled: false,
		trigger_events: [...t.trigger_events],
		trigger_filters: t.trigger_filters ? { ...t.trigger_filters } : null,
		action_type: actions[0].type,
		action_config: { ...actions[0].config, actions },
		created_by: createdBy ?? null,
	};
}
