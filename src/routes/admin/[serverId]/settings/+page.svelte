<script>
	import { enhance } from '$app/forms';
	import Toast from '$lib/components/Toast.svelte';
	import ChannelSelector from '$lib/components/ChannelSelector.svelte';
	import RoleSelector from '$lib/components/RoleSelector.svelte';
	
	let { data, form } = $props();
	
	let showToast = $state(true);
	let saving = $state(false);
	
	// Local state for form fields
	let prefix = $state(data.settings?.prefix || '!');
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
			await update();
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
		
		<!-- General Settings -->
		<section class="settings-section">
			<h2>
				<span class="section-icon">🔧</span>
				General Settings
			</h2>
			
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<label for="prefix" class="setting-label">Command Prefix</label>
						<span class="setting-desc">The prefix used for text commands (e.g., !help)</span>
					</div>
					<input 
						type="text" 
						id="prefix" 
						name="prefix" 
						bind:value={prefix}
						maxlength="5"
						class="setting-input prefix-input"
					/>
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
						<label for="loggingChannel" class="setting-label">Logging Channel</label>
						<span class="setting-desc">Channel where bot activity logs will be sent</span>
					</div>
					<div class="setting-control">
						<input type="hidden" name="loggingChannelId" value={loggingChannelId} />
						<ChannelSelector 
							guildId={data.serverId}
							selectedChannelId={loggingChannelId}
							onSelect={(channel) => loggingChannelId = channel?.id || ''}
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
							<label for="welcomeChannel" class="setting-label">Welcome Channel</label>
							<span class="setting-desc">Channel where welcome messages will be sent</span>
						</div>
						<div class="setting-control">
							<input type="hidden" name="welcomeChannelId" value={welcomeChannelId} />
							<ChannelSelector 
								guildId={data.serverId}
								selectedChannelId={welcomeChannelId}
								onSelect={(channel) => welcomeChannelId = channel?.id || ''}
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
</div>

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
	
	/* Inputs */
	.setting-input {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-elevated);
		color: var(--color-text);
		font-size: 0.875rem;
		transition: border-color 0.2s;
	}
	
	.setting-input:focus {
		outline: none;
		border-color: var(--color-primary);
	}
	
	.prefix-input {
		width: 80px;
		text-align: center;
		font-family: var(--font-mono, monospace);
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
		color: white;
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
