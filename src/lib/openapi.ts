export const openApiDocument = {
	openapi: '3.1.0',
	info: {
		title: 'SpaceBot API',
		version: '1.0.0',
		description:
			'Stable external API for SpaceBot stats, settings, commands, automations, and integrations.',
	},
	servers: [{ url: '/api/v1' }],
	components: {
		securitySchemes: {
			bearerApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'SpaceBot API key' },
		},
		schemas: {
			Error: {
				type: 'object',
				properties: { error: { type: 'string' } },
				required: ['error'],
			},
		},
	},
	security: [{ bearerApiKey: [] }],
	paths: {
		'/stats': {
			get: {
				summary: 'Read server statistics',
				parameters: [
					{ name: 'days', in: 'query', schema: { type: 'integer', maximum: 90 } },
				],
				responses: {
					'200': { description: 'Statistics payload' },
					'429': { description: 'Rate limited' },
				},
			},
		},
		'/stats/members': {
			get: {
				summary: 'Member count over time, one point per bucket',
				parameters: [
					{
						name: 'period',
						in: 'query',
						description: '24h, <N>d (e.g. 7d, 30d, 90d), 1y or all. Default 30d.',
						schema: { type: 'string' },
					},
					{
						name: 'granularity',
						in: 'query',
						description: 'auto, hourly, daily or weekly. Default auto.',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': { description: 'Member history series' },
					'400': { description: 'Invalid period or granularity' },
				},
			},
		},
		'/settings': {
			get: {
				summary: 'Read guild settings',
				responses: { '200': { description: 'Settings payload' } },
			},
		},
		'/commands': {
			get: {
				summary: 'List custom commands',
				responses: { '200': { description: 'Command list' } },
			},
		},
		'/commands/permissions': {
			get: {
				summary:
					'Which commands a regular member (@everyone) can actually run, combining SpaceBot config with Discord registration and Integrations permission overrides (scope commands:read)',
				responses: {
					'200': {
						description:
							'Per-command access; discord_error set when Discord was unreachable',
					},
					'403': { description: 'Missing scope' },
				},
			},
		},
		'/automations/{id}': {
			patch: {
				summary: 'Enable or disable one automation (scope automations:write)',
				parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['enabled'],
								properties: { enabled: { type: 'boolean' } },
							},
						},
					},
				},
				responses: {
					'200': { description: 'Updated' },
					'400': { description: 'Bad body or id' },
					'403': { description: 'Missing scope, or plan limit reached' },
					'404': { description: 'Not found in the API key guild' },
				},
			},
		},
		'/commands/{id}': {
			patch: {
				summary: 'Enable or disable one custom slash command and sync to Discord (scope commands:write)',
				parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['enabled'],
								properties: { enabled: { type: 'boolean' } },
							},
						},
					},
				},
				responses: {
					'200': { description: 'Updated' },
					'400': { description: 'Bad body or id' },
					'403': { description: 'Missing scope, or plan limit reached' },
					'404': { description: 'Not found in the API key guild' },
				},
			},
		},
		'/scheduled-messages': {
			post: {
				summary: 'Schedule a channel message (scope messages:write)',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['channel_id', 'content', 'send_at'],
								properties: {
									channel_id: { type: 'string' },
									content: { type: 'string', maxLength: 2000 },
									send_at: { type: 'string', format: 'date-time' },
								},
							},
						},
					},
				},
				responses: {
					'201': { description: 'Scheduled; returns id and send_at' },
					'400': { description: 'Bad body, or send_at not in the future' },
					'403': { description: 'Missing scope, or channel not in the API key guild' },
				},
			},
		},
		'/automations': {
			get: {
				summary: 'List automations',
				responses: { '200': { description: 'Automation list' } },
			},
		},
		'/channels': {
			get: {
				summary: 'List channels grouped by category (scope channels:read)',
				parameters: [
					{
						name: 'type',
						in: 'query',
						description: 'Only channels of this type, e.g. text or voice.',
						schema: { type: 'string' },
					},
					{
						name: 'activity',
						in: 'query',
						description: 'true or a number of days: add per-channel activity numbers.',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': { description: 'Channels in sidebar order' },
					'403': { description: 'Missing scope' },
				},
			},
		},
		'/logs': {
			get: {
				summary: 'Read gateway event logs (scope logs:read)',
				parameters: [
					{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
					{ name: 'offset', in: 'query', schema: { type: 'integer' } },
					{ name: 'event_type', in: 'query', schema: { type: 'string' } },
					{ name: 'search', in: 'query', schema: { type: 'string' } },
					{
						name: 'stats',
						in: 'query',
						description: 'true returns log statistics instead of entries.',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': { description: 'Log entries or statistics' },
					'403': { description: 'Missing scope' },
				},
			},
		},
		'/members/{userId}': {
			get: {
				summary: 'Read one member’s activity (scope members:read)',
				parameters: [
					{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
					{ name: 'days', in: 'query', schema: { type: 'integer' } },
				],
				responses: {
					'200': { description: 'Member activity' },
					'400': { description: 'Invalid user id' },
					'403': { description: 'Missing scope' },
				},
			},
		},
		'/voice': {
			get: {
				summary: 'Read who is in voice now (scope voice:read)',
				parameters: [
					{ name: 'channel', in: 'query', schema: { type: 'string' } },
					{
						name: 'include_bots',
						in: 'query',
						description: 'true includes bot accounts.',
						schema: { type: 'string' },
					},
				],
				responses: {
					'200': { description: 'Voice state' },
					'403': { description: 'Missing scope' },
				},
			},
		},
		'/member-content': {
			get: {
				summary: 'Read what members keep with /about (scope content:read)',
				parameters: [
					{ name: 'user_id', in: 'query', schema: { type: 'string' } },
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', minimum: 1, maximum: 100 },
					},
					{ name: 'offset', in: 'query', schema: { type: 'integer' } },
				],
				responses: {
					'200': { description: 'One member’s content, or a page of all' },
					'403': { description: 'Missing scope' },
					'404': { description: 'user_id given and that member has set nothing' },
				},
			},
		},
		'/integrations/status': {
			get: {
				summary: 'Read integration status',
				responses: { '200': { description: 'Integration status' } },
			},
		},
	},
};
