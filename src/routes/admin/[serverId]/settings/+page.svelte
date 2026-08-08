<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte.js';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import { EVENT_CATEGORIES } from '$lib/db/logger.js';
	import { TIMEZONE_OPTIONS } from '$lib/timezone.js';
	import { getTranslator } from '$lib/i18n.js';

	const tr = getTranslator();
	const { data, form } = $props();

	function getListingInviteError(result: unknown): string | undefined {
		if (!result || typeof result !== 'object' || !('listingErrors' in result)) return;
		const errors = result.listingErrors;
		if (!errors || typeof errors !== 'object' || !('invite_url' in errors)) return;
		return typeof errors.invite_url === 'string' ? errors.invite_url : undefined;
	}

	const listingInviteError = $derived(getListingInviteError(form));

	let autoSaveTimer = null;
	let settingsFormEl = $state(null);

	// Fire a toast once per new form action result
	let lastFormResult;
	$effect(() => {
		if (form && form !== lastFormResult && form.message) {
			lastFormResult = form;
			toast[form.success ? 'success' : 'error'](form.message);
		}
	});

	/** Auto-save: debounce and submit the settings form */
	function autoSave() {
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			if (settingsFormEl) {
				settingsFormEl.requestSubmit();
			}
		}, 500);
	}

	// Track the server ID to detect when we navigate to a different server
	// svelte-ignore state_referenced_locally
	let lastServerId = $state(data.serverId);

	// Local state for form fields - initialized from data, re-synced via $effect below.
	// These are mutable form values that the user edits, so they must be $state, not $derived.
	// svelte-ignore state_referenced_locally
	let loggingChannelId = $state(data.settings?.loggingChannelId || '');

	// Log embed color settings per category
	const defaultEmbedColors = {
		message: '#3498db',
		member: '#2ecc71',
		guild: '#9b59b6',
		channel: '#e67e22',
		role: '#f1c40f',
		moderation: '#e74c3c',
		voice: '#1abc9c',
		reaction: '#ff6b6b',
		interaction: '#5865f2',
		emoji: '#f1c40f',
		invite: '#3498db',
		thread: '#2ecc71',
		event: '#7289da',
		github: '#24292e',
	};
	// svelte-ignore state_referenced_locally
	let logEmbedColors = $state({
		...defaultEmbedColors,
		...(data.settings?.logEmbedColors || {}),
	});

	// Serialize embed colors for hidden form input
	const logEmbedColorsJson = $derived(JSON.stringify(logEmbedColors));

	// Excluded categories state
	// svelte-ignore state_referenced_locally
	let excludedCategories = $state(data.settings?.excludedCategories || []);
	const excludedCategoriesJson = $derived(JSON.stringify(excludedCategories));

	function toggleCategory(key) {
		if (excludedCategories.includes(key)) {
			excludedCategories = excludedCategories.filter((c) => c !== key);
		} else {
			excludedCategories = [...excludedCategories, key];
		}
		autoSave();
	}

	function resetEmbedColor(category) {
		logEmbedColors[category] = defaultEmbedColors[category] || '#95a5a6';
		autoSave();
	}

	function resetAllEmbedColors() {
		logEmbedColors = { ...defaultEmbedColors };
		autoSave();
	}

	// Timezone setting
	// svelte-ignore state_referenced_locally
	let timezone = $state(data.settings?.timezone || '');
	// svelte-ignore state_referenced_locally
	let brandingDisplayName = $state(data.branding?.display_name || '');
	// svelte-ignore state_referenced_locally
	let brandingAccentColor = $state(data.branding?.accent_color || '#5865f2');
	// svelte-ignore state_referenced_locally
	let brandingLogoUrl = $state(data.branding?.logo_url || '');
	// svelte-ignore state_referenced_locally
	let brandingBannerUrl = $state(data.branding?.banner_url || '');
	// svelte-ignore state_referenced_locally
	let brandingTagline = $state(data.branding?.public_tagline || '');

	// Public server browser listing. Publishing is opt-in — `listed` is false
	// until an admin ticks the box, and the server treats a missing checkbox as
	// unlisted, so nothing here can publish a server by accident.
	// svelte-ignore state_referenced_locally
	let listingPublished = $state(Boolean(data.listing?.listed));
	// svelte-ignore state_referenced_locally
	let listingHeadline = $state(data.listing?.headline || '');
	// svelte-ignore state_referenced_locally
	let listingDescription = $state(data.listing?.description || '');
	// svelte-ignore state_referenced_locally
	let listingCategory = $state(data.listing?.category || 'community');
	// svelte-ignore state_referenced_locally
	let listingTags = $state((data.listing?.tags || []).join(', '));
	// svelte-ignore state_referenced_locally
	let listingInviteUrl = $state(data.listing?.invite_url || '');
	// svelte-ignore state_referenced_locally
	let listingShowMemberCount = $state(data.listing?.show_member_count !== false);
	// svelte-ignore state_referenced_locally
	let listingNsfw = $state(Boolean(data.listing?.nsfw));

	/** What still has to be filled in before this server can go public. */
	const listingBlockers = $derived(
		[
			listingHeadline.trim() ? null : tr('listing.blockerHeadline'),
			listingInviteUrl.trim() ? null : tr('listing.blockerInvite'),
		].filter(Boolean)
	);

	/**
	 * Auto-save the listing, but don't fire a doomed request: while the publish
	 * box is ticked and required copy is missing the server would reject the
	 * whole settings save, so hold off and let the inline hint do the talking.
	 */
	function autoSaveListing() {
		if (listingPublished && listingBlockers.length > 0) return;
		autoSave();
	}

	// --- AI drafting -------------------------------------------------------
	// The draft is applied to the form but deliberately NOT saved. This copy is
	// public-facing, and on an already-published server an auto-save would put
	// machine-written text live before anyone read it — so the admin keeps or
	// discards it explicitly.
	let draftLoading = $state(false);
	let draftPending = $state(false);
	let draftBackup: Record<string, any> | null = null;

	async function draftWithAI() {
		if (draftLoading) return;
		draftLoading = true;
		try {
			const res = await fetch(`/api/admin/${data.serverId}/listing/suggest`, {
				method: 'POST',
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(body?.error || tr('listing.aiFailed'));
				return;
			}

			// Snapshot first so Discard is a real undo, not an approximation.
			draftBackup = {
				headline: listingHeadline,
				description: listingDescription,
				category: listingCategory,
				tags: listingTags,
			};
			listingHeadline = body.draft?.headline || listingHeadline;
			listingDescription = body.draft?.description || listingDescription;
			listingCategory = body.draft?.category || listingCategory;
			if (Array.isArray(body.draft?.tags) && body.draft.tags.length) {
				listingTags = body.draft.tags.join(', ');
			}
			draftPending = true;
			toast.success(tr('listing.aiFilled'));
		} catch {
			toast.error(tr('listing.aiFailed'));
		} finally {
			draftLoading = false;
		}
	}

	function keepDraft() {
		draftPending = false;
		draftBackup = null;
		autoSaveListing();
	}

	function discardDraft() {
		if (draftBackup) {
			listingHeadline = draftBackup.headline;
			listingDescription = draftBackup.description;
			listingCategory = draftBackup.category;
			listingTags = draftBackup.tags;
		}
		draftPending = false;
		draftBackup = null;
	}

	// --- Bot-generated invite ----------------------------------------------
	let inviteLoading = $state(false);

	async function generateInvite() {
		if (inviteLoading) return;
		inviteLoading = true;
		try {
			const res = await fetch(`/api/admin/${data.serverId}/listing/invite`, {
				method: 'POST',
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body?.invite_url) {
				toast.error(body?.error || tr('listing.inviteFailed'));
				return;
			}
			listingInviteUrl = body.invite_url;
			// Unlike the AI copy, this is a fact about the server rather than a
			// piece of writing to review, so it saves like any other field edit.
			autoSaveListing();
			toast.success(
				body.source === 'created' ? tr('listing.inviteCreated') : tr('listing.inviteFound')
			);
		} catch {
			toast.error(tr('listing.inviteFailed'));
		} finally {
			inviteLoading = false;
		}
	}

	// Browser timezone detection
	let browserTimezone = $state('');
	let browserTime = $state('');

	$effect(() => {
		try {
			browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			browserTimezone = 'Unknown';
		}

		function tick() {
			const tz = timezone || browserTimezone;
			browserTime = new Date().toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
				second: '2-digit',
				hour12: true,
				timeZone: tz,
			});
		}
		tick();
		const interval = setInterval(tick, 1000);
		return () => clearInterval(interval);
	});

	// Permission settings state
	// svelte-ignore state_referenced_locally
	let viewDashboardPerm = $state(
		data.permissionSettings?.viewDashboard?.permission || 'MANAGE_GUILD'
	);
	// svelte-ignore state_referenced_locally
	let viewLogsPerm = $state(data.permissionSettings?.viewLogs?.permission || 'MANAGE_GUILD');
	// svelte-ignore state_referenced_locally
	let manageAutomationsPerm = $state(
		data.permissionSettings?.manageAutomations?.permission || 'MANAGE_GUILD'
	);
	// svelte-ignore state_referenced_locally
	let manageCommandsPerm = $state(
		data.permissionSettings?.manageCommands?.permission || 'MANAGE_GUILD'
	);
	// svelte-ignore state_referenced_locally
	let localRunnerEnabled = $state(Boolean(data.permissionSettings?.localRunnerAssist?.enabled));
	// svelte-ignore state_referenced_locally
	let localRunnerAllowedUsers = $state(
		(data.permissionSettings?.localRunnerAssist?.allowedUserIds || []).join('\n')
	);

	// Webhook state
	let showWebhookModal = $state(false);
	let editingWebhook = $state(null);
	let webhookSaving = $state(false);
	let webhookName = $state('');
	let webhookDescription = $state('');
	let webhookUrl = $state('');
	let webhookMethod = $state('POST');
	let webhookHeaders = $state('');
	let webhookEnabled = $state(true);
	let deleteConfirmId = $state(null);

	function openWebhookModal(webhook = null) {
		if (webhook) {
			editingWebhook = webhook;
			webhookName = webhook.name;
			webhookDescription = webhook.description || '';
			webhookUrl = webhook.url;
			webhookMethod = webhook.method || 'POST';
			webhookHeaders = Object.entries(webhook.headers || {})
				.map(([k, v]) => `${k}: ${v}`)
				.join('\n');
			webhookEnabled = webhook.enabled;
		} else {
			editingWebhook = null;
			webhookName = '';
			webhookDescription = '';
			webhookUrl = '';
			webhookMethod = 'POST';
			webhookHeaders = '';
			webhookEnabled = true;
		}
		showWebhookModal = true;
	}

	function closeWebhookModal() {
		showWebhookModal = false;
		editingWebhook = null;
	}

	// Re-sync when navigating to a different server or when data is reloaded after save
	$effect(() => {
		// Only re-sync if server changed or we're not currently saving
		// This prevents the $effect from overwriting user's in-progress changes
		const serverChanged = data.serverId !== lastServerId;
		if (serverChanged) {
			lastServerId = data.serverId;
		}

		// Always sync from data - the form enhance uses invalidateAll which reloads data
		loggingChannelId = data.settings?.loggingChannelId || '';
		logEmbedColors = { ...defaultEmbedColors, ...(data.settings?.logEmbedColors || {}) };
		excludedCategories = data.settings?.excludedCategories || [];
		timezone = data.settings?.timezone || '';
		brandingDisplayName = data.branding?.display_name || '';
		brandingAccentColor = data.branding?.accent_color || '#5865f2';
		brandingLogoUrl = data.branding?.logo_url || '';
		brandingBannerUrl = data.branding?.banner_url || '';
		brandingTagline = data.branding?.public_tagline || '';
		listingPublished = Boolean(data.listing?.listed);
		listingHeadline = data.listing?.headline || '';
		listingDescription = data.listing?.description || '';
		listingCategory = data.listing?.category || 'community';
		listingTags = (data.listing?.tags || []).join(', ');
		listingInviteUrl = data.listing?.invite_url || '';
		listingShowMemberCount = data.listing?.show_member_count !== false;
		listingNsfw = Boolean(data.listing?.nsfw);
		viewDashboardPerm = data.permissionSettings?.viewDashboard?.permission || 'MANAGE_GUILD';
		viewLogsPerm = data.permissionSettings?.viewLogs?.permission || 'MANAGE_GUILD';
		manageAutomationsPerm =
			data.permissionSettings?.manageAutomations?.permission || 'MANAGE_GUILD';
		manageCommandsPerm = data.permissionSettings?.manageCommands?.permission || 'MANAGE_GUILD';
		localRunnerEnabled = Boolean(data.permissionSettings?.localRunnerAssist?.enabled);
		localRunnerAllowedUsers = (
			data.permissionSettings?.localRunnerAssist?.allowedUserIds || []
		).join('\n');
	});
</script>

<svelte:head>
	<title
		>{tr('settings.metaTitle', { name: data.guild?.name || tr('adash.serverFallback') })}</title
	>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">{tr('account.backToDashboard')}</a>
		<div class="header-content">
			<h1>
				<span class="header-icon">⚙️</span>
				{tr('adash.serverSettings')}
			</h1>
			<p class="header-desc">
				{tr('settings.headerDesc', { name: data.guild?.name || tr('bill.thisServer') })}
			</p>
		</div>
	</header>

	<form
		bind:this={settingsFormEl}
		method="POST"
		action="?/updateSettings"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false, invalidateAll: true });
			};
		}}
	>
		<!-- Dashboard Access Permissions - Most Important! -->
		<section class="settings-section permissions-section">
			<h2>
				<span class="section-icon">🔐</span>
				{tr('settings.permissionsTitle')}
				<span class="important-badge">{tr('settings.important')}</span>
			</h2>
			<p class="section-desc">{@html tr('settings.permissionsDesc')}</p>

			<div class="settings-card">
				<!-- View Dashboard -->
				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">📊 {tr('settings.viewDashboard')}</span>
						<span class="permission-desc">{tr('settings.viewDashboardDesc')}</span>
					</div>
					<div class="permission-control">
						<select
							name="viewDashboardPerm"
							bind:value={viewDashboardPerm}
							class="permission-select"
							onchange={autoSave}
						>
							{#each data.discordPermissions as perm}
								<option value={perm.value}>{perm.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- View Logs -->
				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">📜 {tr('settings.viewLogs')}</span>
						<span class="permission-desc">{tr('settings.viewLogsDesc')}</span>
					</div>
					<div class="permission-control">
						<select
							name="viewLogsPerm"
							bind:value={viewLogsPerm}
							class="permission-select"
							onchange={autoSave}
						>
							{#each data.discordPermissions as perm}
								<option value={perm.value}>{perm.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Manage Automations -->
				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">⚡ {tr('settings.manageAutomations')}</span>
						<span class="permission-desc">{tr('settings.manageAutomationsDesc')}</span>
					</div>
					<div class="permission-control">
						<select
							name="manageAutomationsPerm"
							bind:value={manageAutomationsPerm}
							class="permission-select"
							onchange={autoSave}
						>
							{#each data.discordPermissions as perm}
								<option value={perm.value}>{perm.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Manage Commands -->
				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">💬 {tr('settings.manageCommands')}</span>
						<span class="permission-desc">{tr('settings.manageCommandsDesc')}</span>
					</div>
					<div class="permission-control">
						<select
							name="manageCommandsPerm"
							bind:value={manageCommandsPerm}
							class="permission-select"
							onchange={autoSave}
						>
							{#each data.discordPermissions as perm}
								<option value={perm.value}>{perm.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Server Settings - Always Admin -->
				<div class="permission-row locked">
					<div class="permission-info">
						<span class="permission-label">⚙️ {tr('adash.serverSettings')}</span>
						<span class="permission-desc">{tr('settings.serverSettingsPermDesc')}</span>
					</div>
					<div class="permission-control">
						<span class="permission-locked">
							<span class="lock-icon">🔒</span>
							{tr('settings.adminOnlyLocked')}
						</span>
					</div>
				</div>

				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">🤖 {tr('settings.localRunner')}</span>
						<span class="permission-desc">{tr('settings.localRunnerDesc')}</span>
					</div>
					<div class="permission-control">
						<label class="runner-option-toggle">
							<input
								type="checkbox"
								name="localRunnerEnabled"
								bind:checked={localRunnerEnabled}
								onchange={autoSave}
							/>
							<span
								>{localRunnerEnabled
									? tr('common.enabled')
									: tr('common.disabled')}</span
							>
						</label>
					</div>
				</div>

				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">👥 {tr('settings.allowedUserIds')}</span>
						<span class="permission-desc">{tr('settings.allowedUserIdsDesc')}</span>
					</div>
					<div class="permission-control">
						<textarea
							name="localRunnerAllowedUsers"
							class="form-textarea"
							rows="4"
							bind:value={localRunnerAllowedUsers}
							onchange={autoSave}
							placeholder="123456789012345678\n234567890123456789"></textarea>
					</div>
				</div>
			</div>
		</section>

		<!-- Logging Settings -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">📊</span>
				{tr('settings.logging')}
			</h2>

			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<span class="setting-label">{tr('adash.loggingChannel')}</span>
						<span class="setting-desc">{tr('settings.loggingChannelDesc')}</span>
					</div>
					<div class="setting-control">
						<ChannelSelector
							guildId={data.serverId}
							bind:value={loggingChannelId}
							name="loggingChannelId"
							placeholder={tr('settings.selectChannel')}
							onchange={autoSave}
						/>
					</div>
				</div>
			</div>

			{#if loggingChannelId}
				<div class="settings-card log-categories-card">
					<div class="setting-info">
						<span class="setting-label">{tr('settings.eventCategories')}</span>
						<span class="setting-desc">{tr('settings.eventCategoriesDesc')}</span>
					</div>
					<div class="category-toggles-grid">
						{#each Object.entries(EVENT_CATEGORIES) as [key, category]}
							<button
								type="button"
								class="category-toggle"
								class:excluded={excludedCategories.includes(key)}
								onclick={() => toggleCategory(key)}
								title={category.description}
							>
								<span class="category-toggle-icon">{category.icon}</span>
								<span class="category-toggle-name">{category.name}</span>
								<span class="category-toggle-status"
									>{excludedCategories.includes(key)
										? tr('runners.off')
										: tr('runners.on')}</span
								>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if loggingChannelId}
				<div class="settings-card embed-colors-card">
					<div class="embed-colors-header">
						<div class="setting-info">
							<span class="setting-label">{tr('settings.embedColors')}</span>
							<span class="setting-desc">{tr('settings.embedColorsDesc')}</span>
						</div>
						<button
							type="button"
							class="btn btn-sm btn-secondary"
							onclick={resetAllEmbedColors}
						>
							{tr('settings.resetAll')}
						</button>
					</div>
					<div class="embed-colors-grid">
						{#each Object.entries(EVENT_CATEGORIES) as [key, category]}
							<div class="embed-color-item">
								<div
									class="embed-color-preview"
									style="background-color: {logEmbedColors[key] ||
										defaultEmbedColors[key] ||
										'#95a5a6'}"
								></div>
								<div class="embed-color-info">
									<span class="embed-color-icon">{category.icon}</span>
									<span class="embed-color-name">{category.name}</span>
								</div>
								<div class="embed-color-controls">
									<input
										type="color"
										value={logEmbedColors[key] ||
											defaultEmbedColors[key] ||
											'#95a5a6'}
										oninput={(e) => {
											logEmbedColors[key] = (
												e.target as HTMLInputElement
											).value;
										}}
										onchange={autoSave}
										class="color-picker"
									/>
									{#if logEmbedColors[key] !== defaultEmbedColors[key]}
										<button
											type="button"
											class="btn-icon btn-reset-color"
											onclick={() => resetEmbedColor(key)}
											title={tr('settings.resetToDefault')}
										>
											↩
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<input type="hidden" name="logEmbedColors" value={logEmbedColorsJson} />
			<input type="hidden" name="excludedCategories" value={excludedCategoriesJson} />
		</section>

		<section class="settings-section">
			<h2>
				<span class="section-icon">🎨</span>
				{tr('settings.customBranding')}
			</h2>
			<p class="section-desc">{tr('settings.brandingDesc')}</p>

			<div class="settings-grid">
				<div class="settings-card">
					<label for="brandingDisplayName" class="setting-label"
						>{tr('settings.displayName')}</label
					>
					<input
						id="brandingDisplayName"
						name="brandingDisplayName"
						class="form-input"
						bind:value={brandingDisplayName}
						maxlength="80"
						onchange={autoSave}
					/>
				</div>
				<div class="settings-card">
					<label for="brandingAccentColor" class="setting-label"
						>{tr('settings.accentColor')}</label
					>
					<input
						id="brandingAccentColor"
						name="brandingAccentColor"
						class="form-input"
						type="color"
						bind:value={brandingAccentColor}
						onchange={autoSave}
					/>
				</div>
				<div class="settings-card">
					<label for="brandingLogoUrl" class="setting-label"
						>{tr('settings.logoUrl')}</label
					>
					<input
						id="brandingLogoUrl"
						name="brandingLogoUrl"
						class="form-input"
						bind:value={brandingLogoUrl}
						placeholder="/logo.webp"
						onchange={autoSave}
					/>
				</div>
				<div class="settings-card">
					<label for="brandingBannerUrl" class="setting-label"
						>{tr('settings.bannerUrl')}</label
					>
					<input
						id="brandingBannerUrl"
						name="brandingBannerUrl"
						class="form-input"
						bind:value={brandingBannerUrl}
						placeholder="/server-admin-dark.webp"
						onchange={autoSave}
					/>
				</div>
			</div>
			<div class="settings-card">
				<label for="brandingTagline" class="setting-label"
					>{tr('settings.publicTagline')}</label
				>
				<input
					id="brandingTagline"
					name="brandingTagline"
					class="form-input"
					bind:value={brandingTagline}
					maxlength="180"
					onchange={autoSave}
				/>
			</div>
		</section>

		<!-- Public server browser listing -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">🪐</span>
				{tr('listing.sectionTitle')}
			</h2>
			<p class="section-desc">{tr('listing.sectionDesc')}</p>

			{#if data.listing?.review_status === 'rejected'}
				<div class="listing-notice listing-notice-warn">
					<strong>{tr('listing.removedTitle')}</strong>
					<span>{data.listing.review_note || tr('listing.removedDesc')} </span>
				</div>
			{/if}

			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<label for="listingPublished" class="setting-label"
							>{tr('listing.publishLabel')}</label
						>
						<span class="setting-desc">{tr('listing.publishDesc')}</span>
					</div>
					<div class="setting-control">
						<label class="listing-switch">
							<input
								id="listingPublished"
								name="listingPublished"
								type="checkbox"
								bind:checked={listingPublished}
								onchange={autoSaveListing}
							/>
							<span class="listing-switch-track"></span>
							<span class="listing-switch-text"
								>{listingPublished
									? tr('listing.statePublished')
									: tr('listing.stateUnlisted')}</span
							>
						</label>
					</div>
				</div>

				{#if listingPublished && listingBlockers.length > 0}
					<div class="listing-notice listing-notice-info">
						<strong>{tr('listing.blockersTitle')}</strong>
						<ul>
							{#each listingBlockers as blocker}
								<li>{blocker}</li>
							{/each}
						</ul>
					</div>
				{:else if listingPublished && data.listingVisible}
					<p class="listing-live">
						{tr('listing.liveHint')}
						<a href="/servers/{data.serverId}">{tr('listing.viewPublicPage')}</a>
					</p>
				{:else if listingPublished && data.listing?.review_status !== 'rejected'}
					<!-- Opted in, not taken down, but still not showing: the guild's
					     metadata has gone stale, which means SpaceBot is no longer in
					     the server. Say so rather than claiming it's live. -->
					<div class="listing-notice listing-notice-warn">
						<strong>{tr('listing.notVisibleTitle')}</strong>
						<span
							>{tr('listing.notVisibleDesc', {
								days: data.listingFreshnessDays ?? 7,
							})}</span
						>
					</div>
				{/if}
			</div>

			<div class="settings-card listing-assist-card">
				<div class="setting-info">
					<span class="setting-label">{tr('listing.aiTitle')}</span>
					<span class="setting-desc">{tr('listing.aiDesc')}</span>
				</div>
				<button
					type="button"
					class="btn btn-secondary btn-sm listing-assist-btn"
					onclick={draftWithAI}
					disabled={draftLoading}
				>
					{draftLoading ? tr('listing.aiWorking') : `✨ ${tr('listing.aiButton')}`}
				</button>
			</div>

			{#if draftPending}
				<div class="listing-notice listing-notice-info listing-draft-bar">
					<div>
						<strong>{tr('listing.aiPendingTitle')}</strong>
						<span>{tr('listing.aiPendingDesc')}</span>
					</div>
					<div class="listing-draft-actions">
						<button type="button" class="btn btn-primary btn-sm" onclick={keepDraft}
							>{tr('listing.aiKeep')}</button
						>
						<button
							type="button"
							class="btn btn-secondary btn-sm"
							onclick={discardDraft}>{tr('listing.aiDiscard')}</button
						>
					</div>
				</div>
			{/if}

			<div class="settings-card">
				<label for="listingHeadline" class="setting-label">{tr('listing.headline')}</label>
				<span class="setting-desc">{tr('listing.headlineDesc')}</span>
				<input
					id="listingHeadline"
					name="listingHeadline"
					class="form-input"
					bind:value={listingHeadline}
					maxlength="120"
					placeholder={tr('listing.headlinePlaceholder')}
					onchange={autoSaveListing}
				/>
			</div>

			<div class="settings-card">
				<label for="listingDescription" class="setting-label"
					>{tr('listing.description')}</label
				>
				<span class="setting-desc">{tr('listing.descriptionDesc')}</span>
				<textarea
					id="listingDescription"
					name="listingDescription"
					class="form-input listing-textarea"
					bind:value={listingDescription}
					maxlength="1000"
					rows="4"
					placeholder={tr('listing.descriptionPlaceholder')}
					onchange={autoSaveListing}></textarea>
				<span class="listing-counter">{listingDescription.length}/1000</span>
			</div>

			<div class="settings-grid">
				<div class="settings-card">
					<label for="listingCategory" class="setting-label"
						>{tr('listing.category')}</label
					>
					<select
						id="listingCategory"
						name="listingCategory"
						class="permission-select"
						bind:value={listingCategory}
						onchange={autoSaveListing}
					>
						{#each data.listingCategories || [] as cat}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>
				</div>
				<div class="settings-card">
					<label for="listingTags" class="setting-label">{tr('listing.tags')}</label>
					<input
						id="listingTags"
						name="listingTags"
						class="form-input"
						bind:value={listingTags}
						placeholder={tr('listing.tagsPlaceholder')}
						onchange={autoSaveListing}
					/>
					<span class="setting-desc">{tr('listing.tagsDesc')}</span>
				</div>
			</div>

			<div class="settings-card">
				<label for="listingInviteUrl" class="setting-label">{tr('listing.invite')}</label>
				<span class="setting-desc">{tr('listing.inviteDesc')}</span>
				<div class="listing-invite-row">
					<input
						id="listingInviteUrl"
						name="listingInviteUrl"
						class="form-input"
						class:input-error={Boolean(listingInviteError)}
						bind:value={listingInviteUrl}
						placeholder="https://discord.gg/your-invite"
						onchange={autoSaveListing}
					/>
					<button
						type="button"
						class="btn btn-secondary btn-sm listing-assist-btn"
						onclick={generateInvite}
						disabled={inviteLoading}
					>
						{inviteLoading ? tr('listing.inviteWorking') : tr('listing.inviteButton')}
					</button>
				</div>
				{#if listingInviteError}
					<span class="listing-error">{listingInviteError}</span>
				{/if}
			</div>

			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<label for="listingShowMemberCount" class="setting-label"
							>{tr('listing.showMembers')}</label
						>
						<span class="setting-desc">{tr('listing.showMembersDesc')}</span>
					</div>
					<div class="setting-control">
						<input
							id="listingShowMemberCount"
							name="listingShowMemberCount"
							type="checkbox"
							bind:checked={listingShowMemberCount}
							onchange={autoSaveListing}
						/>
					</div>
				</div>
				<div class="setting-row">
					<div class="setting-info">
						<label for="listingNsfw" class="setting-label">{tr('listing.nsfw')}</label>
						<span class="setting-desc">{tr('listing.nsfwDesc')}</span>
					</div>
					<div class="setting-control">
						<input
							id="listingNsfw"
							name="listingNsfw"
							type="checkbox"
							bind:checked={listingNsfw}
							onchange={autoSaveListing}
						/>
					</div>
				</div>
			</div>
		</section>

		<!-- Timezone Settings -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">🌐</span>
				{tr('settings.timezone')}
			</h2>

			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<label for="timezone" class="setting-label"
							>{tr('settings.displayTimezone')}</label
						>
						<span class="setting-desc">{tr('settings.timezoneDesc')}</span>
						{#if browserTimezone}
							<span class="setting-hint">
								🕐 {tr('settings.yourBrowser')}
								<strong>{browserTimezone}</strong>{#if browserTime}
									— {browserTime}{/if}
							</span>
						{/if}
					</div>
					<div class="setting-control">
						<select
							id="timezone"
							name="timezone"
							bind:value={timezone}
							class="permission-select"
							onchange={autoSave}
						>
							<option value="">🌐 {tr('settings.browserDefault')}</option>
							{#each TIMEZONE_OPTIONS as tz}
								<option value={tz.value}>{tz.label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>
		</section>
	</form>

	<!-- Webhooks Section (outside main form since it has its own forms) -->
	<section class="settings-section webhooks-section">
		<h2>
			<span class="section-icon">🔗</span>
			{tr('settings.webhookEndpoints')}
		</h2>
		<p class="section-desc">{tr('settings.webhooksDesc')}</p>

		<div class="settings-card">
			{#if data.webhooks?.length > 0}
				<div class="webhooks-list">
					{#each data.webhooks as webhook}
						<div class="webhook-item" class:disabled={!webhook.enabled}>
							<div class="webhook-info">
								<div class="webhook-header">
									<span class="webhook-name">{webhook.name}</span>
									<span
										class="webhook-method method-{webhook.method.toLowerCase()}"
										>{webhook.method}</span
									>
									{#if !webhook.enabled}
										<span class="webhook-badge disabled"
											>{tr('common.disabled')}</span
										>
									{/if}
								</div>
								{#if webhook.description}
									<span class="webhook-description">{webhook.description}</span>
								{/if}
								<span class="webhook-url">{webhook.url}</span>
							</div>
							<div class="webhook-actions">
								<button
									type="button"
									class="btn btn-small btn-secondary"
									onclick={() => openWebhookModal(webhook)}
								>
									{tr('common.edit')}
								</button>
								{#if deleteConfirmId === webhook.id}
									<form
										method="POST"
										action="?/deleteWebhook"
										use:enhance={() => {
											return async ({ update }) => {
												await update({ invalidateAll: true });
												deleteConfirmId = null;
											};
										}}
									>
										<input type="hidden" name="webhookId" value={webhook.id} />
										<button type="submit" class="btn btn-small btn-danger">
											{tr('settings.confirm')}
										</button>
										<button
											type="button"
											class="btn btn-small btn-secondary"
											onclick={() => (deleteConfirmId = null)}
										>
											{tr('common.cancel')}
										</button>
									</form>
								{:else}
									<button
										type="button"
										class="btn btn-small btn-danger-outline"
										onclick={() => (deleteConfirmId = webhook.id)}
									>
										{tr('common.delete')}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					<span class="empty-icon">🔗</span>
					<p>{tr('settings.noWebhooks')}</p>
					<span class="empty-hint">{tr('settings.noWebhooksHint')}</span>
				</div>
			{/if}

			<div class="webhooks-footer">
				<button type="button" class="btn btn-secondary" onclick={() => openWebhookModal()}>
					<span class="btn-icon">➕</span>
					{tr('settings.addWebhook')}
				</button>
			</div>
		</div>
	</section>
</div>

<!-- Webhook Modal -->
{#if showWebhookModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="modal-overlay"
		onclick={closeWebhookModal}
		role="dialog"
		aria-modal="true"
		aria-labelledby="webhook-modal-title"
		tabindex="-1"
	>
		<div class="modal" role="presentation" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3 id="webhook-modal-title">
					{editingWebhook ? tr('settings.editWebhook') : tr('settings.addWebhook')}
				</h3>
				<button type="button" class="modal-close" onclick={closeWebhookModal}>×</button>
			</div>

			<form
				method="POST"
				action={editingWebhook ? '?/updateWebhook' : '?/createWebhook'}
				use:enhance={() => {
					webhookSaving = true;
					return async ({ update, result }) => {
						await update({ invalidateAll: true });
						webhookSaving = false;
						if (result.type === 'success' || result.type === 'redirect') {
							closeWebhookModal();
						}
					};
				}}
			>
				{#if editingWebhook}
					<input type="hidden" name="webhookId" value={editingWebhook.id} />
				{/if}

				<div class="modal-body">
					<div class="form-group">
						<label for="webhookName" class="form-label">{tr('apik.name')} *</label>
						<input
							type="text"
							id="webhookName"
							name="webhookName"
							bind:value={webhookName}
							class="form-input"
							placeholder={tr('settings.webhookNamePlaceholder')}
							required
						/>
						<span class="form-hint">{tr('settings.webhookNameHint')}</span>
					</div>

					<div class="form-group">
						<label for="webhookDescription" class="form-label"
							>{tr('apik.description')}</label
						>
						<input
							type="text"
							id="webhookDescription"
							name="webhookDescription"
							bind:value={webhookDescription}
							class="form-input"
							placeholder={tr('settings.webhookDescPlaceholder')}
						/>
					</div>

					<div class="form-group">
						<label for="webhookUrl" class="form-label">{tr('settings.url')} *</label>
						<input
							type="url"
							id="webhookUrl"
							name="webhookUrl"
							bind:value={webhookUrl}
							class="form-input"
							placeholder="https://example.com/webhook"
							required
						/>
						<span class="form-hint">{tr('settings.webhookUrlHint')}</span>
					</div>

					<div class="form-group">
						<label for="webhookMethod" class="form-label"
							>{tr('settings.httpMethod')}</label
						>
						<select
							id="webhookMethod"
							name="webhookMethod"
							bind:value={webhookMethod}
							class="form-select"
						>
							{#each data.httpMethods as method}
								<option value={method}>{method}</option>
							{/each}
						</select>
					</div>

					<div class="form-group">
						<label for="webhookHeaders" class="form-label"
							>{tr('settings.customHeaders')}</label
						>
						<textarea
							id="webhookHeaders"
							name="webhookHeaders"
							bind:value={webhookHeaders}
							class="form-textarea"
							rows="3"
							placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
						></textarea>
						<span class="form-hint">{tr('settings.headersHint')}</span>
					</div>

					{#if editingWebhook}
						<div class="form-group form-group-inline">
							<span class="form-label">{tr('settings.status')}</span>
							<label class="toggle">
								<input
									type="checkbox"
									name="webhookEnabled"
									bind:checked={webhookEnabled}
								/>
								<span class="toggle-slider"></span>
							</label>
							<span class="toggle-label"
								>{webhookEnabled
									? tr('common.enabled')
									: tr('common.disabled')}</span
							>
						</div>
					{/if}
				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-secondary" onclick={closeWebhookModal}>
						{tr('common.cancel')}
					</button>
					<button type="submit" class="btn btn-primary" disabled={webhookSaving}>
						{#if webhookSaving}
							<span class="spinner"></span>
							{tr('runners.saving')}
						{:else}
							{editingWebhook
								? tr('settings.updateWebhook')
								: tr('settings.createWebhook')}
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<section class="api-keys-section">
	<h2>
		<span class="section-icon">🔑</span>
		{tr('apik.title')}
	</h2>
	<p class="section-desc">{tr('settings.apiKeysDesc')}</p>
	<a href="/admin/{data.serverId}/api-keys" class="btn btn-secondary">
		<span class="btn-icon">🔑</span>
		{tr('settings.manageApiKeys')}
	</a>
</section>

<style>
	.settings-page {
		max-width: 800px;
		margin: 0 auto;
		padding: 1rem;
	}

	@media (min-width: 640px) {
		.settings-page {
			padding: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.settings-page {
			padding: 2rem;
		}
	}

	/* Header */
	.page-header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 1rem;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: var(--color-text);
	}

	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	@media (min-width: 640px) {
		.header-content h1 {
			font-size: 2rem;
		}
	}

	.header-icon {
		font-size: 1.25rem;
	}

	.header-desc {
		color: var(--color-text-muted);
		margin: 0.5rem 0 0;
	}

	/* Sections */
	.settings-section {
		margin-bottom: 2rem;
	}

	.settings-section h2 {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.section-icon {
		font-size: 1rem;
	}

	.section-desc {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: -0.5rem 0 1rem;
		line-height: 1.5;
	}

	/* The <strong> lives inside an {@html} translation, so the selector must be
	   :global to reach it. */
	.section-desc :global(strong) {
		color: var(--color-text);
	}

	/* Important Badge */
	.important-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.5rem;
		background: rgba(88, 101, 242, 0.15);
		color: var(--color-primary);
		border-radius: var(--radius-sm);
		margin-left: auto;
	}

	/* Permissions Section */
	.permissions-section .settings-card {
		border-color: var(--color-primary);
		border-width: 2px;
	}

	.permission-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
		transition: background 0.2s;
	}

	.permission-row:last-child {
		border-bottom: none;
	}

	.permission-row:hover:not(.locked) {
		background: var(--color-surface-hover);
	}

	.permission-row.locked {
		opacity: 0.7;
		background: var(--color-surface-elevated);
	}

	.permission-info {
		flex: 1;
		min-width: 0;
	}

	.permission-label {
		display: block;
		font-weight: 600;
		color: var(--color-text);
		font-size: 0.95rem;
		margin-bottom: 0.25rem;
	}

	.permission-desc {
		display: block;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.permission-control {
		flex-shrink: 0;
	}

	.permission-select {
		padding: 0.5rem 2rem 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
		min-width: 160px;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.65rem center;
	}

	.permission-select:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.permission-select:hover {
		border-color: var(--color-primary);
	}

	.permission-locked {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.lock-icon {
		font-size: 0.9rem;
	}

	.settings-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: 1rem;
	}

	@media (min-width: 640px) {
		.settings-card {
			padding: 1.25rem;
		}
	}

	/* Setting Rows */
	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.setting-row:last-child {
		border-bottom: none;
	}

	.setting-row.column {
		flex-direction: column;
		align-items: stretch;
	}

	.setting-info {
		flex: 1;
		min-width: 0;
	}

	.setting-label {
		display: block;
		font-weight: 500;
		color: var(--color-text);
		font-size: 0.9rem;
		margin-bottom: 0.125rem;
	}

	.setting-desc {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.setting-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-top: 0.375rem;
	}

	.setting-control {
		flex-shrink: 0;
		min-width: 200px;
	}

	.setting-textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.875rem;
		font-family: inherit;
		resize: vertical;
		margin-top: 0.5rem;
		transition: border-color 0.2s;
	}

	.setting-textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	/* Toggle Switch */
	.toggle {
		position: relative;
		display: inline-block;
		width: 48px;
		height: 26px;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		transition: 0.2s;
		border-radius: 26px;
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 20px;
		width: 20px;
		left: 2px;
		bottom: 2px;
		background-color: var(--color-text-muted);
		transition: 0.2s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background-color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.toggle input:checked + .toggle-slider:before {
		background-color: white;
		transform: translateX(22px);
	}

	.toggle input:focus + .toggle-slider {
		box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.3);
	}

	/* Webhooks Section */
	.webhooks-section {
		margin-top: 2rem;
	}

	.webhooks-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.webhook-item {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color 0.2s;
	}

	.webhook-item:hover {
		border-color: var(--color-primary);
	}

	.webhook-item.disabled {
		opacity: 0.6;
	}

	.webhook-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.webhook-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.webhook-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.webhook-method {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}

	.method-get {
		background: #28a745;
		color: white;
	}
	.method-post {
		background: #007bff;
		color: white;
	}
	.method-put {
		background: #fd7e14;
		color: white;
	}
	.method-patch {
		background: #6f42c1;
		color: white;
	}
	.method-delete {
		background: #dc3545;
		color: white;
	}

	.webhook-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-muted);
	}

	.webhook-badge.disabled {
		background: rgba(220, 53, 69, 0.15);
		color: var(--color-danger, #dc3545);
	}

	.webhook-description {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.webhook-url {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.webhook-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.webhook-actions form {
		display: flex;
		gap: 0.5rem;
	}

	.webhooks-footer {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}

	.empty-icon {
		font-size: 2.5rem;
		display: block;
		margin-bottom: 0.5rem;
		opacity: 0.5;
	}

	.empty-state p {
		margin: 0;
		font-weight: 500;
		color: var(--color-text);
	}

	.empty-hint {
		font-size: 0.85rem;
		display: block;
		margin-top: 0.25rem;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--color-overlay-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		width: 100%;
		max-width: 500px;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.modal-close {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		line-height: 1;
		transition: color 0.2s;
	}

	.modal-close:hover {
		color: var(--color-text);
	}

	.modal-body {
		padding: 1.25rem;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	/* Form Elements */
	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-label {
		display: block;
		font-weight: 500;
		font-size: 0.875rem;
		color: var(--color-text);
		margin-bottom: 0.375rem;
	}

	.form-input,
	.form-select,
	.form-textarea {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.875rem;
		font-family: inherit;
		transition: border-color 0.2s;
	}

	.form-input:focus,
	.form-select:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	.form-hint {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.form-group .toggle {
		vertical-align: middle;
	}

	.toggle-label {
		margin-left: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	/* Spinner */
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-fixed-border-spinner);
		border-top-color: var(--color-fixed-text-bright);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* API Keys Section */
	.api-keys-section {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
		border-top: 1px solid var(--color-border);
		padding-top: 2rem;
		margin-top: 1rem;
	}

	@media (min-width: 640px) {
		.api-keys-section {
			padding: 0 1.5rem 2rem;
			padding-top: 2rem;
		}
	}

	@media (min-width: 1024px) {
		.api-keys-section {
			padding: 0 2rem 2rem;
			padding-top: 2rem;
		}
	}

	.api-keys-section h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.api-keys-section .section-desc {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		margin: 0 0 1rem;
	}

	/* Embed Colors */
	.embed-colors-card {
		margin-top: 0.75rem;
	}

	/* Log Categories */
	.log-categories-card {
		margin-top: 0.75rem;
	}

	.log-categories-card .setting-info {
		margin-bottom: 0.75rem;
	}

	.category-toggles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}

	.category-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
		color: var(--color-text);
		font-family: inherit;
		font-size: 0.8rem;
	}

	.category-toggle:hover {
		border-color: var(--color-primary);
	}

	.category-toggle.excluded {
		opacity: 0.5;
		background: var(--color-surface);
	}

	.category-toggle-icon {
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.category-toggle-name {
		flex: 1;
		text-align: left;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.category-toggle-status {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.category-toggle:not(.excluded) .category-toggle-status {
		background: rgba(46, 204, 113, 0.15);
		color: #2ecc71;
	}

	.category-toggle.excluded .category-toggle-status {
		background: rgba(231, 76, 60, 0.15);
		color: #e74c3c;
	}

	.embed-colors-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.embed-colors-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.5rem;
	}

	.embed-color-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color 0.2s;
	}

	.embed-color-item:hover {
		border-color: var(--color-primary);
	}

	.embed-color-preview {
		width: 4px;
		height: 32px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.embed-color-info {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}

	.embed-color-icon {
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.embed-color-name {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.embed-color-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.color-picker {
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 1px;
		cursor: pointer;
		background: transparent;
	}

	.color-picker::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.color-picker::-webkit-color-swatch {
		border: none;
		border-radius: 3px;
	}

	.btn-reset-color {
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0.2rem 0.35rem;
		font-size: 0.75rem;
		line-height: 1;
		transition:
			color 0.2s,
			border-color 0.2s;
	}

	.btn-reset-color:hover {
		color: var(--color-text);
		border-color: var(--color-primary);
	}

	.btn-sm {
		font-size: 0.75rem;
		padding: 0.35rem 0.625rem;
	}

	/* Public server browser listing */
	.listing-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		cursor: pointer;
		user-select: none;
	}

	.listing-switch input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}

	.listing-switch-track {
		position: relative;
		width: 2.75rem;
		height: 1.5rem;
		border-radius: var(--radius-full);
		background: var(--color-border);
		transition: background var(--transition-fast);
		flex-shrink: 0;
	}

	.listing-switch-track::after {
		content: '';
		position: absolute;
		top: 0.1875rem;
		left: 0.1875rem;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
		transition: transform var(--transition-fast);
	}

	.listing-switch input:checked + .listing-switch-track {
		background: var(--color-primary);
	}

	.listing-switch input:checked + .listing-switch-track::after {
		transform: translateX(1.25rem);
	}

	.listing-switch input:focus-visible + .listing-switch-track {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.listing-switch-text {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.listing-notice {
		margin-top: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		line-height: 1.5;
		border: 1px solid var(--color-border);
	}

	.listing-notice strong {
		display: block;
		margin-bottom: 0.25rem;
		color: var(--color-text);
	}

	.listing-notice ul {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--color-text-secondary);
	}

	.listing-notice-info {
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
	}

	.listing-notice-warn {
		background: color-mix(in srgb, var(--color-danger) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
	}

	.listing-live {
		margin: 0.875rem 0 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.listing-live a {
		color: var(--color-primary);
		text-decoration: none;
	}

	.listing-live a:hover {
		text-decoration: underline;
	}

	.listing-textarea {
		resize: vertical;
		min-height: 5.5rem;
		font-family: inherit;
		line-height: 1.5;
	}

	.listing-counter {
		display: block;
		margin-top: 0.375rem;
		text-align: right;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.listing-error {
		display: block;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-danger);
	}

	.input-error {
		border-color: var(--color-danger);
	}

	.listing-assist-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.listing-assist-btn {
		flex-shrink: 0;
		white-space: nowrap;
	}

	.listing-assist-btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.listing-draft-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.listing-draft-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.listing-invite-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.listing-invite-row .form-input {
		flex: 1;
		min-width: 0;
	}

	@media (max-width: 560px) {
		.listing-invite-row {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
