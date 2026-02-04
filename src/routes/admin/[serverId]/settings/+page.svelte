<script>
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	
	let { data, form } = $props();
	
	let showToast = $state(true);
	let saving = $state(false);
	
	// Track the server ID to detect when we navigate to a different server
	let lastServerId = $state(data.serverId);
	
	// Local state for form fields - initialized from data
	let loggingChannelId = $state(data.settings?.loggingChannelId || '');
	let welcomeEnabled = $state(data.settings?.welcomeEnabled || false);
	let welcomeChannelId = $state(data.settings?.welcomeChannelId || '');
	let welcomeMessage = $state(data.settings?.welcomeMessage || 'Welcome {user} to {server}!');
	
	// Permission settings state
	let viewDashboardPerm = $state(data.permissionSettings?.viewDashboard?.permission || 'MANAGE_GUILD');
	let viewLogsPerm = $state(data.permissionSettings?.viewLogs?.permission || 'MANAGE_GUILD');
	let manageAutomationsPerm = $state(data.permissionSettings?.manageAutomations?.permission || 'MANAGE_GUILD');
	let manageCommandsPerm = $state(data.permissionSettings?.manageCommands?.permission || 'MANAGE_GUILD');
	
	// Role overrides for permissions
	let viewDashboardRoles = $state(data.permissionSettings?.viewDashboard?.roles || []);
	let viewLogsRoles = $state(data.permissionSettings?.viewLogs?.roles || []);
	let manageAutomationsRoles = $state(data.permissionSettings?.manageAutomations?.roles || []);
	let manageCommandsRoles = $state(data.permissionSettings?.manageCommands?.roles || []);
	
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
		welcomeEnabled = data.settings?.welcomeEnabled || false;
		welcomeChannelId = data.settings?.welcomeChannelId || '';
		welcomeMessage = data.settings?.welcomeMessage || 'Welcome {user} to {server}!';
		viewDashboardPerm = data.permissionSettings?.viewDashboard?.permission || 'MANAGE_GUILD';
		viewLogsPerm = data.permissionSettings?.viewLogs?.permission || 'MANAGE_GUILD';
		manageAutomationsPerm = data.permissionSettings?.manageAutomations?.permission || 'MANAGE_GUILD';
		manageCommandsPerm = data.permissionSettings?.manageCommands?.permission || 'MANAGE_GUILD';
		viewDashboardRoles = data.permissionSettings?.viewDashboard?.roles || [];
		viewLogsRoles = data.permissionSettings?.viewLogs?.roles || [];
		manageAutomationsRoles = data.permissionSettings?.manageAutomations?.roles || [];
		manageCommandsRoles = data.permissionSettings?.manageCommands?.roles || [];
	});
</script>

<svelte:head>
	<title>Server Settings - {data.guild?.name || 'Server'} | SpaceBot</title>
</svelte:head>

<div class="settings-page">
	{#if form?.message && showToast}
		<Toast 
			message={form.message} 
			success={form.success} 
			onDismiss={() => showToast = false} 
		/>
	{/if}
	
	<header class="page-header">
		<a href="/admin/{data.serverId}" class="back-link">← Back to Dashboard</a>
		<div class="header-content">
			<h1>
				<span class="header-icon">⚙️</span>
				Server Settings
			</h1>
			<p class="header-desc">Configure bot settings for {data.guild?.name || 'this server'}</p>
		</div>
	</header>
	
	<form method="POST" action="?/updateSettings" use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			// Use reset: false to keep form values, then invalidate to refetch data
			await update({ reset: false, invalidateAll: true });
			saving = false;
			showToast = true;
		};
	}}>
		<!-- Dashboard Access Permissions - Most Important! -->
		<section class="settings-section permissions-section">
			<h2>
				<span class="section-icon">🔐</span>
				Dashboard Access Permissions
				<span class="important-badge">Important</span>
			</h2>
			<p class="section-desc">
				Control who can access different features in this web dashboard based on their Discord permissions.
				Users with <strong>Administrator</strong> permission always have full access.
			</p>
			
			<div class="settings-card">
				<!-- View Dashboard -->
				<div class="permission-row">
					<div class="permission-info">
						<span class="permission-label">📊 View Dashboard</span>
						<span class="permission-desc">Access the server dashboard and view basic information</span>
					</div>
					<div class="permission-control">
						<select 
							name="viewDashboardPerm" 
							bind:value={viewDashboardPerm}
							class="permission-select"
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
						<span class="permission-label">📜 View Event Logs</span>
						<span class="permission-desc">View server activity logs and audit history</span>
					</div>
					<div class="permission-control">
						<select 
							name="viewLogsPerm" 
							bind:value={viewLogsPerm}
							class="permission-select"
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
						<span class="permission-label">⚡ Manage Automations</span>
						<span class="permission-desc">Create, edit, and delete automated actions</span>
					</div>
					<div class="permission-control">
						<select 
							name="manageAutomationsPerm" 
							bind:value={manageAutomationsPerm}
							class="permission-select"
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
						<span class="permission-label">💬 Manage Commands</span>
						<span class="permission-desc">Create and configure custom slash commands</span>
					</div>
					<div class="permission-control">
						<select 
							name="manageCommandsPerm" 
							bind:value={manageCommandsPerm}
							class="permission-select"
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
						<span class="permission-label">⚙️ Server Settings</span>
						<span class="permission-desc">Access this settings page (cannot be changed)</span>
					</div>
					<div class="permission-control">
						<span class="permission-locked">
							<span class="lock-icon">🔒</span>
							Administrator Only
						</span>
					</div>
				</div>
			</div>
		</section>
		
		<!-- Logging Settings -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">📊</span>
				Logging
			</h2>
			
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<span class="setting-label">Logging Channel</span>
						<span class="setting-desc">Channel where bot activity logs will be sent</span>
					</div>
					<div class="setting-control">
						<ChannelSelector 
							guildId={data.serverId}
							bind:value={loggingChannelId}
							name="loggingChannelId"
							placeholder="Select a channel..."
						/>
					</div>
				</div>
			</div>
		</section>
		
		<!-- Welcome Messages -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">👋</span>
				Welcome Messages
			</h2>
			
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<label for="welcomeEnabled" class="setting-label">Enable Welcome Messages</label>
						<span class="setting-desc">Automatically greet new members when they join</span>
					</div>
					<label class="toggle">
						<input 
							type="checkbox" 
							id="welcomeEnabled" 
							name="welcomeEnabled"
							bind:checked={welcomeEnabled}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>
				
				{#if welcomeEnabled}
					<div class="setting-row">
						<div class="setting-info">
							<span class="setting-label">Welcome Channel</span>
							<span class="setting-desc">Channel where welcome messages will be sent</span>
						</div>
						<div class="setting-control">
							<ChannelSelector 
								guildId={data.serverId}
								bind:value={welcomeChannelId}
								name="welcomeChannelId"
								placeholder="Select a channel..."
							/>
						</div>
					</div>
					
					<div class="setting-row column">
						<div class="setting-info">
							<label for="welcomeMessage" class="setting-label">Welcome Message</label>
							<span class="setting-desc">
								Use {'{user}'} for the member's mention and {'{server}'} for the server name
							</span>
						</div>
						<textarea 
							id="welcomeMessage" 
							name="welcomeMessage"
							bind:value={welcomeMessage}
							rows="3"
							class="setting-textarea"
							placeholder="Welcome {user} to {server}!"
						></textarea>
					</div>
				{/if}
			</div>
		</section>
		
		<!-- Save Button -->
		<div class="form-actions">
			<button type="submit" class="btn btn-primary" disabled={saving}>
				{#if saving}
					<span class="spinner"></span>
					Saving...
				{:else}
					<span class="btn-icon">💾</span>
					Save Settings
				{/if}
			</button>
		</div>
	</form>
	
	<!-- Webhooks Section (outside main form since it has its own forms) -->
	<section class="settings-section webhooks-section">
		<h2>
			<span class="section-icon">🔗</span>
			Webhook Endpoints
		</h2>
		<p class="section-desc">
			Configure webhook URLs that can be called from automations and command actions.
			These webhooks can send data to external services when triggered.
		</p>
		
		<div class="settings-card">
			{#if data.webhooks?.length > 0}
				<div class="webhooks-list">
					{#each data.webhooks as webhook}
						<div class="webhook-item" class:disabled={!webhook.enabled}>
							<div class="webhook-info">
								<div class="webhook-header">
									<span class="webhook-name">{webhook.name}</span>
									<span class="webhook-method method-{webhook.method.toLowerCase()}">{webhook.method}</span>
									{#if !webhook.enabled}
										<span class="webhook-badge disabled">Disabled</span>
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
									Edit
								</button>
								{#if deleteConfirmId === webhook.id}
									<form method="POST" action="?/deleteWebhook" use:enhance={() => {
										return async ({ update }) => {
											await update({ invalidateAll: true });
											deleteConfirmId = null;
											showToast = true;
										};
									}}>
										<input type="hidden" name="webhookId" value={webhook.id} />
										<button type="submit" class="btn btn-small btn-danger">
											Confirm
										</button>
										<button 
											type="button" 
											class="btn btn-small btn-secondary"
											onclick={() => deleteConfirmId = null}
										>
											Cancel
										</button>
									</form>
								{:else}
									<button 
										type="button" 
										class="btn btn-small btn-danger-outline"
										onclick={() => deleteConfirmId = webhook.id}
									>
										Delete
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					<span class="empty-icon">🔗</span>
					<p>No webhooks configured yet</p>
					<span class="empty-hint">Add webhook endpoints to use in automations and commands</span>
				</div>
			{/if}
			
			<div class="webhooks-footer">
				<button 
					type="button" 
					class="btn btn-secondary"
					onclick={() => openWebhookModal()}
				>
					<span class="btn-icon">➕</span>
					Add Webhook
				</button>
			</div>
		</div>
	</section>
</div>

<!-- Webhook Modal -->
{#if showWebhookModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={closeWebhookModal} role="dialog" aria-modal="true" aria-labelledby="webhook-modal-title">
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3 id="webhook-modal-title">{editingWebhook ? 'Edit Webhook' : 'Add Webhook'}</h3>
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
						showToast = true;
						if (result.type === 'success' || (result.type === 'redirect')) {
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
						<label for="webhookName" class="form-label">Name *</label>
						<input 
							type="text" 
							id="webhookName" 
							name="webhookName"
							bind:value={webhookName}
							class="form-input"
							placeholder="e.g., Slack Notification"
							required
						/>
						<span class="form-hint">A unique name to identify this webhook</span>
					</div>
					
					<div class="form-group">
						<label for="webhookDescription" class="form-label">Description</label>
						<input 
							type="text" 
							id="webhookDescription" 
							name="webhookDescription"
							bind:value={webhookDescription}
							class="form-input"
							placeholder="e.g., Send notifications to #alerts channel"
						/>
					</div>
					
					<div class="form-group">
						<label for="webhookUrl" class="form-label">URL *</label>
						<input 
							type="url" 
							id="webhookUrl" 
							name="webhookUrl"
							bind:value={webhookUrl}
							class="form-input"
							placeholder="https://example.com/webhook"
							required
						/>
						<span class="form-hint">The endpoint URL to call</span>
					</div>
					
					<div class="form-group">
						<label for="webhookMethod" class="form-label">HTTP Method</label>
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
						<label for="webhookHeaders" class="form-label">Custom Headers</label>
						<textarea 
							id="webhookHeaders" 
							name="webhookHeaders"
							bind:value={webhookHeaders}
							class="form-textarea"
							rows="3"
							placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
						></textarea>
						<span class="form-hint">One header per line in format: Header-Name: value</span>
					</div>
					
					{#if editingWebhook}
						<div class="form-group form-group-inline">
							<span class="form-label">Status</span>
							<label class="toggle">
								<input 
									type="checkbox" 
									name="webhookEnabled"
									bind:checked={webhookEnabled}
								/>
								<span class="toggle-slider"></span>
							</label>
							<span class="toggle-label">{webhookEnabled ? 'Enabled' : 'Disabled'}</span>
						</div>
					{/if}
				</div>
				
				<div class="modal-footer">
					<button type="button" class="btn btn-secondary" onclick={closeWebhookModal}>
						Cancel
					</button>
					<button type="submit" class="btn btn-primary" disabled={webhookSaving}>
						{#if webhookSaving}
							<span class="spinner"></span>
							Saving...
						{:else}
							{editingWebhook ? 'Update Webhook' : 'Create Webhook'}
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

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
	
	.section-desc strong {
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
		background-position: right 0.75rem center;
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
		content: "";
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
	
	/* Form Actions */
	.form-actions {
		display: flex;
		justify-content: flex-end;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
		margin-top: 1rem;
	}
	
	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-md);
		border: none;
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
		text-decoration: none;
	}
	
	.btn-primary {
		background: var(--color-primary);
		color: #1C1917;
		font-weight: 600;
	}
	
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	
	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	
	.btn-icon {
		font-size: 1.1em;
	}
	
	.btn-secondary {
		background: var(--color-surface-elevated);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}
	
	.btn-secondary:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-primary);
	}
	
	.btn-small {
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
	}
	
	.btn-danger {
		background: var(--color-danger, #dc3545);
		color: white;
	}
	
	.btn-danger:hover:not(:disabled) {
		background: #c82333;
	}
	
	.btn-danger-outline {
		background: transparent;
		color: var(--color-danger, #dc3545);
		border: 1px solid var(--color-danger, #dc3545);
	}
	
	.btn-danger-outline:hover:not(:disabled) {
		background: rgba(220, 53, 69, 0.1);
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
	
	.method-get { background: #28a745; color: white; }
	.method-post { background: #007bff; color: white; }
	.method-put { background: #fd7e14; color: white; }
	.method-patch { background: #6f42c1; color: white; }
	.method-delete { background: #dc3545; color: white; }
	
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
		background: rgba(0, 0, 0, 0.6);
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
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
