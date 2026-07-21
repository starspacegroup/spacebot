<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDateShort } from '$lib/timezone.js';

	const { data } = $props();
	const integrations = $derived(data?.integrations ?? []);

	let integrationError = $state(null);
	let integrationSuccess = $state(null);

	// --- Register by URL ---
	let registerUrl = $state('');
	let registerOfficial = $state(false);
	let registering = $state(false);
	let registerResult = $state(null);

	async function registerIntegration() {
		if (!registerUrl.trim() || registering) return;
		registering = true;
		integrationError = null;
		integrationSuccess = null;
		registerResult = null;
		try {
			const response = await fetch('/api/integrations/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: registerUrl.trim(), isOfficial: registerOfficial }),
			});
			const result = await response.json();
			if (response.ok && result.success) {
				registerResult = result;
				integrationSuccess = `${result.created ? 'Registered' : 'Refreshed'} ${result.integration.name}`;
				registerUrl = '';
				registerOfficial = false;
				await invalidateAll();
			} else {
				integrationError = result.error || 'Failed to register integration';
			}
		} catch (error) {
			integrationError = error.message;
		} finally {
			registering = false;
		}
	}

	// --- Token management ---
	const generatingToken = $state({});
	const generatedTokens = $state({});
	const officialGuildInputs = $state({});

	async function setOfficialGuild(integration) {
		integrationError = null;
		integrationSuccess = null;
		const raw = officialGuildInputs[integration.id] ?? integration.official_guild_id ?? '';
		const guildId = String(raw).trim();
		try {
			const response = await fetch('/api/integrations/official-guild', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ integrationId: integration.id, guildId: guildId || null }),
			});
			const result = await response.json();
			if (response.ok && result.success) {
				integrationSuccess = `Official guild ${guildId ? 'set' : 'cleared'} for ${integration.name}`;
			} else {
				integrationError = result.error || 'Failed to set official guild';
			}
		} catch (error) {
			integrationError = error.message;
		}
	}

	async function generateToken(integration) {
		generatingToken[integration.id] = true;
		integrationError = null;
		integrationSuccess = null;
		try {
			const response = await fetch('/api/integrations/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ integrationId: integration.id, slug: integration.slug }),
			});
			const result = await response.json();
			if (response.ok) {
				generatedTokens[integration.id] = result.token;
				integrationSuccess = `Token generated for ${integration.name}. Copy it now — it won't be shown again.`;
			} else {
				integrationError = result.error || 'Failed to generate token';
			}
		} catch (error) {
			integrationError = error.message;
		} finally {
			generatingToken[integration.id] = false;
		}
	}

	async function revokeToken(integration) {
		if (
			!confirm(
				`Revoke the token for ${integration.name}? The integration will no longer be able to authenticate.`
			)
		)
			return;
		integrationError = null;
		integrationSuccess = null;
		try {
			const response = await fetch('/api/integrations/token', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ integrationId: integration.id }),
			});
			const result = await response.json();
			if (response.ok) {
				integrationSuccess = `Token revoked for ${integration.name}`;
				delete generatedTokens[integration.id];
				await invalidateAll();
			} else {
				integrationError = result.error || 'Failed to revoke token';
			}
		} catch (error) {
			integrationError = error.message;
		}
	}

	function copyToken(token) {
		navigator.clipboard.writeText(token);
		integrationSuccess = 'Token copied to clipboard!';
	}
</script>

<svelte:head>
	<title>External Integrations · Superadmin</title>
</svelte:head>

<div class="integrations-admin">
	<header class="page-header">
		<a href="/admin/superadmin" class="back-link">← Superadmin</a>
		<h1><span class="section-icon">🔌</span> External Integrations</h1>
		<p class="page-desc">
			Register external services that extend SpaceBot with commands, actions, and events, and
			manage their tokens.
		</p>
	</header>

	{#if integrationSuccess}
		<div class="cmd-toast cmd-toast-success">
			<span>✓</span>
			{integrationSuccess}
			<button class="cmd-toast-close" onclick={() => (integrationSuccess = null)}>✕</button>
		</div>
	{/if}
	{#if integrationError}
		<div class="cmd-toast cmd-toast-error">
			<span>✗</span>
			{integrationError}
			<button class="cmd-toast-close" onclick={() => (integrationError = null)}>✕</button>
		</div>
	{/if}

	<!-- Register by URL -->
	<section class="register-section">
		<h2 class="section-title">Register an integration</h2>
		<p class="register-help">
			Point SpaceBot at a public service. It fetches
			<code>&lt;url&gt;/spacebot-integration.json</code>, validates the surfaces it offers,
			and — for a new integration — issues a token to hand to the service.
		</p>
		<div class="register-form">
			<input
				type="url"
				class="register-input"
				placeholder="https://agapeverse.app"
				bind:value={registerUrl}
				onkeydown={(e) => e.key === 'Enter' && registerIntegration()}
			/>
			<label class="official-check">
				<input type="checkbox" bind:checked={registerOfficial} />
				Official
			</label>
			<button
				class="btn btn-primary"
				onclick={registerIntegration}
				disabled={registering || !registerUrl.trim()}
			>
				{registering ? 'Discovering…' : 'Discover & Register'}
			</button>
		</div>

		{#if registerResult}
			<div class="register-result">
				<h3>
					{registerResult.created ? '✅ Registered' : '🔄 Refreshed'}
					{registerResult.integration.name}
					<span class="slug">({registerResult.integration.slug})</span>
				</h3>
				<div class="surface-badges">
					<span class="surface">{registerResult.surfaces.commands} commands</span>
					<span class="surface">{registerResult.surfaces.actions} actions</span>
					<span class="surface">{registerResult.surfaces.events} events</span>
					<span class="surface"
						>{registerResult.surfaces.command_templates} templates</span
					>
					{#if registerResult.health?.checked}
						<span class="surface {registerResult.health.ok ? 'ok' : 'bad'}">
							health {registerResult.health.ok ? 'ok' : 'down'}
						</span>
					{/if}
				</div>
				{#if registerResult.token}
					<div class="token-display">
						<code class="token-value">{registerResult.token}</code>
						<button
							class="btn btn-sm btn-secondary"
							onclick={() => copyToken(registerResult.token)}
						>
							📋 Copy
						</button>
					</div>
					<p class="token-warning">
						⚠️ Copy this token now and give it to the integration. It won't be shown
						again.
					</p>
				{:else}
					<p class="token-hint">
						Existing integration refreshed — its token was left unchanged.
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Registered integrations -->
	<section class="manage-section">
		<h2 class="section-title">
			Registered <span class="section-subtitle"
				>({integrations.length} token-authenticated)</span
			>
		</h2>

		{#if integrations.length === 0}
			<p class="empty-text">No external integrations registered yet.</p>
		{:else}
			<div class="integrations-manage-grid">
				{#each integrations as integration (integration.id)}
					<div class="integration-manage-card">
						<div class="integration-manage-header">
							<span class="integration-manage-icon">{integration.icon || '📦'}</span>
							<div class="integration-manage-info">
								<h3>{integration.name}</h3>
								<span class="integration-manage-slug">{integration.slug}</span>
							</div>
							<div class="integration-manage-status">
								{#if integration.status === 'online'}
									<span class="conn-badge conn-online">🟢 Online</span>
								{:else if integration.status === 'offline'}
									<span class="conn-badge conn-offline">🔴 Offline</span>
								{:else}
									<span class="conn-badge conn-unknown">⚪ Unknown</span>
								{/if}
							</div>
						</div>

						<div class="integration-manage-details">
							<div class="detail-row">
								<span class="detail-label">Version</span>
								<span class="detail-value">{integration.version || '—'}</span>
							</div>
							<div class="detail-row">
								<span class="detail-label">Category</span>
								<span class="detail-value">{integration.category}</span>
							</div>
							<div class="detail-row">
								<span class="detail-label">Commands</span>
								<span class="detail-value"
									>{integration.manifest?.commands?.length || 0}</span
								>
							</div>
							<div class="detail-row">
								<span class="detail-label">Last Heartbeat</span>
								<span class="detail-value"
									>{integration.last_heartbeat_at
										? formatDateShort(integration.last_heartbeat_at)
										: 'Never'}</span
								>
							</div>
							{#if integration.manifest?.webhooks?.command_handler}
								<div class="detail-row">
									<span class="detail-label">Command Handler</span>
									<span class="detail-value detail-url"
										>{integration.manifest.webhooks.command_handler}</span
									>
								</div>
							{/if}
							{#if integration.manifest?.actions?.length}
								<div class="detail-row">
									<span class="detail-label">Actions</span>
									<span class="detail-value"
										>{integration.manifest.actions.length}</span
									>
								</div>
							{/if}
							{#if integration.manifest?.events?.length}
								<div class="detail-row">
									<span class="detail-label">Events</span>
									<span class="detail-value"
										>{integration.manifest.events.length}</span
									>
								</div>
							{/if}
						</div>

						<!-- Official guild: platform events from this integration route here only -->
						{#if integration.manifest?.events?.length}
							<div class="integration-official-guild">
								<h4>Official Guild</h4>
								<p class="token-hint">
									This integration's platform events (e.g. account/content
									created) fire automations in this server only.
								</p>
								<div class="official-guild-row">
									<input
										type="text"
										class="official-guild-input"
										placeholder="Discord guild ID"
										value={integration.official_guild_id || ''}
										oninput={(e) =>
											(officialGuildInputs[integration.id] =
												e.currentTarget.value)}
									/>
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => setOfficialGuild(integration)}
									>
										Save
									</button>
								</div>
							</div>
						{/if}

						<!-- Token management -->
						<div class="integration-token-section">
							<h4>Integration Token</h4>
							{#if generatedTokens[integration.id]}
								<div class="token-display">
									<code class="token-value"
										>{generatedTokens[integration.id]}</code
									>
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => copyToken(generatedTokens[integration.id])}
									>
										📋 Copy
									</button>
								</div>
								<p class="token-warning">
									⚠️ Copy this token now. It won't be shown again after you leave
									this page.
								</p>
							{:else if integration.token}
								<p class="token-exists">
									✅ Token is set
									<span class="token-preview"
										>({integration.token.substring(0, 15)}...)</span
									>
								</p>
								<div class="token-actions">
									<button
										class="btn btn-sm btn-secondary"
										onclick={() => generateToken(integration)}
										disabled={generatingToken[integration.id]}
									>
										{generatingToken[integration.id]
											? 'Generating...'
											: '🔄 Regenerate'}
									</button>
									<button
										class="btn btn-sm btn-danger"
										onclick={() => revokeToken(integration)}
									>
										🗑️ Revoke
									</button>
								</div>
							{:else}
								<p class="token-missing">
									No token set — the integration cannot authenticate.
								</p>
								<button
									class="btn btn-sm btn-primary"
									onclick={() => generateToken(integration)}
									disabled={generatingToken[integration.id]}
								>
									{generatingToken[integration.id]
										? 'Generating...'
										: '🔑 Generate Token'}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.integrations-admin {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.back-link {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}
	.back-link:hover {
		color: var(--color-text);
	}

	.page-header h1 {
		margin: 0.5rem 0 0.25rem;
		font-size: 1.5rem;
	}

	.page-desc {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.section-title {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.section-subtitle {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.register-section,
	.manage-section {
		margin-bottom: 2rem;
	}

	.register-help {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0 0 0.75rem;
	}
	.register-help code {
		font-size: 0.8rem;
	}

	.register-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.register-input {
		flex: 1;
		min-width: 240px;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.official-check {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.register-result {
		margin-top: 1rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		background: var(--color-surface);
	}
	.register-result h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.register-result .slug {
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.surface-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	.surface {
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}
	.surface.ok {
		color: #22c55e;
	}
	.surface.bad {
		color: #ef4444;
	}

	.empty-text {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.integrations-manage-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 640px) {
		.integrations-manage-grid {
			grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		}
	}

	.integration-manage-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 1.25rem;
	}

	.integration-manage-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.integration-manage-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.integration-manage-info {
		flex: 1;
		min-width: 0;
	}
	.integration-manage-info h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.integration-manage-slug {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: monospace;
	}

	.integration-manage-status {
		flex-shrink: 0;
	}

	.conn-badge {
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
	}
	.conn-online {
		color: #22c55e;
	}
	.conn-offline {
		color: #ef4444;
	}
	.conn-unknown {
		color: var(--color-text-muted);
	}

	.integration-manage-details {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--color-surface-elevated);
		border-radius: 0.5rem;
		font-size: 0.8rem;
	}

	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.detail-row:has(.detail-url) {
		grid-column: 1 / -1;
	}

	.detail-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.detail-value {
		font-weight: 500;
	}
	.detail-url {
		font-family: monospace;
		font-size: 0.7rem;
		word-break: break-all;
		color: var(--color-primary);
	}

	.integration-token-section,
	.integration-official-guild {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}
	.integration-token-section h4,
	.integration-official-guild h4 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.token-hint {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.official-guild-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.official-guild-input {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		font-family: monospace;
		font-size: 0.85rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface-elevated);
		color: var(--color-text);
	}

	.token-display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.token-value {
		flex: 1;
		background: var(--color-surface-elevated);
		padding: 0.4rem 0.6rem;
		border-radius: 0.375rem;
		font-size: 0.7rem;
		word-break: break-all;
		border: 1px solid var(--color-border);
		user-select: all;
	}
	.token-warning {
		font-size: 0.75rem;
		color: var(--color-warning, #f59e0b);
		margin: 0;
	}
	.token-exists {
		font-size: 0.8rem;
		margin: 0 0 0.5rem;
		color: var(--color-text);
	}
	.token-preview {
		font-family: monospace;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}
	.token-missing {
		font-size: 0.8rem;
		margin: 0 0 0.5rem;
		color: var(--color-text-muted);
	}
	.token-actions {
		display: flex;
		gap: 0.5rem;
	}

	.cmd-toast {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.85rem;
	}
	.cmd-toast-success {
		background: rgba(34, 197, 94, 0.12);
		color: #22c55e;
	}
	.cmd-toast-error {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
	}
	.cmd-toast-close {
		margin-left: auto;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
	}
</style>
