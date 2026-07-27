/**
 * Apply Integration Command Template
 *
 * POST /api/commands/[guildId]/apply-integration-template
 * Body: { slug: string, template_key: string }
 *
 * Clones a command template declared by an enabled integration into this
 * guild's own custom commands. The clone is created **disabled** with
 * server-specific references cleared (same as command import), so the owner can
 * review, configure, and modify it like any other command. There is no live
 * link back to the template — re-applying makes a fresh copy.
 */

import { json } from '@sveltejs/kit';
import { ACTION_TYPES, createCommand, getCommandByName } from '$lib/db/commands.js';
import { clearActionConfigReferences, summarizeCleared } from '$lib/import-export.js';
import { getEnabledGuildIntegrations } from '$lib/db/integrations.js';
import {
	getIntegrationActions,
	getIntegrationCommandTemplates,
	normalizeTemplateEphemeral,
	templateEphemeralOptionRefs,
} from '$lib/integrations/registry.js';
import { syncGuildCommands } from '$lib/discord/commands.js';
import { verifyGuildAdmin } from '$lib/discord/guilds.js';
import { log } from '$lib/db/logger.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, cookies, platform }) {
	const { guildId } = params;
	const accessToken = cookies.get('discord_access_token');

	const auth = await verifyGuildAdmin(guildId, accessToken, cookies);
	if (!auth.authorized) {
		return json({ error: auth.error }, { status: 403 });
	}

	const db = (platform as any)?.env?.DB;
	if (!db) {
		return json({ error: 'Database not available' }, { status: 500 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const slug = body?.slug;
	const templateKey = body?.template_key;
	if (!slug || !templateKey) {
		return json({ error: "Body must include 'slug' and 'template_key'" }, { status: 400 });
	}

	// The integration must be enabled for this guild.
	const enabled = await getEnabledGuildIntegrations(db, guildId);
	const integration = enabled.find((i: any) => i.slug === slug);
	if (!integration) {
		return json(
			{ error: `The ${slug} integration is not enabled in this server` },
			{ status: 404 }
		);
	}

	const template = getIntegrationCommandTemplates(integration).find(
		(t: any) => t?.key === templateKey
	);
	if (!template) {
		return json({ error: `Template '${templateKey}' not found` }, { status: 404 });
	}

	if (!template.name || !template.description) {
		return json({ error: 'Template is missing name or description' }, { status: 400 });
	}

	const nameRegex = /^[\w-]{1,32}$/;
	if (!nameRegex.test(template.name)) {
		return json({ error: 'Template has an invalid command name' }, { status: 400 });
	}

	// The action_type must be a built-in action OR an action this integration
	// declares. (Templates ship configs built on the integration's own actions.)
	const actionType = template.action_type || 'NONE';
	const integrationActionKeys = new Set(
		getIntegrationActions(integration).map((a: any) => a.key)
	);
	const validAction =
		actionType === 'NONE' ||
		actionType === 'MULTIPLE' ||
		!!ACTION_TYPES[actionType] ||
		integrationActionKeys.has(actionType);
	if (!validAction) {
		return json({ error: `Template uses an unknown action: ${actionType}` }, { status: 400 });
	}

	// If the template ties visibility to options, every one of them must be
	// declared (defence-in-depth — sync validation already enforces this, but a
	// template could predate that check).
	const ephemeralRefs = templateEphemeralOptionRefs(template);
	if (ephemeralRefs.length) {
		const optionNames = new Set(
			(Array.isArray(template.options) ? template.options : [])
				.map((o: any) => o?.name)
				.filter(Boolean)
		);
		for (const ephemeralRef of ephemeralRefs) {
			if (!optionNames.has(ephemeralRef)) {
				return json(
					{
						error: `Template ties ephemeral visibility to option '${ephemeralRef}', which it does not declare`,
					},
					{ status: 400 }
				);
			}
		}
	}
	const { ephemeral: templateEphemeral, ephemeral_option: templateEphemeralOption } =
		normalizeTemplateEphemeral(template);

	// Resolve a free command name (suffix on collision so re-applying works).
	const baseName = template.name.toLowerCase();
	let name = baseName;
	for (let n = 2; n <= 20; n++) {
		const existing = await getCommandByName(db, name, guildId);
		if (!existing) break;
		name = `${baseName.slice(0, 30)}-${n}`;
	}

	// Resolve the acting user for created_by (best-effort).
	let userId: string | null = null;
	try {
		const userRes = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (userRes.ok) userId = (await userRes.json()).id;
	} catch {
		// created_by is best-effort
	}

	try {
		const { cleaned: cleanedConfig, cleared: configCleared } = clearActionConfigReferences(
			actionType,
			template.action_config || {}
		);
		const needsConfig = summarizeCleared(configCleared);

		const result = await createCommand(db, {
			guild_id: guildId,
			name,
			description: template.description,
			enabled: false, // applied disabled — owner reviews then enables
			options: template.options || [],
			ephemeral: templateEphemeral,
			ephemeral_option: templateEphemeralOption,
			defer: template.defer || false,
			action_type: actionType,
			action_config: cleanedConfig,
			response_type: template.response_type || 'message',
			response_content: template.response_content || null,
			response_embed: template.response_embed || null,
			context_menu_user: template.context_menu_user || false,
			require_voice: template.require_voice || false,
			default_member_permissions:
				template.permission || template.default_member_permissions || null,
			created_by: userId,
		});

		if (!result.success) {
			return json({ error: result.error || 'Failed to create command' }, { status: 500 });
		}

		// Register with Discord (disabled commands are skipped by the sync, but
		// this keeps parity with the import flow).
		try {
			await syncGuildCommands(db, guildId, (platform as any)?.env);
		} catch (syncError) {
			log.warn('[ApplyTemplate] Failed to sync commands after apply:', syncError);
		}

		log.info(`[ApplyTemplate] ${slug}/${templateKey} → /${name} in guild ${guildId}`);

		return json(
			{
				success: true,
				id: result.id,
				name,
				needs_configuration: needsConfig,
				message: `Added /${name} (disabled). Review and enable it when ready.`,
			},
			{ status: 201 }
		);
	} catch (error: any) {
		log.error(`[ApplyTemplate] Failed to apply ${slug}/${templateKey}:`, error);
		return json({ error: 'Failed to apply template' }, { status: 500 });
	}
}
